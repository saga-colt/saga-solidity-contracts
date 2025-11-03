import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_TELLOR_ORACLE_WRAPPER_ID, USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to call setFeed on an oracle wrapper.
 *
 * @param wrapperAddress - Target wrapper contract address
 * @param assetAddress - Asset to configure
 * @param feedAddress - Tellor feed contract to reference
 * @param wrapperInterface - Wrapper contract interface encoder
 */
function createSetFeedTransaction(
  wrapperAddress: string,
  assetAddress: string,
  feedAddress: string,
  wrapperInterface: any,
): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setFeed", [assetAddress, feedAddress]),
  };
}

/**
 * Build a Safe transaction payload to set a threshold config on the thresholding wrapper.
 *
 * @param wrapperAddress - Target wrapper contract address
 * @param assetAddress - Asset to configure
 * @param lowerThreshold - Minimum allowed price in base units
 * @param fixedPrice - Fixed price to use when thresholding activates
 * @param wrapperInterface - Wrapper contract interface encoder
 */
function createSetThresholdConfigTransaction(
  wrapperAddress: string,
  assetAddress: string,
  lowerThreshold: bigint,
  fixedPrice: bigint,
  wrapperInterface: any,
): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setThresholdConfig", [assetAddress, lowerThreshold, fixedPrice]),
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  // Initialize Safe-aware executor
  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const usdConfig = config.oracleAggregators.USD;
  const thresholdFeeds = usdConfig.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {};
  const plainFeeds = usdConfig.tellorOracleAssets?.plainTellorOracleWrappers || {};

  const usdcAddress = config.tokenAddresses.USDC;
  const usdtAddress = config.tokenAddresses.USDT;
  const yUSDAddress = config.tokenAddresses.yUSD;

  if (!usdcAddress || !usdtAddress || !yUSDAddress) {
    console.log("❌ Missing one or more USD token addresses in config. Aborting.");
    return false;
  }

  const { address: thresholdWrapperAddress } = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);
  const thresholdWrapper = await hre.ethers.getContractAt("TellorWrapperWithThresholding", thresholdWrapperAddress, deployerSigner);

  const { address: plainWrapperAddress } = await hre.deployments.get(USD_TELLOR_ORACLE_WRAPPER_ID);
  const plainWrapper = await hre.ethers.getContractAt("TellorWrapper", plainWrapperAddress, deployerSigner);

  const baseCurrencyUnit = BigInt(10) ** BigInt(usdConfig.priceDecimals);
  const STABLECOIN_MIN_PRICE = 0.95;
  const STABLECOIN_MAX_PRICE = 1.05;

  let allOperationsComplete = true;

  type ThresholdAsset = {
    name: string;
    address: string;
  };

  const thresholdAssets: ThresholdAsset[] = [
    { name: "USDC", address: usdcAddress },
    { name: "USDT", address: usdtAddress },
  ];

  for (const asset of thresholdAssets) {
    const feedConfig = thresholdFeeds[asset.address];

    if (!feedConfig) {
      console.log(`\n⚠️  No threshold feed configuration found for ${asset.name} (${asset.address}). Skipping.`);
      continue;
    }

    console.log(`\n📝 Processing ${asset.name} (${asset.address}) on threshold wrapper...`);

    const currentFeed = await thresholdWrapper.assetToFeed(asset.address);
    const expectedFeed = feedConfig.feed;

    const feedMatches = currentFeed.toLowerCase() === expectedFeed.toLowerCase();

    if (!feedMatches) {
      console.log(`  🔧 Updating feed to ${expectedFeed} (current ${currentFeed})`);

      const opComplete = await executor.tryOrQueue(
        async () => {
          await thresholdWrapper.setFeed(asset.address, expectedFeed);
          console.log(`    ✅ Feed updated for ${asset.name}`);
        },
        () => createSetFeedTransaction(thresholdWrapperAddress, asset.address, expectedFeed, thresholdWrapper.interface),
      );

      if (!opComplete) {
        allOperationsComplete = false;
      }
    } else {
      console.log(`  ✅ Feed already up to date (${expectedFeed})`);
    }

    if (feedConfig.lowerThreshold !== undefined && feedConfig.fixedPrice !== undefined) {
      const { lowerThreshold, fixedPrice } = feedConfig;
      const currentThreshold = await thresholdWrapper.assetThresholds(asset.address);
      const thresholdsMatch = currentThreshold.lowerThresholdInBase === lowerThreshold && currentThreshold.fixedPriceInBase === fixedPrice;

      if (!thresholdsMatch) {
        console.log(`  🔧 Updating threshold config to lower=${lowerThreshold.toString()} fixed=${fixedPrice.toString()}`);

        const thresholdOpComplete = await executor.tryOrQueue(
          async () => {
            await thresholdWrapper.setThresholdConfig(asset.address, lowerThreshold, fixedPrice);
            console.log(`    ✅ Threshold config updated for ${asset.name}`);
          },
          () =>
            createSetThresholdConfigTransaction(
              thresholdWrapperAddress,
              asset.address,
              lowerThreshold,
              fixedPrice,
              thresholdWrapper.interface,
            ),
        );

        if (!thresholdOpComplete) {
          allOperationsComplete = false;
        }
      } else {
        console.log("  ✅ Threshold config already up to date");
      }
    }

    // Sanity check price when operations executed directly (not queued)
    if (executor.useSafe === false) {
      console.log("  🔍 Performing price sanity check...");
      const price = await thresholdWrapper.getAssetPrice(asset.address);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < STABLECOIN_MIN_PRICE || normalizedPrice > STABLECOIN_MAX_PRICE) {
        throw new Error(`${asset.name} price ${normalizedPrice} outside [${STABLECOIN_MIN_PRICE}, ${STABLECOIN_MAX_PRICE}]`);
      }

      console.log(`    ✅ Price sanity check passed (${normalizedPrice})`);
    }
  }

  console.log(`\n🧾 Processing yUSD (${yUSDAddress}) on plain wrapper...`);

  const yUSDFeed = plainFeeds[yUSDAddress];

  if (!yUSDFeed) {
    console.log("⚠️  No plain Tellor feed configuration found for yUSD. Skipping.");
  } else {
    const currentFeed = await plainWrapper.assetToFeed(yUSDAddress);
    const feedMatches = currentFeed.toLowerCase() === yUSDFeed.toLowerCase();

    if (!feedMatches) {
      console.log(`  🔧 Updating yUSD feed to ${yUSDFeed} (current ${currentFeed === ZeroAddress ? "ZeroAddress" : currentFeed})`);

      const opComplete = await executor.tryOrQueue(
        async () => {
          await plainWrapper.setFeed(yUSDAddress, yUSDFeed);
          console.log("    ✅ Feed updated for yUSD");
        },
        () => createSetFeedTransaction(plainWrapperAddress, yUSDAddress, yUSDFeed, plainWrapper.interface),
      );

      if (!opComplete) {
        allOperationsComplete = false;
      }
    } else {
      console.log(`  ✅ yUSD feed already up to date (${yUSDFeed})`);
    }

    if (executor.useSafe === false) {
      console.log("  🔍 Performing price sanity check for yUSD...");
      const price = await plainWrapper.getAssetPrice(yUSDAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < STABLECOIN_MIN_PRICE || normalizedPrice > STABLECOIN_MAX_PRICE) {
        throw new Error(`yUSD price ${normalizedPrice} outside [${STABLECOIN_MIN_PRICE}, ${STABLECOIN_MAX_PRICE}]`);
      }

      console.log(`    ✅ yUSD price sanity check passed (${normalizedPrice})`);
    }
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush("Update USDC/USDT/yUSD Tellor feeds");

    if (executor.useSafe) {
      if (!flushed) {
        console.log("\n❌ Failed to prepare Safe transactions for feed updates.");
      }
      console.log("\n⏳ Feed updates pending governance Safe execution.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }
  }

  console.log("\n✅ All feed updates completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "usd-feed-updates", "yusd"];
func.dependencies = [USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID, USD_TELLOR_ORACLE_WRAPPER_ID];
func.id = "update-usdc-usdt-yusd-tellor-feeds";

export default func;
