import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { POOL_ADDRESS_PROVIDER_REGISTRY_ID } from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  if (!config.dLend) {
    console.log(
      "No dLend configuration found for this network. Skipping dLend deployment.",
    );
    return true;
  }

  // Deploy the PoolAddressesProviderRegistry contract
  await hre.deployments.deploy(POOL_ADDRESS_PROVIDER_REGISTRY_ID, {
    from: deployer,
    args: [deployer],
    contract: "PoolAddressesProviderRegistry",
    autoMine: true,
    log: false,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  // Return true to indicate deployment success
  return true;
};

func.id = "dLend:PoolAddressesProviderRegistry";
func.tags = ["dlend", "dlend-core"];
func.dependencies = ["d"];

export default func;
