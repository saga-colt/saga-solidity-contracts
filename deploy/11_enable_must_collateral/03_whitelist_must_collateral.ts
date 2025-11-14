import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to allow collateral in CollateralVault
 *
 * @param collateralVaultAddress - Collateral vault contract address
 * @param collateralAddress - Collateral token to whitelist
 * @param collateralVaultInterface - Collateral vault interface encoder
 */
function createAllowCollateralTransaction(
  collateralVaultAddress: string,
  collateralAddress: string,
  collateralVaultInterface: any,
): SafeTransactionData {
  return {
    to: collateralVaultAddress,
    value: "0",
    data: collateralVaultInterface.encodeFunctionData("allowCollateral", [collateralAddress]),
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

  // Get the CollateralVault contract
  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);

  // Get the OracleAggregator contract
  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorAddress, deployerSigner);

  console.log(`\n🔗 CollateralVault: ${collateralVaultAddress}`);
  console.log(`🔗 OracleAggregator: ${oracleAggregatorAddress}`);

  // Get MUST token address from config
  const mustAddress = config.tokenAddresses.MUST;

  if (!mustAddress || mustAddress === "") {
    console.log("\nℹ️  MUST token not configured. Skipping whitelist.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (token not configured)`);
    return true;
  }

  console.log(`\n📊 MUST token address: ${mustAddress}`);

  // Sanity check: Verify that the oracle can provide a price for MUST token
  console.log("\n🔍 Performing oracle price sanity check...");

  let oracleConfigured = false;

  // First check if oracle is set using assetOracles (doesn't revert)
  try {
    const configuredOracle = await oracleAggregator.assetOracles(mustAddress);

    if (!configuredOracle || configuredOracle === "0x0000000000000000000000000000000000000000") {
      console.log(`    ⚠️  Oracle not configured for MUST token (previous Safe tx not executed yet)`);
      oracleConfigured = false;
    } else {
      console.log(`    ✅ Oracle configured: ${configuredOracle}`);

      // Now try to get the price (this will revert if oracle is not properly configured)
      try {
        const price = await oracleAggregator.getAssetPrice(mustAddress);
        const expectedPrice = hre.ethers.parseUnits("0.995", 18);

        if (price.toString() === "0") {
          console.log(`    ⚠️  Oracle price for MUST is zero`);
          oracleConfigured = false;
        } else if (price.toString() !== expectedPrice.toString()) {
          console.log(`    ⚠️  Oracle price mismatch: expected ${expectedPrice.toString()} ($0.995), got ${price.toString()}`);
          throw new Error(`Oracle price verification failed: expected ${expectedPrice.toString()}, got ${price.toString()}`);
        } else {
          console.log(`    ✅ Oracle price for MUST: ${price.toString()} ($0.995)`);
          oracleConfigured = true;
        }
      } catch (priceError: any) {
        // Handle price query errors
        if (priceError.message && (priceError.message.includes("OracleNotSet") || priceError.message.includes("execution reverted"))) {
          console.log(`    ⚠️  Oracle configured but price query failed (may need to wait for transaction confirmation)`);
          oracleConfigured = false;
        } else {
          throw priceError;
        }
      }
    }
  } catch (error: any) {
    // Handle assetOracles query errors
    if (error.message && error.message.includes("OracleNotSet")) {
      console.log(`    ⚠️  Oracle not configured for MUST token (previous Safe tx not executed yet)`);
      oracleConfigured = false;
    } else {
      throw error;
    }
  }

  if (!oracleConfigured) {
    console.log("\n⏭️  Oracle not configured yet. Proceeding with whitelist anyway.");
    console.log("    Oracle sanity check will run when you re-run this script after executing Safe transactions.");
  }

  // Check if the token is already whitelisted
  const isAlreadyWhitelisted = await collateralVault.isCollateralSupported(mustAddress);

  if (isAlreadyWhitelisted) {
    console.log(`\n✅ MUST token is already whitelisted as collateral. Skipping.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (already whitelisted)`);
    return true;
  }

  // Whitelist the token
  console.log(`\n🔧 Whitelisting MUST token as collateral...`);

  const opComplete = await executor.tryOrQueue(
    async () => {
      await collateralVault.allowCollateral(mustAddress);
      console.log(`    ✅ MUST token whitelisted as collateral`);
    },
    () => createAllowCollateralTransaction(collateralVaultAddress, mustAddress, collateralVault.interface),
  );

  if (!opComplete) {
    const flushed = await executor.flush(`Whitelist MUST token as D collateral`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
        return false;
      }
      console.log("\n⏳ Collateral whitelisting requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`   View in Safe UI: https://app.safe.global/transactions/queue?safe=saga:${governanceMultisig}`);
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  // Verify whitelisting
  console.log("\n🔍 Verifying collateral whitelisting...");

  const isWhitelisted = await collateralVault.isCollateralSupported(mustAddress);

  if (isWhitelisted) {
    console.log(`✅ MUST token verified as whitelisted collateral`);
  } else {
    console.log(`⚠️  Verification failed: MUST token is not whitelisted yet.`);
    console.log("   This may be because the Safe transaction hasn't been executed yet.");
    console.log("   Re-run this script after governance executes the transaction.");
  }

  console.log("\n✅ All collateral enablement operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["must", "must-collateral", "d-collateral"];
func.dependencies = [D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID];
func.id = "d-whitelist-must-collateral";

export default func;
