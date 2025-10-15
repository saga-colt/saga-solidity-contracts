import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { PRICE_ORACLE_ID, UI_INCENTIVE_DATA_PROVIDER_ID, UI_POOL_DATA_PROVIDER_ID } from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const config = await getConfig(hre);

  if (!config.dLend) {
    console.log("No dLend configuration found for this network. Skipping dLend deployment.");
    return true;
  }

  const sagaAddress = config.tokenAddresses.SAGA || config.tokenAddresses.WSAGA; // WSAGA as fallback for other environments

  if (!sagaAddress) {
    console.log("Neither SAGA nor WSAGA is configured for this network.");
    return false;
  }

  // Get the Aave price oracle address
  const priceOracle = await deployments.get(PRICE_ORACLE_ID);

  // Deploy UiIncentiveDataProvider first
  await deploy(UI_INCENTIVE_DATA_PROVIDER_ID, {
    from: deployer,
    args: [], // No constructor arguments needed
    log: true,
    waitConfirmations: 1,
  });

  // Then deploy UiPoolDataProvider
  await deploy(UI_POOL_DATA_PROVIDER_ID, {
    from: deployer,
    args: [priceOracle.address, sagaAddress], // Use price oracle and SAGA or WSAGA
    log: true,
    waitConfirmations: 1,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["PoolAddressesProvider", "deploy_oracles"];
func.id = "dLend:UiPoolDataProviderV3";

export default func;
