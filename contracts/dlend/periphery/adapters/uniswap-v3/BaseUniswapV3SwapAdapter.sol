// SPDX-License-Identifier: AGPL-3.0
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { IPool } from "contracts/dlend/core/interfaces/IPool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ISwapRouter } from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import { OracleValidation } from "contracts/common/OracleValidation.sol";
import { Pausable } from "contracts/common/Pausable.sol";
import { Rescuable } from "contracts/common/Rescuable.sol";
import { IBaseUniswapV3Adapter } from "./interfaces/IBaseUniswapV3Adapter.sol";

/**
 * @title BaseUniswapV3SwapAdapter
 * @notice Base contract for Uniswap V3 swap adapters
 * @dev Provides common functionality for all Uniswap V3 swap adapters
 * - Oracle price validation
 * - Pausable functionality
 * - Asset rescue capability
 * - Common validations and utilities
 */
abstract contract BaseUniswapV3SwapAdapter is
    IBaseUniswapV3Adapter,
    OracleValidation,
    Pausable,
    Rescuable
{
    using SafeERC20 for IERC20;

    /// @notice The Aave Pool Addresses Provider
    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;

    /// @notice The Aave Pool
    IPool public immutable POOL;

    /// @notice The Uniswap V3 Swap Router
    ISwapRouter public immutable SWAP_ROUTER;

    /**
     * @dev Constructor
     * @param addressesProvider The address of the Aave PoolAddressesProvider contract
     * @param pool The address of the Aave Pool contract
     * @param swapRouter The address of the Uniswap V3 SwapRouter contract
     */
    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        ISwapRouter swapRouter
    ) {
        ADDRESSES_PROVIDER = addressesProvider;
        POOL = IPool(pool);
        SWAP_ROUTER = swapRouter;
    }

    /**
     * @notice Validates the swap amount
     * @param amount The amount to validate
     */
    function _validateSwapAmount(uint256 amount) internal pure {
        if (amount == 0) {
            revert InvalidSwapAmount(amount);
        }
    }

    /**
     * @notice Validates the swap path
     * @param path The swap path to validate
     */
    function _validateSwapPath(bytes memory path) internal pure {
        if (path.length == 0) {
            revert InvalidSwapPath();
        }
    }

    /**
     * @notice Validates the deadline
     * @param deadline The deadline to validate
     */
    function _validateDeadline(uint256 deadline) internal view {
        if (block.timestamp > deadline) {
            revert DeadlineExpired(deadline, block.timestamp);
        }
    }

    /**
     * @notice Pulls aToken from user and withdraws the underlying asset from the Pool
     * @param asset The underlying asset address
     * @param user The user address
     * @param amount The amount to pull
     * @param permit The permit signature for the aToken
     * @return The amount of underlying asset withdrawn
     */
    function _pullATokenAndWithdraw(
        address asset,
        address user,
        uint256 amount,
        PermitInput memory permit
    ) internal returns (uint256) {
        // Handle permit if provided
        if (permit.deadline != 0) {
            permit.aToken.permit(
                user,
                address(this),
                permit.value,
                permit.deadline,
                permit.v,
                permit.r,
                permit.s
            );
        }

        // Get the aToken for this asset
        (, , address aToken) = _getReserveData(asset);

        // Pull aToken from user
        uint256 aTokenBalanceBefore = IERC20(aToken).balanceOf(address(this));
        IERC20(aToken).safeTransferFrom(user, address(this), amount);
        uint256 aTokenBalanceDiff = IERC20(aToken).balanceOf(address(this)) - aTokenBalanceBefore;

        // Withdraw underlying asset from Pool
        uint256 assetBalanceBefore = IERC20(asset).balanceOf(address(this));
        POOL.withdraw(asset, aTokenBalanceDiff, address(this));
        uint256 assetBalanceDiff = IERC20(asset).balanceOf(address(this)) - assetBalanceBefore;

        return assetBalanceDiff;
    }

    /**
     * @notice Conditionally renews the allowance for an asset if below the required amount
     * @param asset The asset address
     * @param minAmount The minimum required allowance
     */
    function _conditionalRenewAllowance(address asset, uint256 minAmount) internal {
        uint256 allowance = IERC20(asset).allowance(address(this), address(POOL));
        if (allowance < minAmount) {
            // Reset to 0 first if allowance is non-zero (for tokens like USDT)
            if (allowance > 0) {
                IERC20(asset).approve(address(POOL), 0);
            }
            IERC20(asset).approve(address(POOL), type(uint256).max);
        }
    }

    /**
     * @dev Must be implemented by derived contracts to get reserve data
     * @param asset The asset address
     * @return vToken The variable debt token address
     * @return sToken The stable debt token address
     * @return aToken The aToken address
     */
    function _getReserveData(address asset) internal view virtual returns (address, address, address);

    /**
     * @dev Must be implemented by derived contracts to supply assets to the Pool
     * @param asset The asset to supply
     * @param amount The amount to supply
     * @param to The address to supply on behalf of
     * @param referralCode The referral code
     */
    function _supply(address asset, uint256 amount, address to, uint16 referralCode) internal virtual;
}

