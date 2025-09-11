// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockOracle
 * @dev Mock implementation of price oracle for testing purposes
 */
contract MockOracle {
    uint256 public constant BASE_CURRENCY_UNIT = 1e18;

    mapping(address => uint256) public assetPrices;

    constructor() {
        // Set some default prices for testing
        assetPrices[address(0)] = 1e18; // ETH price
    }

    function setAssetPrice(address asset, uint256 price) external {
        assetPrices[asset] = price;
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        return assetPrices[asset];
    }
}
