// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../Uniswap/Uniswapv3/interfaces/ISwapRouter.sol";

/**
 * @title MockUniswapRouter
 * @dev Mock implementation of UniswapV3 SwapRouter for testing purposes
 */
contract MockUniswapRouter is ISwapRouter {
    // Mock swap result - returns 95% of input amount for single hop
    uint256 public constant MOCK_SWAP_RATIO = 95; // 95%
    
    // Mock swap result for multihop - returns 90% of input amount (worse than single hop)
    uint256 public constant MOCK_MULTIHOP_RATIO = 90; // 90%
    
    function exactInputSingle(ExactInputSingleParams calldata params) 
        external 
        payable 
        override 
        returns (uint256 amountOut) 
    {
        // Simple mock: return 95% of input amount
        amountOut = (params.amountIn * MOCK_SWAP_RATIO) / 100;
        
        // In a real implementation, this would transfer tokens
        // For testing, we assume the tokens are already transferred
        return amountOut;
    }
    
    function exactInput(ExactInputParams calldata params) 
        external 
        payable 
        override 
        returns (uint256 amountOut) 
    {
        // For multihop, we return a slightly worse rate to simulate real-world conditions
        // where multihop might be better for some paths but worse for others
        amountOut = (params.amountIn * MOCK_MULTIHOP_RATIO) / 100;
        
        // In a real implementation, this would transfer tokens through multiple pools
        // For testing, we assume the tokens are already transferred
        return amountOut;
    }
}
