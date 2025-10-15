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
 * @title BaseUniswapV3SellAdapter
 * @notice Base contract for Uniswap V3 adapters that perform exact input (sell) swaps
 * @dev Provides functionality for swapping a specific amount of input tokens for a minimum amount of output tokens
 */
abstract contract BaseUniswapV3SellAdapter is BaseUniswapV3SwapAdapter {
    /**
     * @dev Implementation of virtual function from OracleValidation
     * @return The addresses provider instance
     */
    function _getAddressesProvider() internal view virtual override returns (IPoolAddressesProvider) {
        return ADDRESSES_PROVIDER;
    }

    /**
     * @notice Executes an exact input swap on Uniswap V3
     * @param assetToSwapFrom The input token
     * @param assetToSwapTo The output token
     * @param amountToSwap The exact amount of input tokens to swap
     * @param minAmountToReceive The minimum amount of output tokens to receive
     * @param swapPath The encoded swap path
     * @param deadline The deadline for the swap
     * @return amountReceived The actual amount of output tokens received
     */
    function _sellOnUniswapV3(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 amountToSwap,
        uint256 minAmountToReceive,
        bytes memory swapPath,
        uint256 deadline
    ) internal virtual returns (uint256 amountReceived) {
        _validateSwapAmount(amountToSwap);
        _validateSwapPath(swapPath);
        _validateDeadline(deadline);
        _validateOraclePriceExactInput(
            address(assetToSwapFrom),
            address(assetToSwapTo),
            amountToSwap,
            minAmountToReceive
        );

        // Validation of input balance, output amount, and deadline are done in executeExactInputSwap
        amountReceived = UniswapV3SwapUtils.executeExactInputSwap(
            SWAP_ROUTER,
            assetToSwapFrom,
            assetToSwapTo,
            amountToSwap,
            minAmountToReceive,
            swapPath,
            deadline
        );

        emit Bought(address(assetToSwapFrom), address(assetToSwapTo), amountToSwap, amountReceived);
    }
}

