import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import hre from "hardhat";

import { AAVE_ORACLE_USD_DECIMALS } from "../../config/constants";
import WadRayMath from "../maths/WadRayMath";
import { fetchTokenInfo, TokenInfo } from "../token/info";
import { getAaveProtocolDataProviderAddressFromParent } from "./data_provider";
import { getOraclePrice } from "./oracle";
import { getPoolContractAddress } from "./pool";

export interface UserReserveInfo {
  userAddress: string;
  reserveAddress: string;
  totalSupply: BigNumber;
  totalDebt: BigNumber;
  priceInUSD: BigNumberish;
  priceDecimals: number;
  reserveTokenInfo: TokenInfo;
  liquidationBonus: BigNumber;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
}

/**
 * Get the user reserve information
 *
 * @param userAddress - Address of the user
 * @param reserveAddress - Address of the reserve
 * @returns The user reserve information
 */
export async function getUserReserveInfo(
  userAddress: string,
  reserveAddress: string,
): Promise<UserReserveInfo> {
  const { deployer } = await hre.getNamedAccounts();
  const [
    totalSupply,
    totalDebt,
    priceInUSD,
    reserveTokenInfo,
    { liquidationBonus, usageAsCollateralEnabled, borrowingEnabled },
  ] = await Promise.all([
    getUserSupplyBalance(reserveAddress, userAddress),
    getUserDebtBalance(reserveAddress, userAddress),
    getOraclePrice(deployer, reserveAddress),
    fetchTokenInfo(hre, reserveAddress),
    getReserveConfigurationData(reserveAddress),
  ]);

  return {
    userAddress,
    reserveAddress,
    totalSupply,
    totalDebt,
    priceInUSD,
    priceDecimals: AAVE_ORACLE_USD_DECIMALS,
    reserveTokenInfo,
    liquidationBonus: BigNumber.from(liquidationBonus),
    usageAsCollateralEnabled,
    borrowingEnabled,
  };
}

/**
 * Get the reserve tokens addresses from the address
 *
 * @param underlyingTokenAddress - The address of the underlying token
 * @returns The reserve token addresses
 */
export async function getReserveTokensAddressesFromAddress(
  underlyingTokenAddress: string,
): Promise<{
  aTokenAddress: string;
  stableDebtTokenAddress: string;
  variableDebtTokenAddress: string;
}> {
  const dataProviderAddress =
    await getAaveProtocolDataProviderAddressFromParent(hre);
  const dataProviderContract = await hre.ethers.getContractAt(
    [
      "function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
    ],
    dataProviderAddress,
  );

  const borrowTokenInfo = await fetchTokenInfo(hre, underlyingTokenAddress);

  const { aTokenAddress, stableDebtTokenAddress, variableDebtTokenAddress } =
    await dataProviderContract.getReserveTokensAddresses(
      borrowTokenInfo.address,
    );

  return {
    aTokenAddress,
    stableDebtTokenAddress,
    variableDebtTokenAddress,
  };
}

/**
 * Get the reserve configuration data
 *
 * @param tokenAddress - The token address
 * @returns - The reserve configuration data
 */
export async function getReserveConfigurationData(
  tokenAddress: string,
): Promise<{
  decimals: bigint;
  ltv: bigint;
  liquidationThreshold: bigint;
  liquidationBonus: bigint; // 10500 means 105%
  reserveFactor: bigint;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  stableBorrowRateEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
}> {
  const dataProviderAddress =
    await getAaveProtocolDataProviderAddressFromParent(hre);
  const dataProviderContract = await hre.ethers.getContractAt(
    [
      "function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
    ],
    dataProviderAddress,
  );

  const {
    decimals,
    ltv,
    liquidationThreshold,
    liquidationBonus,
    reserveFactor,
    usageAsCollateralEnabled,
    borrowingEnabled,
    stableBorrowRateEnabled,
    isActive,
    isFrozen,
  } = await dataProviderContract.getReserveConfigurationData(tokenAddress);

  return {
    decimals,
    ltv,
    liquidationThreshold,
    liquidationBonus,
    reserveFactor,
    usageAsCollateralEnabled,
    borrowingEnabled,
    stableBorrowRateEnabled,
    isActive,
    isFrozen,
  };
}

/**
 * Get the user supply balance of the asset
 * - Reference: https://github.com/stablyio/trinity-solidity-contracts/blob/a6672fbeea4cb7242d242dc19054819c103a0b8b/contracts/lending/core/protocol/libraries/logic/GenericLogic.sol#L282-L299
 *
 * @param assetAddress - The address of the asset
 * @param userAddress - The address of the user
 * @returns - The user supply balance of the asset
 */
export async function getUserSupplyBalance(
  assetAddress: string,
  userAddress: string,
): Promise<BigNumber> {
  const { deployer } = await hre.getNamedAccounts();

  const { aTokenAddress } =
    await getReserveTokensAddressesFromAddress(assetAddress);
  const poolAddress = await getPoolContractAddress();
  const aTokenContract = await hre.ethers.getContractAt(
    ["function scaledBalanceOf(address user) public view returns (uint256)"],
    aTokenAddress,
    await hre.ethers.getSigner(deployer),
  );
  const poolContract = await hre.ethers.getContractAt(
    [
      "function getReserveNormalizedIncome(address asset) public view returns (uint256)",
    ],
    poolAddress,
    await hre.ethers.getSigner(deployer),
  );

  const [normalizedIncome, scaleBalance] = await Promise.all([
    poolContract.getReserveNormalizedIncome(assetAddress),
    aTokenContract.scaledBalanceOf(userAddress),
  ]);

  return WadRayMath.rayMul(scaleBalance, normalizedIncome);
}

/**
 * Get the user debt balance of the asset
 * - Reference: https://github.com/stablyio/trinity-solidity-contracts/blob/a6672fbeea4cb7242d242dc19054819c103a0b8b/contracts/lending/core/protocol/libraries/logic/GenericLogic.sol#L247-L270
 *
 * @param assetAddress - The address of the asset
 * @param userAddress - The address of the user
 * @returns - The user debt balance of the asset
 */
export async function getUserDebtBalance(
  assetAddress: string,
  userAddress: string,
): Promise<BigNumber> {
  const { deployer } = await hre.getNamedAccounts();

  const { stableDebtTokenAddress, variableDebtTokenAddress } =
    await getReserveTokensAddressesFromAddress(assetAddress);
  const poolAddress = await getPoolContractAddress();
  const poolContract = await hre.ethers.getContractAt(
    [
      "function getReserveNormalizedVariableDebt(address asset) public view returns (uint256)",
    ],
    poolAddress,
    await hre.ethers.getSigner(deployer),
  );

  const variableDebtTokenContract = await hre.ethers.getContractAt(
    ["function scaledBalanceOf(address user) public view returns (uint256)"],
    variableDebtTokenAddress,
    await hre.ethers.getSigner(deployer),
  );

  const userVariableDebt = await (async (): Promise<bigint> => {
    const scaledDebtBalance =
      await variableDebtTokenContract.scaledBalanceOf(userAddress);

    if (!BigNumber.from(scaledDebtBalance).isZero()) {
      const normalizeDebt =
        await poolContract.getReserveNormalizedVariableDebt(assetAddress);
      return WadRayMath.rayMul(scaledDebtBalance, normalizeDebt).toBigInt();
    }
    return scaledDebtBalance;
  })();

  const stableDebtTokenContract = await hre.ethers.getContractAt(
    ["function balanceOf(address user) public view returns (uint256)"],
    stableDebtTokenAddress,
    await hre.ethers.getSigner(userAddress),
  );

  const stableDebtBalance =
    await stableDebtTokenContract.balanceOf(userAddress);
  return BigNumber.from(userVariableDebt).add(stableDebtBalance);
}

/**
 * Get the list of registered reserve tokens on the Lending pool
 *
 * @param poolAddress - The address of the Lending pool
 * @returns - The list of registered reserve tokens on the Lending pool
 */
export async function getReservesList(poolAddress: string): Promise<string[]> {
  const poolContract = await hre.ethers.getContractAt(
    ["function getReservesList() external view returns (address[] memory)"],
    poolAddress,
  );

  return await poolContract.getReservesList();
}

/**
 * Check if a reserve can be used as collateral
 *
 * @param reserveAddress - The reserve address
 * @returns True if the reserve can be used as collateral
 */
export async function isCollateralEnabled(
  reserveAddress: string,
): Promise<boolean> {
  const config = await getReserveConfigurationData(reserveAddress);
  return BigNumber.from(config.ltv).gt(0n);
}
