import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to set a Tellor feed
 *
 * @param tellorWrapperAddress
 * @param assetAddress
 * @param feedAddress
 * @param tellorWrapperInterface
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  // This script is ONLY for saga_mainnet (network-specific fix)
  const networkName = hre.network.name;

  if (networkName !== "saga_mainnet") {
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ⏭️  Skipping (only runs on saga_mainnet, current: ${networkName})`);
    return true;
  }

  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  // Get addresses from config
  const correctSfrxUSDAddress = config.tokenAddresses.sfrxUSD;

  if (!correctSfrxUSDAddress) {
    throw new Error("Correct sfrxUSD address not found in config");
  }

  // Get oracle configuration from config
  const tellorOracleAssets = config.oracleAggregators.USD.tellorOracleAssets;

  if (!tellorOracleAssets) {
    throw new Error("Tellor oracle assets configuration not found");
  }
  const sfrxUSDOracleConfig = tellorOracleAssets.tellorOracleWrappersWithThresholding[correctSfrxUSDAddress];

  if (!sfrxUSDOracleConfig) {
    throw new Error("sfrxUSD oracle configuration not found in config");
  }

  // Initialize Saga governance executor
  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);
  console.log(`\n🔧 Setting up oracle for CORRECT sfrxUSD address: ${correctSfrxUSDAddress}`);

  const { address: tellorWrapperAddress } = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);
  const tellorWrapper = await hre.ethers.getContractAt("TellorWrapperWithThresholding", tellorWrapperAddress, deployerSigner);

  const baseCurrencyUnit = BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);

  // Check if feed already exists
  const existingFeed = await tellorWrapper.assetToFeed(correctSfrxUSDAddress);

  if (existingFeed !== ZeroAddress) {
    console.log(`✅ Tellor feed for correct sfrxUSD already configured. Skipping setup.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  console.log(`\n📝 Configuring oracle feed for correct sfrxUSD...`);
  console.log(`   - Asset: ${correctSfrxUSDAddress}`);
  console.log(`   - Feed: ${sfrxUSDOracleConfig.feed}`);
  console.log(`   - Note: No threshold (sfrxUSD is yield-bearing, price not capped)`);

  let allOperationsComplete = true;

  // Set the feed
  console.log(`\n🔧 Setting Tellor feed for correct sfrxUSD...`);
  const feedOpComplete = await executor.tryOrQueue(
    async () => {
      await tellorWrapper.setFeed(correctSfrxUSDAddress, sfrxUSDOracleConfig.feed);
      console.log(`  ✅ Set Tellor feed for correct sfrxUSD`);
    },
    () => createSetFeedTransaction(tellorWrapperAddress, correctSfrxUSDAddress, sfrxUSDOracleConfig.feed, tellorWrapper.interface),
  );

  if (!feedOpComplete) {
    allOperationsComplete = false;
  }

  // Perform sanity check if operation completed
  if (feedOpComplete) {
    console.log(`\n🔍 Performing sanity check for correct sfrxUSD...`);

    try {
      const price = await tellorWrapper.getAssetPrice(correctSfrxUSDAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      // sfrxUSD is yield-bearing and should trade above $1, typically between $1.00 and $2.00
      if (normalizedPrice < 1.0 || normalizedPrice >= 2.0) {
        console.error(`  ❌ Sanity check failed: Price ${normalizedPrice} outside range [1.0, 2.0)`);
        throw new Error(`Sanity check failed: Price ${normalizedPrice} outside range [1.0, 2.0)`);
      } else {
        console.log(`  ✅ Sanity check passed: Normalized price is ${normalizedPrice}`);
      }
    } catch (error) {
      console.error(`  ❌ Error performing sanity check:`, error);
      throw error;
    }
  } else {
    console.log(`\n⏭️ Skipping sanity check (operations queued to Safe)`);
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Setup oracle feed for correct sfrxUSD`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Oracle setup for correct sfrxUSD requires governance signatures.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["fix-sfrxusd", "fix-sfrxusd-oracle"];
func.dependencies = [USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID];
func.id = "fix-sfrxusd-setup-oracle";

export default func;
