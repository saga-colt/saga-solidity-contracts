// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MockCollateralVault
 * @dev Mock implementation of CollateralVault for testing purposes
 */
contract MockCollateralVault is AccessControl {
    mapping(address => uint256) public collateralBalances;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function depositCollateral(
        address collateralAsset,
        uint256 amount
    ) external {
        IERC20(collateralAsset).transferFrom(msg.sender, address(this), amount);
        collateralBalances[collateralAsset] += amount;
    }

    function withdrawCollateral(
        address collateralAsset,
        address to,
        uint256 amount
    ) external {
        require(
            collateralBalances[collateralAsset] >= amount,
            "Insufficient balance"
        );
        collateralBalances[collateralAsset] -= amount;
        IERC20(collateralAsset).transfer(to, amount);
    }

    function getCollateralBalance(
        address collateralAsset
    ) external view returns (uint256) {
        return collateralBalances[collateralAsset];
    }
}
