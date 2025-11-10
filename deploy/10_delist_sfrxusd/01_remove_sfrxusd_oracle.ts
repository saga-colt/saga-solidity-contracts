import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to remove an oracle from the OracleAggregator
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // This script is ONLY for saga_mainnet
  if (!isMainnet(hre.network.name)) {
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ⏭️  Skipping (only runs on saga_mainnet, current: ${hre.network.name})`);
    return true;
  }

  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

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

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  // Get sfrxUSD address from config - skip if not configured
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;

  if (!sfrxUSDAddress) {
    console.log("sfrxUSD token address not configured in network config. Skipping oracle removal.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (token not configured)`);
    return true;
  }

  // Get USD OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  console.log(`\n🔗 Oracle Aggregator: ${oracleAggregatorDeployment.address}`);
  console.log(`\n📝 Processing sfrxUSD (${sfrxUSDAddress})...`);

  // Check if oracle exists (idempotency check)
  const currentOracle = await oracleAggregator.assetOracles(sfrxUSDAddress);

  if (currentOracle === "0x0000000000000000000000000000000000000000") {
    console.log(`  ✅ sfrxUSD oracle is already removed. Skipping.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  // Remove oracle for sfrxUSD
  console.log(`\n  🔧 Removing oracle for sfrxUSD...`);

  let allOperationsComplete = true;

  const opComplete = await executor.tryOrQueue(
    async () => {
      await oracleAggregator.removeOracle(sfrxUSDAddress);
      console.log(`    ✅ Removed oracle for sfrxUSD`);
    },
    () => createRemoveOracleTransaction(oracleAggregatorDeployment.address, sfrxUSDAddress, oracleAggregator.interface),
  );

  if (!opComplete) {
    allOperationsComplete = false;
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Remove sfrxUSD oracle: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Oracle removal requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  // Verify removal after execution
  const verifyOracle = await oracleAggregator.assetOracles(sfrxUSDAddress);

  if (verifyOracle === "0x0000000000000000000000000000000000000000") {
    console.log(`\n✅ Verified: sfrxUSD oracle successfully removed`);
  } else {
    console.log(`\n⚠️  Warning: sfrxUSD oracle may still be set (${verifyOracle})`);
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["delist-sfrxusd", "delist-sfrxusd-oracle", "usd-oracle", "oracle-aggregator"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];
func.id = "remove-sfrxusd-oracle";

export default func;
