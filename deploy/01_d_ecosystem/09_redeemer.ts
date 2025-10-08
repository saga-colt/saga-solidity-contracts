import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { D_COLLATERAL_VAULT_CONTRACT_ID, D_REDEEMER_CONTRACT_ID, D_TOKEN_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;
  const config = await getConfig(hre);

  // Check all required configuration values at the top
  const dConfig = config.dStables.D;

  const missingConfigs: string[] = [];

  // Check D configuration
  if (!dConfig?.initialFeeReceiver || !isAddress(dConfig.initialFeeReceiver)) {
    missingConfigs.push("dStables.D.initialFeeReceiver");
  }

  if (dConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.D.initialRedemptionFeeBps");
  }

  // If any required config values are missing, skip deployment
  if (missingConfigs.length > 0) {
    console.log(`⚠️  Skipping RedeemerV2 deployment - missing configuration values: ${missingConfigs.join(", ")}`);
    console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipped)`);
    return true;
  }

  // Deploy RedeemerV2 for d
  const dToken = await get(D_TOKEN_ID);
  const dCollateralVaultDeployment = await get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const usdOracleAggregator = await get(USD_ORACLE_AGGREGATOR_ID);

  const dRedeemerV2Deployment = await deploy(D_REDEEMER_CONTRACT_ID, {
    from: deployer,
    contract: "RedeemerV2",
    args: [
      dCollateralVaultDeployment.address,
      dToken.address,
      usdOracleAggregator.address,
      dConfig.initialFeeReceiver,
      dConfig.initialRedemptionFeeBps,
    ],
  });

  const dCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dCollateralVaultDeployment.address,
    await hre.ethers.getSigner(deployer),
  );
  const dWithdrawerRole = await dCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dHasRole = await dCollateralVaultContract.hasRole(dWithdrawerRole, dRedeemerV2Deployment.address);

  if (!dHasRole) {
    console.log("Granting role for d RedeemerV2.");
    await dCollateralVaultContract.grantRole(dWithdrawerRole, dRedeemerV2Deployment.address);
    console.log("Role granted for d RedeemerV2.");
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = D_REDEEMER_CONTRACT_ID;
func.tags = ["d"];
func.dependencies = [D_COLLATERAL_VAULT_CONTRACT_ID, D_TOKEN_ID, "usd-oracle"];

export default func;
