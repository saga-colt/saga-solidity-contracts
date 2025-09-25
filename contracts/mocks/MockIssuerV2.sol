// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../dstable/IssuerV2.sol";

/**
 * @title MockIssuerV2
 * @dev Mock implementation of IssuerV2 for testing purposes
 */
contract MockIssuerV2 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public dstable;
    address public collateralVault;

    event MockIssue(
        uint256 collateralAmount,
        address collateralAsset,
        uint256 minDStable
    );

    constructor(address _dstable, address _collateralVault) {
        dstable = IERC20(_dstable);
        collateralVault = _collateralVault;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Mock issue function that simulates minting dSTABLE
     * @param collateralAmount Amount of collateral to use
     * @param collateralAsset Address of the collateral asset
     * @param minDStable Minimum dSTABLE to receive
     */
    function issue(
        uint256 collateralAmount,
        address collateralAsset,
        uint256 minDStable
    ) external nonReentrant whenNotPaused {
        // Transfer collateral from caller to this contract (simulating vault transfer)
        IERC20(collateralAsset).safeTransferFrom(
            msg.sender,
            address(this),
            collateralAmount
        );

        // For testing purposes, mint 1:1 ratio (simplified)
        // In real implementation, this would use oracle pricing
        uint256 dstableAmount = collateralAmount;

        // Ensure we meet minimum requirement
        require(dstableAmount >= minDStable, "Insufficient dSTABLE amount");

        // Mint dSTABLE to caller (assuming dSTABLE is mintable)
        // Note: In real tests, you might need to mock the mint function
        emit MockIssue(collateralAmount, collateralAsset, minDStable);
    }

    /**
     * @notice Pauses the contract
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
