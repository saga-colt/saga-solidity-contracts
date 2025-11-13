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
 * @param collateralVaultAddress - Address of the CollateralVault to call
 * @param collateralAddress - Collateral token address to whitelist
 * @param collateralVaultInterface - Interface used to encode the Safe transaction data
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
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  // Initialize Saga governance executor
  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  // Get the CollateralVault contract
  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);

  // Get the OracleAggregator contract
  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorAddress, deployerSigner);

  console.log(`\n🔗 CollateralVault: ${collateralVaultAddress}`);
  console.log(`🔗 OracleAggregator: ${oracleAggregatorAddress}`);

  // Get sfrxUSD and USDN addresses from config
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;
  const usdnAddress = config.tokenAddresses.USDN;

  // Array of tokens to whitelist with defined addresses
  interface TokenInfo {
    name: string;
    address: string;
  }

  const tokensToWhitelist: TokenInfo[] = [];

  // Filter out zero addresses
  if (sfrxUSDAddress && sfrxUSDAddress !== ZeroAddress) {
    tokensToWhitelist.push({ name: "sfrxUSD", address: sfrxUSDAddress });
  }

  if (usdnAddress && usdnAddress !== ZeroAddress) {
    tokensToWhitelist.push({ name: "USDN", address: usdnAddress });
  }

  if (tokensToWhitelist.length === 0) {
    console.log("\nℹ️  No sfrxUSD or USDN tokens configured. Skipping whitelist.");
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
    } catch {
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
    const flushed = await executor.flush(`Whitelist sfrxUSD and USDN as D collaterals: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Collateral whitelisting requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["sfrxusd-usdn", "sfrxusd-usdn-collateral", "d"];
func.dependencies = ["d-collateral-vault", "point-sfrxusd-usdn-feeds-to-oracle-aggregator"];
func.id = "d-whitelist-sfrxusd-usdn-collateral";

export default func;
