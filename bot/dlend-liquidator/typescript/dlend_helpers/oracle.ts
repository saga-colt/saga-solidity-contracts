import { BigNumberish } from "ethers";
import hre from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig } from "../../config/config";

/**
 * Get the Aave oracle address from the parent deployment
 *
 * @param hre - The Hardhat runtime environment
 * @returns The Aave oracle address
 */
export async function getAaveOracleAddressFromParent(
  hre: HardhatRuntimeEnvironment,
): Promise<string> {
  const config = await getConfig(hre);
  const oracleAddress = config.parentDeploymentAddresses?.aaveOracle;

  if (!oracleAddress) {
    throw new Error("Oracle address not found");
  }

  return oracleAddress;
}

/**
 * Get the price of an asset from the Aave oracle
 *
 * @param callerAddress The address of the caller
 * @param tokenAddress The address of the token to get price for
 * @returns The price of the asset with 8 decimals
 */
export async function getOraclePrice(
  callerAddress: string,
  tokenAddress: string,
): Promise<BigNumberish> {
  const oracleAddress = await getAaveOracleAddressFromParent(hre);
  const oracleContract = await hre.ethers.getContractAt(
    ["function getAssetPrice(address asset) external view returns (uint256)"],
    oracleAddress,
    await hre.ethers.getSigner(callerAddress),
  );

  return await oracleContract.getAssetPrice(tokenAddress);
}
