import hre, { deployments } from "hardhat";

import { getConfig } from "../../config/config";

import {
  USD_ORACLE_AGGREGATOR_ID,
  D_ISSUER_V2_2_CONTRACT_ID,
  D_REDEEMER_CONTRACT_ID,
  D_COLLATERAL_VAULT_CONTRACT_ID,
  D_AMO_MANAGER_ID,
  D_AMO_DEBT_TOKEN_ID,
} from "../../typescript/deploy-ids";

export interface DStableFixtureConfig {
  symbol: "D";
  deploymentTag: string;
  issuerContractId: string;
  redeemerContractId: string;
  collateralVaultContractId: string;
  amoManagerId?: string;
  amoDebtTokenId?: string;
  oracleAggregatorId: string;
  peggedCollaterals: string[];
  yieldBearingCollaterals: string[];
}

// Create a fixture factory for any dstable based on its configuration
export const createDStableFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["local-setup", config.deploymentTag]); // Include local-setup to use the mock Oracle
    await ensureIssuerV2Deployment(config);
  });
};

export async function ensureIssuerV2Deployment(config: DStableFixtureConfig): Promise<void> {
  const issuerV2_2 = await deployments.getOrNull(config.issuerContractId);

  if (issuerV2_2) {
    return;
  }

  const { deployer } = await hre.getNamedAccounts();
  const cfg = await getConfig(hre);

  const { address: collateralVaultAddress } = await deployments.get(config.collateralVaultContractId);
  const { address: oracleAggregatorAddress } = await deployments.get(config.oracleAggregatorId);
  const dstableAddress = cfg.tokenAddresses[config.symbol];

  const deployment = await deployments.deploy(config.issuerContractId, {
    from: deployer,
    args: [collateralVaultAddress, dstableAddress, oracleAggregatorAddress],
    contract: "IssuerV2_2",
    autoMine: true,
    log: false,
  });

  const signer = await hre.ethers.getSigner(deployer);
  const dstable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", dstableAddress, signer);
  const MINTER_ROLE = await dstable.MINTER_ROLE();
  if (!(await dstable.hasRole(MINTER_ROLE, deployment.address))) {
    await dstable.grantRole(MINTER_ROLE, deployment.address);
  }
}

// Create an AMO fixture factory for any dstable based on its configuration
export const createDStableAmoV2Fixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    const baseFixture = createDStableFixture(config);
    await baseFixture(deployments);

    if (!config.amoManagerId || !config.amoDebtTokenId) {
      throw new Error(`AMO configuration missing for ${config.symbol}`);
    }

    await deployments.fixture(["amo-v2"]);
  });
};

// Predefined configurations
export const D_CONFIG: DStableFixtureConfig = {
  symbol: "D",
  deploymentTag: "dusd",
  issuerContractId: D_ISSUER_V2_2_CONTRACT_ID,
  redeemerContractId: D_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: D_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerId: D_AMO_MANAGER_ID,
  amoDebtTokenId: D_AMO_DEBT_TOKEN_ID,
  oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
  peggedCollaterals: ["frxUSD", "USDC", "USDS"], // USDC is interesting due to 6 decimals
  yieldBearingCollaterals: ["sfrxUSD", "sUSDS"],
};
