import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { D_COLLATERAL_VAULT_CONTRACT_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to disallow collateral in CollateralVault
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

  // Get the CollateralVault contract
  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);

  console.log(`\n🔗 CollateralVault: ${collateralVaultAddress}`);

  // Get sfrxUSD address from config
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;

  if (!sfrxUSDAddress || sfrxUSDAddress === ZeroAddress) {
    console.log("sfrxUSD token address not configured in network config. Skipping collateral disallow.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (token not configured)`);
    return true;
  }

  console.log(`\n📝 Processing sfrxUSD (${sfrxUSDAddress})...`);

  // Safety check: Verify sfrxUSD is currently allowed
  const isCurrentlySupported = await collateralVault.isCollateralSupported(sfrxUSDAddress);

  if (!isCurrentlySupported) {
    console.log(`  ✅ sfrxUSD is already disallowed as collateral. Skipping.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  // Safety check: Verify at least one other collateral exists
  const supportedCollaterals = await collateralVault.listCollateral();
  const otherCollaterals = supportedCollaterals.filter((addr) => addr.toLowerCase() !== sfrxUSDAddress.toLowerCase());

  if (otherCollaterals.length === 0) {
    throw new Error(
      `Cannot remove sfrxUSD: it is the last remaining collateral. CollateralVault requires at least one collateral to remain.`,
    );
  }

  console.log(`  ✅ Safety check passed: Found ${otherCollaterals.length} other collateral(s)`);
  console.log(`     Other collaterals: ${otherCollaterals.join(", ")}`);

  // Disallow sfrxUSD as collateral
  console.log(`\n  🔧 Disallowing sfrxUSD as collateral...`);

  let allOperationsComplete = true;

  const opComplete = await executor.tryOrQueue(
    async () => {
      await collateralVault.disallowCollateral(sfrxUSDAddress);
      console.log(`    ✅ Disallowed sfrxUSD as collateral`);
    },
    () => createDisallowCollateralTransaction(collateralVaultAddress, sfrxUSDAddress, collateralVault.interface),
  );

  if (!opComplete) {
    allOperationsComplete = false;
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Disallow sfrxUSD collateral: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Collateral disallow requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  // Verify removal after execution
  const verifySupported = await collateralVault.isCollateralSupported(sfrxUSDAddress);

  if (!verifySupported) {
    console.log(`\n✅ Verified: sfrxUSD successfully disallowed as collateral`);
  } else {
    console.log(`\n⚠️  Warning: sfrxUSD may still be supported as collateral`);
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["delist-sfrxusd", "delist-sfrxusd-collateral", "d"];
func.dependencies = ["d-collateral-vault"];
func.id = "disallow-sfrxusd-collateral";

export default func;
