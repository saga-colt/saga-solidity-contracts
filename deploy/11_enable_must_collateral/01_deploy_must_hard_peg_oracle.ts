import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { MUST_HARD_PEG_ORACLE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  // Get MUST token address from config
  const mustAddress = config.tokenAddresses.MUST;

  if (!mustAddress || mustAddress === "") {
    console.log("\nℹ️  MUST token not configured. Skipping deployment.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (token not configured)`);
    return true;
  }

  console.log(`\n📊 MUST token address: ${mustAddress}`);

  // Calculate price: $0.995 in 18 decimals = 995000000000000000
  const MUST_PRICE = hre.ethers.parseUnits("0.995", 18);
  console.log(`💰 Hardcoded price: $0.995 (${MUST_PRICE.toString()} in 18 decimals)`);

  // Check if already deployed (idempotency)
  const existingDeployment = await hre.deployments.getOrNull(MUST_HARD_PEG_ORACLE_WRAPPER_ID);

  if (existingDeployment) {
    console.log(`\n✅ HardPegOracleWrapper for MUST already deployed at: ${existingDeployment.address}`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (already deployed)`);
    return true;
  }

  // Deploy HardPegOracleWrapper
  console.log("\n🚀 Deploying HardPegOracleWrapper for MUST token...");

  const deployment = await hre.deployments.deploy(MUST_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.USD.baseCurrency, // USD as base currency (address 0)
      BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals), // Base currency unit (10^18)
      MUST_PRICE, // Price peg: $0.995
    ],
    contract: "HardPegOracleWrapper",
    autoMine: true,
    log: true,
  });

  console.log(`\n✅ HardPegOracleWrapper deployed at: ${deployment.address}`);

  // Verify deployment by checking the price
  const hardPegWrapper = await hre.ethers.getContractAt("HardPegOracleWrapper", deployment.address);
  const deployedPrice = await hardPegWrapper.pricePeg();
  console.log(`\n🔍 Verified deployed price: ${deployedPrice.toString()}`);

  if (deployedPrice.toString() !== MUST_PRICE.toString()) {
    throw new Error(`Price mismatch: expected ${MUST_PRICE.toString()}, got ${deployedPrice.toString()}`);
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["must", "must-oracle", "d-oracle"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];
func.id = MUST_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
