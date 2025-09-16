// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../Uniswap/Uniswapv3/interfaces/IQuoterV2.sol";

/**
 * @title MockQuoterV2
 * @dev Mock implementation of UniswapV3 QuoterV2 for testing purposes
 */
contract MockQuoterV2 is IQuoterV2 {
    // Mock quote result - returns 95% of input amount for single hop
    uint256 public constant MOCK_QUOTE_RATIO = 95; // 95%

    // Mock quote result for multihop - returns 97% of input amount (better than single hop)
    uint256 public constant MOCK_MULTIHOP_QUOTE_RATIO = 97; // 97%

    function quoteExactInput(
        bytes memory /* path */,
        uint256 amountIn
    )
        external
        pure
        override
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        )
    {
        // For multihop paths, return a better rate to simulate optimal routing
        amountOut = (amountIn * MOCK_MULTIHOP_QUOTE_RATIO) / 100;

        // Mock the other return values
        sqrtPriceX96AfterList = new uint160[](1);
        sqrtPriceX96AfterList[0] = 79228162514264337593543950336; // Mock sqrt price

        initializedTicksCrossedList = new uint32[](1);
        initializedTicksCrossedList[0] = 1; // Mock tick crosses

        gasEstimate = 200000; // Mock gas estimate

        return (
            amountOut,
            sqrtPriceX96AfterList,
            initializedTicksCrossedList,
            gasEstimate
        );
    }

    function quoteExactInputSingle(
        QuoteExactInputSingleParams memory params
    )
        external
        pure
        override
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        )
    {
        // For single hop, return the standard rate
        amountOut = (params.amountIn * MOCK_QUOTE_RATIO) / 100;

        // Mock the other return values
        sqrtPriceX96After = 79228162514264337593543950336; // Mock sqrt price
        initializedTicksCrossed = 1; // Mock tick crosses
        gasEstimate = 150000; // Mock gas estimate

        return (
            amountOut,
            sqrtPriceX96After,
            initializedTicksCrossed,
            gasEstimate
        );
    }

    function quoteExactOutput(
        bytes memory /* path */,
        uint256 amountOut
    )
        external
        pure
        override
        returns (
            uint256 amountIn,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        )
    {
        // For exact output, calculate the required input
        amountIn = (amountOut * 100) / MOCK_MULTIHOP_QUOTE_RATIO;

        // Mock the other return values
        sqrtPriceX96AfterList = new uint160[](1);
        sqrtPriceX96AfterList[0] = 79228162514264337593543950336; // Mock sqrt price

        initializedTicksCrossedList = new uint32[](1);
        initializedTicksCrossedList[0] = 1; // Mock tick crosses

        gasEstimate = 200000; // Mock gas estimate

        return (
            amountIn,
            sqrtPriceX96AfterList,
            initializedTicksCrossedList,
            gasEstimate
        );
    }

    function quoteExactOutputSingle(
        QuoteExactOutputSingleParams memory params
    )
        external
        pure
        override
        returns (
            uint256 amountIn,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        )
    {
        // For exact output single, calculate the required input
        amountIn = (params.amount * 100) / MOCK_QUOTE_RATIO;

        // Mock the other return values
        sqrtPriceX96After = 79228162514264337593543950336; // Mock sqrt price
        initializedTicksCrossed = 1; // Mock tick crosses
        gasEstimate = 150000; // Mock gas estimate

        return (
            amountIn,
            sqrtPriceX96After,
            initializedTicksCrossed,
            gasEstimate
        );
    }
}
