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

import { IBaseUniswapV3Adapter } from "./IBaseUniswapV3Adapter.sol";

/**
 * @title IUniswapV3LiquiditySwapAdapter
 * @notice Interface for Uniswap V3 liquidity swap adapter
 * @dev Defines functions for swapping collateral from one asset to another using Uniswap V3
 */
interface IUniswapV3LiquiditySwapAdapter is IBaseUniswapV3Adapter {
    /**
     * @notice Structure for liquidity swap parameters
     * @param collateralAsset The current collateral asset address
     * @param newCollateralAsset The new collateral asset address
     * @param collateralAmountToSwap The amount of current collateral to swap
     * @param newCollateralAmount The minimum amount of new collateral to receive
     * @param swapPath The encoded swap path
     * @param withFlashLoan Whether to use flash loan for the swap
     * @param deadline The swap deadline timestamp
     */
    struct LiquiditySwapParams {
        address collateralAsset;
        address newCollateralAsset;
        uint256 collateralAmountToSwap;
        uint256 newCollateralAmount;
        bytes swapPath;
        bool withFlashLoan;
        uint256 deadline;
    }

    /**
     * @notice Swaps liquidity from one collateral asset to another
     * @param liquiditySwapParams The liquidity swap parameters
     * @param collateralATokenPermit The permit signature for collateral aToken
     */
    function swapLiquidity(
        LiquiditySwapParams memory liquiditySwapParams,
        PermitInput memory collateralATokenPermit
    ) external;

}

