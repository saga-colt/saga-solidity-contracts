import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  D_A_TOKEN_WRAPPER_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get config and token addresses
  const config = await getConfig(hre);
  const { tokenAddresses } = config;

  // Get dLend contracts
  const poolAddressesProvider = await deployments.getOrNull(
    POOL_ADDRESSES_PROVIDER_ID,
  );

  if (!poolAddressesProvider) {
    console.log(
      "PoolAddressesProvider not found, skipping aToken wrapper deployment",
    );
    return;
  }

  const poolAddressesProviderContract = await ethers.getContractAt(
    "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol:IPoolAddressesProvider",
    poolAddressesProvider.address,
  );

  const poolAddress = await poolAddressesProviderContract.getPool();
  const poolContract = await ethers.getContractAt(
    "contracts/dlend/core/interfaces/IPool.sol:IPool",
    poolAddress,
  );

  // Get rewards controller if available
  let rewardsControllerAddress = ethers.ZeroAddress;
  const rewardsController = await deployments.getOrNull(INCENTIVES_PROXY_ID);

  if (rewardsController) {
    rewardsControllerAddress = rewardsController.address;
  }

  // Get D aToken address
  let dAToken;

  try {
    const dReserveData = await poolContract.getReserveData(tokenAddresses.D);
    dAToken = dReserveData.aTokenAddress;
  } catch (error: any) {
    console.log(`Error getting d aToken: ${error.message}`);
    return;
  }

  // Deploy StaticATokenLM for d
  if (dAToken && dAToken !== ethers.ZeroAddress) {
    const dATokenContract = await ethers.getContractAt(
      "IERC20Detailed",
      dAToken,
    );
    const dATokenSymbol = await dATokenContract.symbol();

    // console.log(`Deploying StaticATokenLM wrapper for ${dATokenSymbol}...`);

    await deploy(D_A_TOKEN_WRAPPER_ID, {
      from: deployer,
      contract: "StaticATokenLM",
      args: [
        poolAddress,
        rewardsControllerAddress,
        dAToken,
        `Static ${dATokenSymbol}`,
        `stk${dATokenSymbol}`,
      ],
    });
  } else {
    console.log("d aToken not found or invalid, skipping wrapper deployment");
  }

  console.log(`🧧 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dStableATokenWrappers";
func.tags = ["d-aTokenWrapper"];
func.dependencies = ["dlend-static-wrapper-factory"];

export default func;
