import hre, { deployments } from "hardhat";

import { getConfig } from "../../config/config";

import {
  USD_ORACLE_AGGREGATOR_ID,
  D_ISSUER_CONTRACT_ID,
  D_ISSUER_V2_1_CONTRACT_ID,
  D_REDEEMER_CONTRACT_ID,
  D_COLLATERAL_VAULT_CONTRACT_ID,
  D_AMO_MANAGER_ID,
} from "../../typescript/deploy-ids";
import { getTokenContractForSymbol } from "../../typescript/token/utils";

export interface DStableFixtureConfig {
  symbol: "D";
  deploymentTag: string;
  issuerContractId: string;
  redeemerContractId: string;
  collateralVaultContractId: string;
  amoManagerId: string;
  oracleAggregatorId: string;
  peggedCollaterals: string[];
  yieldBearingCollaterals: string[];
}

// Create a fixture factory for any dstable based on its configuration
export const createDStableFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["local-setup", config.deploymentTag]); // Include local-setup to use the mock Oracle
    await ensureIssuerV2_1Deployment(config);
  });
};

export async function ensureIssuerV2_1Deployment(config: DStableFixtureConfig): Promise<void> {
  const issuerV2_1 = await deployments.getOrNull(config.issuerContractId);

  if (issuerV2_1) {
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
    contract: "IssuerV2_1",
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
export const createDStableAmoFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    const standaloneMinimalFixture = createDStableFixture(config);
    await standaloneMinimalFixture(deployments);

    const { deployer } = await hre.getNamedAccounts();
    const { address: amoManagerAddress } = await deployments.get(config.amoManagerId);

    const { tokenInfo: dstableInfo } = await getTokenContractForSymbol(hre, deployer, config.symbol);

    const { address: oracleAggregatorAddress } = await deployments.get(config.oracleAggregatorId);

    // Deploy MockAmoVault using standard deployment
    await hre.deployments.deploy("MockAmoVault", {
      from: deployer,
      args: [dstableInfo.address, amoManagerAddress, deployer, deployer, deployer, oracleAggregatorAddress],
      autoMine: true,
      log: false,
    });
  });
};

// Predefined configurations
export const D_CONFIG: DStableFixtureConfig = {
  symbol: "D",
  deploymentTag: "dusd",
  issuerContractId: D_ISSUER_V2_1_CONTRACT_ID,
  redeemerContractId: D_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: D_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerId: D_AMO_MANAGER_ID,
  oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
  peggedCollaterals: ["frxUSD", "USDC", "USDS"], // USDC is interesting due to 6 decimals
  yieldBearingCollaterals: ["sfrxUSD", "sUSDS"],
};
