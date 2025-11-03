import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to allow collateral in the vault.
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

  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const yUSDAddress = config.tokenAddresses.yUSD;

  if (!yUSDAddress || yUSDAddress === ZeroAddress) {
    console.log("ℹ️  yUSD token address not configured. Skipping collateral enablement.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (nothing to do)`);
    return true;
  }

  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);

  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorAddress, deployerSigner);

  console.log(`🔗 CollateralVault: ${collateralVaultAddress}`);
  console.log(`🔗 OracleAggregator: ${oracleAggregatorAddress}`);
  console.log(`🪙 yUSD: ${yUSDAddress}`);

  // Sanity check oracle price
  try {
    const price = await oracleAggregator.getAssetPrice(yUSDAddress);

    if (price === 0n) {
      console.log("⚠️  yUSD oracle price is zero; Safe execution likely pending.");
    } else {
      console.log(`✅ yUSD oracle price: ${price.toString()}`);
    }
  } catch (error) {
    console.log("⚠️  Failed to read yUSD oracle price (likely not wired yet):", error);
  }

  const isAlreadyWhitelisted = await collateralVault.isCollateralSupported(yUSDAddress);

  if (isAlreadyWhitelisted) {
    console.log("✅ yUSD already whitelisted as collateral. Nothing to do.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  console.log("🔧 Whitelisting yUSD as dUSD collateral...");

  const opComplete = await executor.tryOrQueue(
    async () => {
      await collateralVault.allowCollateral(yUSDAddress);
      console.log("  ✅ yUSD whitelisted as collateral");
    },
    () => createAllowCollateralTransaction(collateralVaultAddress, yUSDAddress, collateralVault.interface),
  );

  if (!opComplete) {
    const flushed = await executor.flush("Whitelist yUSD as D collateral");

    if (executor.useSafe) {
      if (!flushed) {
        console.log("\n❌ Failed to prepare Safe transactions for yUSD collateral listing.");
      }
      console.log("\n⏳ yUSD collateral listing pending governance Safe execution.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }
  }

  console.log("\n✅ yUSD collateral enablement completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["yusd", "d-collateral", "usd-oracle"];
func.dependencies = ["point-usdc-usdt-yusd-oracles", D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID];
func.id = "enable-yusd-collateral";

export default func;
