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

import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { ISwapRouter } from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import { IBaseUniswapV3Adapter } from "../interfaces/IBaseUniswapV3Adapter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title UniswapV3SwapUtils
 * @notice Library containing utility functions for Uniswap V3 swaps
 * @dev Contains the core swap execution logic for both exact input and exact output swaps
 */
library UniswapV3SwapUtils {
    /**
     * @notice Executes an exact input swap on Uniswap V3
     * @param router The Uniswap V3 swap router
     * @param tokenIn The input token
     * @param tokenOut The output token
     * @param amountIn The exact amount of input tokens to swap
     * @param minAmountOut The minimum amount of output tokens to receive
     * @param path The encoded swap path
     * @param deadline The deadline for the swap
     * @return amountOut The actual amount of output tokens received
     */
    function executeExactInputSwap(
        ISwapRouter router,
        IERC20Detailed tokenIn,
        IERC20Detailed tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes memory path,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        uint256 balanceBeforeOut = tokenOut.balanceOf(address(this));

        // Approve the router to spend the input tokens
        tokenIn.approve(address(router), amountIn);

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: minAmountOut
        });

        amountOut = router.exactInput(params);

        // Verify the actual amount received
        uint256 balanceAfterOut = tokenOut.balanceOf(address(this));
        uint256 actualAmountOut = balanceAfterOut - balanceBeforeOut;
        
        if (actualAmountOut < minAmountOut) {
            revert IBaseUniswapV3Adapter.InsufficientBalanceAfterSwap(actualAmountOut, minAmountOut);
        }

        amountOut = actualAmountOut;
    }

    /**
     * @notice Executes an exact output swap on Uniswap V3
     * @param router The Uniswap V3 swap router
     * @param tokenIn The input token
     * @param tokenOut The output token
     * @param maxAmountIn The maximum amount of input tokens to spend
     * @param amountOut The exact amount of output tokens to receive
     * @param path The encoded swap path (reversed)
     * @param deadline The deadline for the swap
     * @return amountIn The actual amount of input tokens spent
     */
    function executeExactOutputSwap(
        ISwapRouter router,
        IERC20Detailed tokenIn,
        IERC20Detailed tokenOut,
        uint256 maxAmountIn,
        uint256 amountOut,
        bytes memory path,
        uint256 deadline
    ) external returns (uint256 amountIn) {
        uint256 balanceBeforeOut = tokenOut.balanceOf(address(this));

        // Approve the router to spend the maximum input tokens
        tokenIn.approve(address(router), maxAmountIn);

        ISwapRouter.ExactOutputParams memory params = ISwapRouter.ExactOutputParams({
            path: path,
            recipient: address(this),
            deadline: deadline,
            amountOut: amountOut,
            amountInMaximum: maxAmountIn
        });

        amountIn = router.exactOutput(params);

        // Verify the actual amount received
        uint256 balanceAfterOut = tokenOut.balanceOf(address(this));
        uint256 actualAmountOut = balanceAfterOut - balanceBeforeOut;
        
        if (actualAmountOut < amountOut) {
            revert IBaseUniswapV3Adapter.InsufficientBalanceAfterSwap(actualAmountOut, amountOut);
        }
    }
}

