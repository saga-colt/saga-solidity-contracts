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
import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { BaseUniswapV3SwapAdapter } from "./BaseUniswapV3SwapAdapter.sol";
import { UniswapV3SwapUtils } from "./libraries/UniswapV3SwapUtils.sol";

/**
 * @title BaseUniswapV3BuyAdapter
 * @notice Base contract for Uniswap V3 adapters that perform exact output (buy) swaps
 * @dev Provides functionality for swapping a maximum amount of input tokens for a specific amount of output tokens
 */
abstract contract BaseUniswapV3BuyAdapter is BaseUniswapV3SwapAdapter {
    /**
     * @dev Implementation of virtual function from OracleValidation
     * @return The addresses provider instance
     */
    function _getAddressesProvider() internal view virtual override returns (IPoolAddressesProvider) {
        return ADDRESSES_PROVIDER;
    }

    /**
     * @notice Executes an exact output swap on Uniswap V3
     * @param assetToSwapFrom The input token
     * @param assetToSwapTo The output token
     * @param maxAmountToSpend The maximum amount of input tokens to spend
     * @param amountToReceive The exact amount of output tokens to receive
     * @param swapPath The encoded swap path (reversed for exact output)
     * @param deadline The deadline for the swap
     * @return amountSpent The actual amount of input tokens spent
     */
    function _buyOnUniswapV3(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 maxAmountToSpend,
        uint256 amountToReceive,
        bytes memory swapPath,
        uint256 deadline
    ) internal virtual returns (uint256 amountSpent) {
        _validateSwapAmount(amountToReceive);
        _validateSwapPath(swapPath);
        _validateDeadline(deadline);
        _validateOraclePriceExactOutput(
            address(assetToSwapFrom),
            address(assetToSwapTo),
            maxAmountToSpend,
            amountToReceive
        );

        // Validation of input balance, output amount, and deadline are done in executeExactOutputSwap
        amountSpent = UniswapV3SwapUtils.executeExactOutputSwap(
            SWAP_ROUTER,
            assetToSwapFrom,
            assetToSwapTo,
            maxAmountToSpend,
            amountToReceive,
            swapPath,
            deadline
        );

        emit Sold(address(assetToSwapFrom), address(assetToSwapTo), amountSpent, amountToReceive);
    }
}

