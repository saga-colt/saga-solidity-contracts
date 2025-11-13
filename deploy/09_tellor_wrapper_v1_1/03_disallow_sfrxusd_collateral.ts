import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { D_COLLATERAL_VAULT_CONTRACT_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to disallow collateral
 *
 * @param collateralVaultAddress - Address of the CollateralVault contract
 * @param collateralAddress - Collateral token to disable
 * @param collateralVaultInterface - Interface used to encode Safe transaction data
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  // This script is ONLY for saga_mainnet
  if (!isMainnet(hre.network.name)) {
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ⏭️  Skipping (only runs on saga_mainnet, current: ${hre.network.name})`);
    return true;
  }

  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  // Get sfrxUSD address from config
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;

  if (!sfrxUSDAddress) {
    throw new Error("sfrxUSD address not found in config");
  }

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

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: Disallowing sfrxUSD as collateral for Saga Dollar (D)...`);

  // Get CollateralVault contract
  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);

  console.log(`\n🔗 CollateralVault: ${collateralVaultAddress}`);
  console.log(`🔗 sfrxUSD: ${sfrxUSDAddress}`);

  // Check current collateral status
  const isSupported = await collateralVault.isCollateralSupported(sfrxUSDAddress);

  if (!isSupported) {
    console.log(`\n✅ sfrxUSD is already disallowed as collateral. Skipping.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  // Safety check: Verify at least one other collateral exists
  const allCollaterals = await collateralVault.listCollateral();
  const otherCollaterals = allCollaterals.filter((addr: string) => addr.toLowerCase() !== sfrxUSDAddress.toLowerCase());

  if (otherCollaterals.length === 0) {
    throw new Error(`❌ Cannot disallow sfrxUSD: it is the last remaining collateral. CollateralVault requires at least one collateral.`);
  }

  console.log(`\n🔍 Safety check passed: ${otherCollaterals.length} other collateral(s) remain:`);

  for (const collateral of otherCollaterals) {
    console.log(`   - ${collateral}`);
  }

  console.log(`\n🔧 Disallowing sfrxUSD as collateral...`);

  // Try direct call first, fallback to Safe transaction if needed
  const opComplete = await executor.tryOrQueue(
    async () => {
      await collateralVault.disallowCollateral(sfrxUSDAddress);
      console.log(`  ✅ Disallowed sfrxUSD as collateral`);
    },
    () => createDisallowCollateralTransaction(collateralVaultAddress, sfrxUSDAddress, collateralVault.interface),
  );

  // Handle governance operations if needed
  if (!opComplete) {
    const flushed = await executor.flush(`Disallow sfrxUSD as collateral for Saga Dollar (D): governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
        return false;
      }
      console.log("\n⏳ Disallowing sfrxUSD collateral requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`   View in Safe UI: https://app.safe.global/transactions/queue?safe=saga:${governanceMultisig}`);
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ sfrxUSD collateral disallowed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-tellor-wrapper", "tellor-wrapper-v1.1"];
func.dependencies = ["update-oracle-aggregator-to-tellor-wrapper-v1.1"];
func.id = "disallow-sfrxusd-collateral-v1.1";

export default func;
