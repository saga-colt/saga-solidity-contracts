import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to set a Tellor feed.
 *
 * @param tellorWrapperAddress - Tellor wrapper contract address
 * @param assetAddress - Asset that should point at the feed
 * @param feedAddress - Tellor feed contract address
 * @param tellorWrapperInterface - Wrapper interface used to encode calldata
 */
function createSetFeedTransaction(
  tellorWrapperAddress: string,
  assetAddress: string,
  feedAddress: string,
  tellorWrapperInterface: any,
): SafeTransactionData {
  return {
    to: tellorWrapperAddress,
    value: "0",
    data: tellorWrapperInterface.encodeFunctionData("setFeed", [assetAddress, feedAddress]),
  };
}

/**
 * Build a Safe transaction payload to set threshold configuration.
 *
 * @param tellorWrapperAddress - Tellor wrapper contract address
 * @param assetAddress - Asset to configure
 * @param lowerThreshold - Lower price threshold in base units
 * @param fixedPrice - Fixed price to use when threshold triggers
 * @param tellorWrapperInterface - Wrapper interface used to encode calldata
 */
function createSetThresholdConfigTransaction(
  tellorWrapperAddress: string,
  assetAddress: string,
  lowerThreshold: bigint,
  fixedPrice: bigint,
  tellorWrapperInterface: any,
): SafeTransactionData {
  return {
    to: tellorWrapperAddress,
    value: "0",
    data: tellorWrapperInterface.encodeFunctionData("setThresholdConfig", [assetAddress, lowerThreshold, fixedPrice]),
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  // Initialize Saga governance executor
  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  // Define the assets to setup - sfrxUSD and USDN
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;
  const usdnAddress = config.tokenAddresses.USDN;

  if (!sfrxUSDAddress || !usdnAddress) {
    console.log("sfrxUSD or USDN token address not configured in network config. Skipping oracle feed setup.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (tokens not configured)`);
    return true;
  }

  const assetsToSetup = [
    { name: "sfrxUSD", address: sfrxUSDAddress },
    { name: "USDN", address: usdnAddress },
  ];

  const { address: tellorWrapperAddress } = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);

  if (!tellorWrapperAddress) {
    throw new Error("TellorWrapperWithThresholding artifact not found");
  }

  const tellorWrapper = await hre.ethers.getContractAt("TellorWrapperWithThresholding", tellorWrapperAddress, deployerSigner);

  console.log(`\n🔮 Setting up Tellor feeds for ${assetsToSetup.length} stablecoin assets (sfrxUSD, USDN)...`);

  const baseCurrencyUnit = BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);
  const thresholdFeeds = config.oracleAggregators.USD.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {};

  // Price range for sanity checks (stablecoins typically trade in $0.95 - $1.05 range)
  const STABLECOIN_MIN_PRICE = 0.95;
  const STABLECOIN_MAX_PRICE = 1.05;

  let allOperationsComplete = true;

  for (const asset of assetsToSetup) {
    const feedConfig = thresholdFeeds[asset.address];

    if (!feedConfig) {
      console.log(`\n⚠️  No Tellor feed configuration found for ${asset.name} (${asset.address}). Skipping.`);
      continue;
    }

    console.log(`\n📝 Processing ${asset.name} (${asset.address})...`);

    // Check if feed already exists
    const existingFeed = await tellorWrapper.assetToFeed(asset.address);

    if (existingFeed !== ZeroAddress) {
      console.log(`  ✅ Tellor feed for ${asset.name} already configured. Skipping setup.`);
      continue;
    }

    console.log(`  📌 Tellor feed for ${asset.name} not found. Proceeding with setup...`);
    console.log(`    - feed: ${feedConfig.feed}`);
    console.log(`    - lowerThreshold: ${feedConfig.lowerThreshold}`);
    console.log(`    - fixedPrice: ${feedConfig.fixedPrice}`);

    // Set the feed
    console.log(`\n  🔧 Setting Tellor feed for ${asset.name}...`);
    const feedOpComplete = await executor.tryOrQueue(
      async () => {
        await tellorWrapper.setFeed(asset.address, feedConfig.feed);
        console.log(`    ✅ Set Tellor feed for ${asset.name}`);
      },
      () => createSetFeedTransaction(tellorWrapperAddress, asset.address, feedConfig.feed, tellorWrapper.interface),
    );

    if (!feedOpComplete) {
      allOperationsComplete = false;
    }

    // Set threshold configuration if thresholds are specified
    let thresholdOpComplete = true; // Default to true if no threshold config needed

    if (feedConfig.lowerThreshold !== undefined && feedConfig.fixedPrice !== undefined) {
      console.log(`\n  🔧 Setting threshold config for ${asset.name}...`);
      thresholdOpComplete = await executor.tryOrQueue(
        async () => {
          await tellorWrapper.setThresholdConfig(asset.address, feedConfig.lowerThreshold, feedConfig.fixedPrice);
          console.log(`    ✅ Set threshold config for ${asset.name}`);
        },
        () =>
          createSetThresholdConfigTransaction(
            tellorWrapperAddress,
            asset.address,
            feedConfig.lowerThreshold,
            feedConfig.fixedPrice,
            tellorWrapper.interface,
          ),
      );

      if (!thresholdOpComplete) {
        allOperationsComplete = false;
      }
    }

    // Perform sanity check ONLY if BOTH feed and threshold were set successfully (direct execution, not queued to Safe)
    if (feedOpComplete && thresholdOpComplete) {
      console.log(`\n  🔍 Performing sanity check for ${asset.name}...`);

      try {
        const price = await tellorWrapper.getAssetPrice(asset.address);
        const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

        if (normalizedPrice < STABLECOIN_MIN_PRICE || normalizedPrice > STABLECOIN_MAX_PRICE) {
          console.error(
            `    ❌ Sanity check failed for ${asset.name}: Normalized price ${normalizedPrice} is outside the range [${STABLECOIN_MIN_PRICE}, ${STABLECOIN_MAX_PRICE}]`,
          );
          throw new Error(
            `Sanity check failed for ${asset.name}: Normalized price ${normalizedPrice} is outside the range [${STABLECOIN_MIN_PRICE}, ${STABLECOIN_MAX_PRICE}]`,
          );
        } else {
          console.log(`    ✅ Sanity check passed for ${asset.name}: Normalized price is ${normalizedPrice}`);
        }
      } catch (error) {
        console.error(`    ❌ Error performing sanity check for ${asset.name}:`, error);
        throw new Error(`Error performing sanity check for ${asset.name}: ${error}`);
      }
    } else if (!feedOpComplete || !thresholdOpComplete) {
      console.log(`\n  ⏭️  Skipping sanity check for ${asset.name} (operations queued to Safe, will be verified after execution)`);
    }
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Setup sfrxUSD and USDN oracle feeds: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Oracle feed setup requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log("\n📋 After executing Safe transactions:");
      console.log("   1. Execute all pending Safe transactions in order (by nonce)");
      console.log("   2. Re-run this deployment to verify oracle prices");
      console.log("   3. Sanity checks will run automatically once feeds are active");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = [
  "sfrxusd-usdn",
  "sfrxusd-usdn-oracle",
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-tellor-oracle-wrapper",
  "sfrxusd-usdn-tellor-feeds",
];
func.dependencies = [USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID];
func.id = "setup-sfrxusd-usdn-usd-tellor-oracle-feeds";

export default func;
