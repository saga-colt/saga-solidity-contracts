import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { MUST_GOVERNANCE_ORACLE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to set oracle in OracleAggregator
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

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

  // Get MUST token address from config
  const mustAddress = config.tokenAddresses.MUST;

  if (!mustAddress || mustAddress === "") {
    console.log("\nℹ️  MUST token not configured. Skipping oracle configuration.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (token not configured)`);
    return true;
  }

  console.log(`\n📊 MUST token address: ${mustAddress}`);

  // Get GovernanceOracleWrapper deployment
  const { address: governanceOracleWrapperAddress } = await hre.deployments.get(MUST_GOVERNANCE_ORACLE_WRAPPER_ID);
  console.log(`\n🔗 GovernanceOracleWrapper: ${governanceOracleWrapperAddress}`);

  // Get OracleAggregator contract
  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorAddress, deployerSigner);

  console.log(`🔗 OracleAggregator: ${oracleAggregatorAddress}`);

  // Check if oracle is already configured (idempotency)
  try {
    const currentOracle = await oracleAggregator.assetOracles(mustAddress);

    if (currentOracle && currentOracle.toLowerCase() === governanceOracleWrapperAddress.toLowerCase()) {
      console.log(`\n✅ Oracle for MUST token is already configured correctly. Skipping.`);
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (already configured)`);
      return true;
    } else if (currentOracle && currentOracle !== "0x0000000000000000000000000000000000000000") {
      console.log(`\n⚠️  Oracle for MUST token is already set to a different address: ${currentOracle}`);
      console.log(`   Expected: ${governanceOracleWrapperAddress}`);
      throw new Error(`Oracle already configured with different address: ${currentOracle}`);
    }
  } catch (error: any) {
    // If assetOracles reverts or returns zero address, it's not configured yet
    if (error.message && error.message.includes("OracleNotSet")) {
      console.log(`\nℹ️  Oracle for MUST token is not configured yet. Proceeding with configuration.`);
    } else {
      throw error;
    }
  }

  // Configure oracle
  console.log(`\n🔧 Configuring oracle for MUST token...`);

  const opComplete = await executor.tryOrQueue(
    async () => {
      await oracleAggregator.setOracle(mustAddress, governanceOracleWrapperAddress);
      console.log(`    ✅ Oracle configured for MUST token`);
    },
    () => createSetOracleTransaction(oracleAggregatorAddress, mustAddress, governanceOracleWrapperAddress, oracleAggregator.interface),
  );

  if (!opComplete) {
    const flushed = await executor.flush(`Configure MUST token oracle in OracleAggregator`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
        return false;
      }
      console.log("\n⏳ Oracle configuration requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`   View in Safe UI: https://app.safe.global/transactions/queue?safe=saga:${governanceMultisig}`);
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  // Verify oracle configuration and price
  console.log("\n🔍 Verifying oracle configuration...");

  try {
    const configuredOracle = await oracleAggregator.assetOracles(mustAddress);

    if (configuredOracle.toLowerCase() !== governanceOracleWrapperAddress.toLowerCase()) {
      console.log(`\n⚠️  Oracle verification failed: expected ${governanceOracleWrapperAddress}, got ${configuredOracle}`);
      console.log("   This may be because the Safe transaction hasn't been executed yet.");
      console.log("   Re-run this script after governance executes the transaction.");
    } else {
      console.log(`✅ Oracle verified: ${configuredOracle}`);

      // Verify price
      const price = await oracleAggregator.getAssetPrice(mustAddress);
      const expectedPrice = hre.ethers.parseUnits("0.995", 18);
      console.log(`\n💰 Oracle price: ${price.toString()}`);
      console.log(`💰 Expected price: ${expectedPrice.toString()} ($0.995)`);

      if (price.toString() === expectedPrice.toString()) {
        console.log(`✅ Price verification passed: Oracle returns $0.995`);
      } else {
        console.log(`⚠️  Price mismatch: expected ${expectedPrice.toString()}, got ${price.toString()}`);
        throw new Error(`Oracle price verification failed: expected ${expectedPrice.toString()}, got ${price.toString()}`);
      }
    }
  } catch (error: any) {
    if (error.message && error.message.includes("OracleNotSet")) {
      console.log(`\n⚠️  Oracle not set yet. This may be because the Safe transaction hasn't been executed yet.`);
      console.log("   Re-run this script after governance executes the transaction.");
    } else {
      throw error;
    }
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["must", "must-oracle", "d-oracle", "governance-oracle"];
func.dependencies = [MUST_GOVERNANCE_ORACLE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID];
func.id = "d-configure-must-governance-oracle";

export default func;
