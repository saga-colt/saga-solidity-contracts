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
 * @title IUniswapV3WithdrawSwapAdapter
 * @notice Interface for Uniswap V3 withdraw swap adapter
 * @dev Defines functions for withdrawing and swapping collateral using Uniswap V3
 */
interface IUniswapV3WithdrawSwapAdapter is IBaseUniswapV3Adapter {
    /**
     * @notice Structure for withdraw swap parameters
     * @param user The user address performing the withdraw and swap
     * @param oldAsset The collateral asset address to withdraw
     * @param newAsset The asset to swap to
     * @param oldAssetAmount The amount of collateral to withdraw
     * @param minAmountToReceive The minimum amount of output asset to receive
     * @param swapPath The encoded swap path
     * @param deadline The swap deadline timestamp
     */
    struct WithdrawSwapParams {
        address user;
        address oldAsset;
        address newAsset;
        uint256 oldAssetAmount;
        uint256 minAmountToReceive;
        bytes swapPath;
        uint256 deadline;
    }

    /**
     * @notice Withdraws collateral and swaps to another asset
     * @param withdrawSwapParams The withdraw swap parameters
     * @param permitInput The permit signature for aToken
     */
    function withdrawAndSwap(
        WithdrawSwapParams memory withdrawSwapParams,
        PermitInput memory permitInput
    ) external;

}

