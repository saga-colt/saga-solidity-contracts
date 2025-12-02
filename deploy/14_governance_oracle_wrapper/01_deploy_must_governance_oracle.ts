import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { MUST_GOVERNANCE_ORACLE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

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

  // Initial price: $0.995 in 18 decimals
  const MUST_INITIAL_PRICE = hre.ethers.parseUnits("0.995", 18);
  console.log(`💰 Initial price: $0.995 (${MUST_INITIAL_PRICE.toString()} in 18 decimals)`);

  // Check idempotency
  const existingDeployment = await hre.deployments.getOrNull(MUST_GOVERNANCE_ORACLE_WRAPPER_ID);

  if (existingDeployment) {
    console.log(`\n✅ GovernanceOracleWrapper for MUST already deployed at: ${existingDeployment.address}`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (already deployed)`);
    return true;
  }

  // Deploy GovernanceOracleWrapper
  console.log("\n🚀 Deploying GovernanceOracleWrapper for MUST token...");

  const deployment = await hre.deployments.deploy(MUST_GOVERNANCE_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.USD.baseCurrency, // USD as base (address 0)
      BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals), // 10^18
      MUST_INITIAL_PRICE, // $0.995
    ],
    contract: "GovernanceOracleWrapper",
    autoMine: true,
    log: true,
  });

  console.log(`\n✅ GovernanceOracleWrapper deployed at: ${deployment.address}`);

  // Verify deployment
  const wrapper = await hre.ethers.getContractAt("GovernanceOracleWrapper", deployment.address);

  const deployedPrice = await wrapper.price();
  const bpsTolerance = await wrapper.bpsTolerance();
  const maxStaleness = await wrapper.maxStaleness();

  console.log(`\n🔍 Verified deployment:`);
  console.log(`   Price: ${deployedPrice.toString()}`);
  console.log(`   BPS Tolerance: ${bpsTolerance} (0.0${bpsTolerance}%)`);
  console.log(`   Max Staleness: ${maxStaleness / 86400n} days`);

  if (deployedPrice.toString() !== MUST_INITIAL_PRICE.toString()) {
    throw new Error(`Price mismatch: expected ${MUST_INITIAL_PRICE.toString()}, got ${deployedPrice.toString()}`);
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["must", "must-oracle", "d-oracle", "governance-oracle"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];
func.id = MUST_GOVERNANCE_ORACLE_WRAPPER_ID;

export default func;
