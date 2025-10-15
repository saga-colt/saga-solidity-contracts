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
 * @title IUniswapV3RepayAdapter
 * @notice Interface for Uniswap V3 repay adapter
 * @dev Defines functions for repaying debt with collateral using Uniswap V3
 */
interface IUniswapV3RepayAdapter is IBaseUniswapV3Adapter {
    /**
     * @notice Structure for repay with collateral parameters
     * @param user The user address performing the repay
     * @param collateralAsset The collateral asset address to swap from
     * @param debtRepayAsset The debt asset address to repay
     * @param maxCollateralAmountToSwap The maximum amount of collateral to swap
     * @param debtRepayAmount The amount of debt to repay
     * @param swapPath The encoded swap path (reversed for exact output)
     * @param withFlashLoan Whether to use flash loan for the swap
     * @param deadline The swap deadline timestamp
     */
    struct RepayParams {
        address user;
        address collateralAsset;
        address debtRepayAsset;
        uint256 maxCollateralAmountToSwap;
        uint256 debtRepayAmount;
        bytes swapPath;
        bool withFlashLoan;
        uint256 deadline;
    }

    /**
     * @notice Repays debt with collateral
     * @param repayParams The repay parameters
     * @param collateralATokenPermit The permit signature for collateral aToken
     */
    function repayWithCollateral(
        RepayParams memory repayParams,
        PermitInput memory collateralATokenPermit
    ) external;

}

