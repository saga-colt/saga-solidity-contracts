import { ZeroAddress } from "ethers";
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

  // Get yUSD and vyUSD addresses from config
  const yUSDAddress = config.tokenAddresses.yUSD;
  const vyUSDAddress = config.tokenAddresses.vyUSD;

  // Array of tokens to whitelist with defined addresses
  interface TokenInfo {
    name: string;
    address: string;
  }

  const tokensToWhitelist: TokenInfo[] = [];

  // Filter out zero addresses
  if (yUSDAddress && yUSDAddress !== ZeroAddress) {
    tokensToWhitelist.push({ name: "yUSD", address: yUSDAddress });
  }

  if (vyUSDAddress && vyUSDAddress !== ZeroAddress) {
    tokensToWhitelist.push({ name: "vyUSD", address: vyUSDAddress });
  }

  if (tokensToWhitelist.length === 0) {
    console.log("\nℹ️  No yUSD or vyUSD tokens configured. Skipping whitelist.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (tokens not configured)`);
    return true;
  }

  // Sanity check: Verify that the oracle can provide a price for each asset (if oracles are set up)
  console.log("\n🔍 Performing oracle price sanity checks...");

  let allOraclesConfigured = true;

  for (const token of tokensToWhitelist) {
    console.log(`\n  📊 Checking oracle price for ${token.name} (${token.address})...`);

    try {
      const price = await oracleAggregator.getAssetPrice(token.address);

      if (price.toString() === "0") {
        console.log(`    ⚠️  Oracle price for ${token.name} is zero or not configured yet`);
        allOraclesConfigured = false;
      } else {
        console.log(`    ✅ Oracle price for ${token.name}: ${price.toString()}`);
      }
    } catch (error) {
      console.log(`    ⚠️  Oracle not configured for ${token.name} (previous Safe txs not executed yet)`);
      allOraclesConfigured = false;
    }
  }

  if (!allOraclesConfigured) {
    console.log("\n⏭️  Oracle feeds not fully configured yet. Proceeding with whitelist anyway.");
    console.log("    Oracle sanity checks will run when you re-run this script after executing Safe transactions.");
  }

  // Whitelist each valid token
  console.log("\n🏷️  Whitelisting collaterals...");

  let allOperationsComplete = true;

  for (const token of tokensToWhitelist) {
    console.log(`\n📝 Processing ${token.name} (${token.address})...`);

    // Check if the token is already whitelisted
    const isAlreadyWhitelisted = await collateralVault.isCollateralSupported(token.address);

    if (isAlreadyWhitelisted) {
      console.log(`  ✅ ${token.name} is already whitelisted as collateral. Skipping.`);
      continue;
    }

    // Whitelist the token
    console.log(`\n  🔧 Whitelisting ${token.name} as collateral...`);

    const opComplete = await executor.tryOrQueue(
      async () => {
        await collateralVault.allowCollateral(token.address);
        console.log(`    ✅ ${token.name} whitelisted as collateral`);
      },
      () => createAllowCollateralTransaction(collateralVaultAddress, token.address, collateralVault.interface),
    );

    if (!opComplete) {
      allOperationsComplete = false;
    }
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Whitelist yUSD and vyUSD as D collaterals`);

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

  console.log("\n✅ All collateral enablement operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["yusd-vyusd", "yusd-vyusd-collateral", "d-collateral"];
func.dependencies = [D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID];
func.id = "d-whitelist-yusd-vyusd-collateral";

export default func;

