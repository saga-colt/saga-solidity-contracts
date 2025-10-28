import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID, USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

// Legacy sfrxUSD address deployed in error prior to this remediation
const WRONG_SFRXUSD_ADDRESS = "0x55F937DEF274C6CBd9444f0857639757C5A2a3E9";

/**
 * Build a Safe transaction payload to remove an oracle
 *
 * @param oracleAggregatorAddress
 * @param assetAddress
 * @param oracleAggregatorInterface
 */
function createRemoveOracleTransaction(
  oracleAggregatorAddress: string,
  assetAddress: string,
  oracleAggregatorInterface: any,
): SafeTransactionData {
  return {
    to: oracleAggregatorAddress,
    value: "0",
    data: oracleAggregatorInterface.encodeFunctionData("removeOracle", [assetAddress]),
  };
}

/**
 * Build a Safe transaction payload to set an oracle
 *
 * @param oracleAggregatorAddress
 * @param assetAddress
 * @param oracleAddress
 * @param oracleAggregatorInterface
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
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
  const oldSfrxUSDAddress = WRONG_SFRXUSD_ADDRESS;

  if (!oldSfrxUSDAddress || !correctSfrxUSDAddress) {
    throw new Error("sfrxUSD addresses not found in config");
  }

  // Initialize Saga governance executor
  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  // Get OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  // Get TellorWrapper address
  const tellorWrapperDeployment = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);
  const tellorWrapperAddress = tellorWrapperDeployment.address;

  console.log(`\n🔗 Oracle Aggregator: ${oracleAggregatorDeployment.address}`);
  console.log(`🔗 Tellor Wrapper: ${tellorWrapperAddress}`);
  console.log(`\n🔧 Updating oracle aggregator for sfrxUSD...`);
  console.log(`   - Removing old (wrong) sfrxUSD: ${oldSfrxUSDAddress}`);
  console.log(`   - Adding correct sfrxUSD: ${correctSfrxUSDAddress}`);

  let allOperationsComplete = true;

  // Check current oracle for old address
  const oldOracle = await oracleAggregator.assetOracles(oldSfrxUSDAddress);
  const newOracle = await oracleAggregator.assetOracles(correctSfrxUSDAddress);

  // Remove oracle for old sfrxUSD if it exists
  if (oldOracle !== "0x0000000000000000000000000000000000000000") {
    console.log(`\n🔧 Removing oracle for old (wrong) sfrxUSD...`);
    const removeOpComplete = await executor.tryOrQueue(
      async () => {
        await oracleAggregator.removeOracle(oldSfrxUSDAddress);
        console.log(`  ✅ Removed oracle for old sfrxUSD`);
      },
      () => createRemoveOracleTransaction(oracleAggregatorDeployment.address, oldSfrxUSDAddress, oracleAggregator.interface),
    );

    if (!removeOpComplete) {
      allOperationsComplete = false;
    }
  } else {
    console.log(`\n✅ Oracle for old sfrxUSD already removed. Skipping.`);
  }

  // Set oracle for correct sfrxUSD if not already set
  if (newOracle !== tellorWrapperAddress) {
    console.log(`\n🔧 Setting oracle for correct sfrxUSD...`);
    const setOpComplete = await executor.tryOrQueue(
      async () => {
        await oracleAggregator.setOracle(correctSfrxUSDAddress, tellorWrapperAddress);
        console.log(`  ✅ Set oracle for correct sfrxUSD to TellorWrapper`);
      },
      () =>
        createSetOracleTransaction(
          oracleAggregatorDeployment.address,
          correctSfrxUSDAddress,
          tellorWrapperAddress,
          oracleAggregator.interface,
        ),
    );

    if (!setOpComplete) {
      allOperationsComplete = false;
    }
  } else {
    console.log(`\n✅ Oracle for correct sfrxUSD already set. Skipping.`);
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Update OracleAggregator for correct sfrxUSD: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Oracle aggregator update requires governance signatures.");
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

func.tags = ["fix-sfrxusd", "fix-sfrxusd-aggregator"];
func.dependencies = ["fix-sfrxusd-setup-oracle", USD_ORACLE_AGGREGATOR_ID];
func.id = "fix-sfrxusd-update-aggregator";

export default func;
