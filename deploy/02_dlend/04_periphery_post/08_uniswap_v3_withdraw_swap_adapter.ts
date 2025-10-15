import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID, POOL_PROXY_ID } from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.dLend) {
    console.log("No dLend configuration found for this network. Skipping dLend deployment.");
    return true;
  }

  if (!config.uniswapRouter) {
    console.log("Uniswap Router not configured for this network. Skipping UniswapV3WithdrawSwapAdapter deployment.");
    return true;
  }

  // Get required addresses
  const poolAddressesProvider = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const pool = await deployments.get(POOL_PROXY_ID);

  // Deploy UniswapV3WithdrawSwapAdapter
  await deploy("UniswapV3WithdrawSwapAdapter", {
    from: deployer,
    args: [
      poolAddressesProvider.address,
      pool.address,
      config.uniswapRouter,
      deployer, // owner
    ],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`🔄 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.tags = ["dlend", "dlend-periphery-post", "uniswap-adapters"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "PoolAddressesProvider"];
func.id = "dLend:UniswapV3WithdrawSwapAdapter";

export default func;

