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
 * @title IUniswapV3DebtSwapAdapter
 * @notice Interface for Uniswap V3 debt swap adapter
 * @dev Defines functions for swapping debt tokens using Uniswap V3
 */
interface IUniswapV3DebtSwapAdapter is IBaseUniswapV3Adapter {
    /**
     * @notice Structure for debt swap parameters
     * @param debtAsset The current debt asset address
     * @param newDebtAsset The new debt asset address
     * @param maxNewDebtAmount The maximum amount of new debt to borrow for the swap
     * @param debtRepayAmount The amount of current debt to repay
     * @param swapPath The encoded swap path (reversed for exact output)
     * @param withFlashLoan Whether to use flash loan for the swap
     * @param deadline The swap deadline timestamp
     */
    struct DebtSwapParams {
        address debtAsset;
        address newDebtAsset;
        uint256 maxNewDebtAmount;
        uint256 debtRepayAmount;
        bytes swapPath;
        bool withFlashLoan;
        uint256 deadline;
    }

    /**
     * @notice Swaps debt from one asset to another
     * @param debtSwapParams The debt swap parameters
     * @param debtTokenPermit The permit signature for debt token
     */
    function swapDebt(
        DebtSwapParams memory debtSwapParams,
        PermitInput memory debtTokenPermit
    ) external;

}

