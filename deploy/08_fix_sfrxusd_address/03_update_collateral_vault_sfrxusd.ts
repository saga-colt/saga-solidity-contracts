import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";
import { WRONG_SFRXUSD_ADDRESS } from "./constants";

/**
 * Build a Safe transaction payload to disallow collateral
 *
 * @param collateralVaultAddress
 * @param collateralAddress
 * @param collateralVaultInterface
 */
function createDisallowCollateralTransaction(
  collateralVaultAddress: string,
  collateralAddress: string,
  collateralVaultInterface: any,
): SafeTransactionData {
  return {
    to: collateralVaultAddress,
    value: "0",
    data: collateralVaultInterface.encodeFunctionData("disallowCollateral", [collateralAddress]),
  };
}

/**
 * Build a Safe transaction payload to allow collateral
 *
 * @param collateralVaultAddress
 * @param collateralAddress
 * @param collateralVaultInterface
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

  // Get CollateralVault contract
  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);

  // Get OracleAggregator for price checks
  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorAddress, deployerSigner);

  console.log(`\n🔗 CollateralVault: ${collateralVaultAddress}`);
  console.log(`🔗 OracleAggregator: ${oracleAggregatorAddress}`);
  console.log(`\n🔧 Updating collateral vault for sfrxUSD...`);
  console.log(`   - Disallowing old (wrong) sfrxUSD: ${oldSfrxUSDAddress}`);
  console.log(`   - Allowing correct sfrxUSD: ${correctSfrxUSDAddress}`);

  let allOperationsComplete = true;

  // Check current collateral status
  const oldIsSupported = await collateralVault.isCollateralSupported(oldSfrxUSDAddress);
  const newIsSupported = await collateralVault.isCollateralSupported(correctSfrxUSDAddress);

  // Disallow old sfrxUSD if it's currently supported
  if (oldIsSupported) {
    console.log(`\n🔧 Disallowing old (wrong) sfrxUSD collateral...`);
    const disallowOpComplete = await executor.tryOrQueue(
      async () => {
        await collateralVault.disallowCollateral(oldSfrxUSDAddress);
        console.log(`  ✅ Disallowed old sfrxUSD collateral`);
      },
      () => createDisallowCollateralTransaction(collateralVaultAddress, oldSfrxUSDAddress, collateralVault.interface),
    );

    if (!disallowOpComplete) {
      allOperationsComplete = false;
    }
  } else {
    console.log(`\n✅ Old sfrxUSD already disallowed. Skipping.`);
  }

  // Perform oracle sanity check for correct sfrxUSD
  console.log(`\n🔍 Checking oracle price for correct sfrxUSD...`);

  try {
    const price = await oracleAggregator.getAssetPrice(correctSfrxUSDAddress);

    if (price.toString() === "0") {
      console.log(`  ⚠️  Oracle price for correct sfrxUSD is zero (oracle not configured yet)`);
    } else {
      console.log(`  ✅ Oracle price for correct sfrxUSD: ${price.toString()}`);
    }
  } catch (error) {
    console.log(`  ⚠️  Oracle not configured for correct sfrxUSD (previous Safe txs not executed yet)`);
  }

  // Allow correct sfrxUSD if not already supported
  if (!newIsSupported) {
    console.log(`\n🔧 Allowing correct sfrxUSD collateral...`);
    const allowOpComplete = await executor.tryOrQueue(
      async () => {
        await collateralVault.allowCollateral(correctSfrxUSDAddress);
        console.log(`  ✅ Allowed correct sfrxUSD collateral`);
      },
      () => createAllowCollateralTransaction(collateralVaultAddress, correctSfrxUSDAddress, collateralVault.interface),
    );

    if (!allowOpComplete) {
      allOperationsComplete = false;
    }
  } else {
    console.log(`\n✅ Correct sfrxUSD already allowed. Skipping.`);
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Update CollateralVault for correct sfrxUSD: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Collateral vault update requires governance signatures.");
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

func.tags = ["fix-sfrxusd", "fix-sfrxusd-collateral"];
func.dependencies = ["fix-sfrxusd-update-aggregator", D_COLLATERAL_VAULT_CONTRACT_ID];
func.id = "fix-sfrxusd-update-collateral";

export default func;
