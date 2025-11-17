import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  D_AMO_DEBT_TOKEN_ID,
  D_AMO_MANAGER_ID,
  D_COLLATERAL_VAULT_CONTRACT_ID,
  D_HARD_PEG_ORACLE_WRAPPER_ID,
  D_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const dstableAddress = config.tokenAddresses.D;

  if (!dstableAddress) {
    throw new Error("Saga Dollar address missing from config");
  }

  console.log(`\n≻ Deploying AMO debt stack...`);

  const debtTokenDeployment = await hre.deployments.deploy(D_AMO_DEBT_TOKEN_ID, {
    from: deployer,
    contract: "AmoDebtToken",
    args: ["dTRINITY AMO Receipt", "amo-D"],
    log: true,
    autoMine: true,
  });

  console.log(`   ↳ AmoDebtToken deployed at ${debtTokenDeployment.address}`);

  const { address: hardPegWrapperAddress } = await hre.deployments.get(D_HARD_PEG_ORACLE_WRAPPER_ID);
  const oracle = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorAddress, deployerSigner);
  const oracleManagerRole = await oracle.ORACLE_MANAGER_ROLE();

  if (!(await oracle.hasRole(oracleManagerRole, deployer))) {
    throw new Error("Deployer is missing ORACLE_MANAGER_ROLE on OracleAggregator");
  }
  await oracle.setOracle(debtTokenDeployment.address, hardPegWrapperAddress);
  console.log(`   ↳ Hard peg oracle configured for AmoDebtToken`);

  const amoManagerDeployment = await hre.deployments.deploy(D_AMO_MANAGER_ID, {
    from: deployer,
    contract: "AmoManagerV2",
    args: [oracleAggregatorAddress, debtTokenDeployment.address, dstableAddress, collateralVaultAddress],
    log: true,
    autoMine: true,
  });
  console.log(`   ↳ AmoManagerV2 deployed at ${amoManagerDeployment.address}`);

  const dstable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", dstableAddress, deployerSigner);
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);
  const debtToken = await hre.ethers.getContractAt("AmoDebtToken", debtTokenDeployment.address, deployerSigner);
  const amoManager = await hre.ethers.getContractAt("AmoManagerV2", amoManagerDeployment.address, deployerSigner);

  const MINTER_ROLE = await dstable.MINTER_ROLE();

  if (!(await dstable.hasRole(MINTER_ROLE, amoManagerDeployment.address))) {
    await dstable.grantRole(MINTER_ROLE, amoManagerDeployment.address);
  }

  const COLLATERAL_WITHDRAWER_ROLE = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();

  if (!(await collateralVault.hasRole(COLLATERAL_WITHDRAWER_ROLE, amoManagerDeployment.address))) {
    await collateralVault.grantRole(COLLATERAL_WITHDRAWER_ROLE, amoManagerDeployment.address);
  }

  const AMO_MANAGER_ROLE = await debtToken.AMO_MANAGER_ROLE();

  if (!(await debtToken.hasRole(AMO_MANAGER_ROLE, amoManagerDeployment.address))) {
    await debtToken.grantRole(AMO_MANAGER_ROLE, amoManagerDeployment.address);
  }

  if (!(await debtToken.isAllowlisted(collateralVaultAddress))) {
    await debtToken.setAllowlisted(collateralVaultAddress, true);
  }

  if (!(await debtToken.isAllowlisted(amoManagerDeployment.address))) {
    await debtToken.setAllowlisted(amoManagerDeployment.address, true);
  }

  if (!(await collateralVault.isCollateralSupported(debtTokenDeployment.address))) {
    await collateralVault.allowCollateral(debtTokenDeployment.address);
  }

  if ((await amoManager.collateralVault()) !== collateralVaultAddress) {
    await amoManager.setCollateralVault(collateralVaultAddress);
  }

  const governanceWallet = config.walletAddresses.governanceMultisig;

  if (governanceWallet && !(await amoManager.isAmoWalletAllowed(governanceWallet))) {
    await amoManager.setAmoWalletAllowed(governanceWallet, true);
  }

  if (!(await amoManager.isAmoWalletAllowed(deployer))) {
    await amoManager.setAmoWalletAllowed(deployer, true);
  }

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = D_AMO_MANAGER_ID;
func.tags = ["d", "amo-v2"];
func.dependencies = [D_TOKEN_ID, D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID, D_HARD_PEG_ORACLE_WRAPPER_ID];

export default func;
