import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_TELLOR_COMPOSITE_WRAPPER_ID,
  USD_TELLOR_ORACLE_WRAPPER_ID,
  USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to set an oracle in the OracleAggregator
 *
 * @param oracleAggregatorAddress - Address of the OracleAggregator contract
 * @param assetAddress - Asset whose oracle will be updated
 * @param oracleAddress - Address of the target oracle feed
 * @param oracleAggregatorInterface - Interface used to encode Safe transaction data
 */
function createSetOracleTransaction(
  oracleAggregatorAddress: string,
  assetAddress: string,
  oracleAddress: string,
  oracleAggregatorInterface: any,
): SafeTransactionData {
  return {
    to: oracleAggregatorAddress,
    value: "0",
    data: oracleAggregatorInterface.encodeFunctionData("setOracle", [assetAddress, oracleAddress]),
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: Updating OracleAggregator to point to TellorWrapper v1.1...`);

  // Get the governance multisig address (allow override via env var for testing)
  const testMultisig = process.env.TEST_GOVERNANCE_MULTISIG;
  const governanceMultisig = testMultisig || config.walletAddresses.governanceMultisig;

  if (testMultisig) {
    console.log(`⚠️  Using TEST governance multisig: ${governanceMultisig} (from TEST_GOVERNANCE_MULTISIG env var)`);
  } else {
    console.log(`🔐 Governance multisig: ${governanceMultisig}`);
  }

  // Override Safe config for testing if TEST_GOVERNANCE_MULTISIG is set
  const safeConfig =
    testMultisig && config.safeConfig
      ? {
          safeAddress: governanceMultisig,
          chainId: config.safeConfig.chainId,
          txServiceUrl: config.safeConfig.txServiceUrl,
        }
      : config.safeConfig;

  // Initialize Saga governance executor with potentially overridden Safe config
  const executor = new SagaGovernanceExecutor(hre, deployerSigner, safeConfig);
  await executor.initialize();

  // Get USD OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  // Get USD TellorWrapper v1.1 addresses (deployment IDs now point to v1.1)
  const tellorWrapperDeployment = await hre.deployments.get(USD_TELLOR_ORACLE_WRAPPER_ID);
  const tellorWrapperAddress = tellorWrapperDeployment.address;

  const tellorWrapperWithThresholdingDeployment = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);
  const tellorWrapperWithThresholdingAddress = tellorWrapperWithThresholdingDeployment.address;

  const tellorCompositeWrapperDeployment = await hre.deployments.get(USD_TELLOR_COMPOSITE_WRAPPER_ID);
  const tellorCompositeWrapperAddress = tellorCompositeWrapperDeployment.address;

  console.log(`\n🔗 Oracle Aggregator: ${oracleAggregatorDeployment.address}`);
  console.log(`🔗 TellorWrapper v1.1 (plain): ${tellorWrapperAddress}`);
  console.log(`🔗 TellorWrapperWithThresholding v1.1: ${tellorWrapperWithThresholdingAddress}`);
  console.log(`🔗 TellorCompositeWrapper v1.1: ${tellorCompositeWrapperAddress}`);

  // Get all Tellor feed configurations
  const plainFeeds = config.oracleAggregators.USD.tellorOracleAssets?.plainTellorOracleWrappers || {};
  const thresholdFeeds = config.oracleAggregators.USD.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {};
  const compositeFeeds = config.oracleAggregators.USD.tellorOracleAssets?.compositeTellorOracleWrappers || {};

  // Build list of all assets that need updating
  const assetsToUpdate: Array<{
    name: string;
    address: string;
    wrapperAddress: string;
    wrapperType: "plain" | "thresholded" | "composite";
  }> = [];

  // Add plain wrapper assets
  for (const [assetAddress] of Object.entries(plainFeeds)) {
    assetsToUpdate.push({
      name: `Asset ${assetAddress.slice(0, 10)}...`,
      address: assetAddress,
      wrapperAddress: tellorWrapperAddress,
      wrapperType: "plain",
    });
  }

  // Add thresholded wrapper assets
  for (const [assetAddress] of Object.entries(thresholdFeeds)) {
    assetsToUpdate.push({
      name: `Asset ${assetAddress.slice(0, 10)}...`,
      address: assetAddress,
      wrapperAddress: tellorWrapperWithThresholdingAddress,
      wrapperType: "thresholded",
    });
  }

  // Add composite wrapper assets
  for (const [assetAddress] of Object.entries(compositeFeeds)) {
    assetsToUpdate.push({
      name: `Asset ${assetAddress.slice(0, 10)}...`,
      address: assetAddress,
      wrapperAddress: tellorCompositeWrapperAddress,
      wrapperType: "composite",
    });
  }

  if (assetsToUpdate.length === 0) {
    console.log("⚠️  No Tellor assets configured. Skipping OracleAggregator update.");
    return true;
  }

  console.log(`\n📋 Found ${assetsToUpdate.length} assets to update:`);
  console.log(`   - Plain wrapper assets: ${Object.keys(plainFeeds).length}`);
  console.log(`   - Thresholded wrapper assets: ${Object.keys(thresholdFeeds).length}`);
  console.log(`   - Composite wrapper assets: ${Object.keys(compositeFeeds).length}`);

  let allOperationsComplete = true;

  // Process each asset
  for (const asset of assetsToUpdate) {
    console.log(`\n📝 Processing ${asset.name} (${asset.address})...`);

    // Check current oracle assignment
    const currentOracle = await oracleAggregator.assetOracles(asset.address);

    if (currentOracle === asset.wrapperAddress) {
      console.log(`  ✅ Already pointing to TellorWrapper v1.1 (${asset.wrapperType}). Skipping.`);
      continue;
    }

    console.log(`  🔄 Current oracle: ${currentOracle}`);
    console.log(`  🎯 Target oracle: ${asset.wrapperAddress} (TellorWrapper v1.1 ${asset.wrapperType})`);

    // Try direct call first, fallback to Safe transaction if needed
    const opComplete = await executor.tryOrQueue(
      async () => {
        await oracleAggregator.setOracle(asset.address, asset.wrapperAddress);
        console.log(`    ✅ Set oracle for ${asset.address} to TellorWrapper v1.1 (${asset.wrapperType})`);
      },
      () => createSetOracleTransaction(oracleAggregatorDeployment.address, asset.address, asset.wrapperAddress, oracleAggregator.interface),
    );

    if (!opComplete) {
      allOperationsComplete = false;
    }
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Update OracleAggregator to TellorWrapper v1.1: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
        return false;
      }
      console.log("\n⏳ OracleAggregator update requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`   View in Safe UI: https://app.safe.global/transactions/queue?safe=saga:${governanceMultisig}`);
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All OracleAggregator updates completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-tellor-wrapper", "tellor-wrapper-v1.1"];
func.dependencies = ["deploy-tellor-wrapper-v1.1", "transfer_tellor_wrapper_v1_1_roles_to_multisig", "deploy-usd-oracle-aggregator"];
func.id = "update-oracle-aggregator-to-tellor-wrapper-v1.1";

export default func;
