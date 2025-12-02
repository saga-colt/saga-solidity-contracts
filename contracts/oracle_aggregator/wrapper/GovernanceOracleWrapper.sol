// SPDX-License-Identifier: MIT
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

import { IOracleWrapper } from "../interface/IOracleWrapper.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title GovernanceOracleWrapper
 * @notice Oracle wrapper with governance-controlled manual price updates
 * @dev Supports dual-role access: ORACLE_MANAGER_ROLE for configuration, GUARDIAN_ROLE for urgent updates
 */
contract GovernanceOracleWrapper is IOracleWrapper, AccessControl {
    /* State */

    uint256 public price;
    uint256 public lastUpdateTimestamp;
    uint256 public maxStaleness = 90 days;
    uint256 public bpsTolerance = 5; // Initial: 5 bps (0.05%)

    address public immutable BASE_CURRENCY;
    uint256 public immutable BASE_CURRENCY_UNIT;

    /* Roles */

    /// @notice Role for oracle configuration and price updates
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    /// @notice Role for urgent price updates (lighter governance, faster response)
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    /* Events */

    event PriceUpdated(
        uint256 indexed oldPrice,
        uint256 indexed newPrice,
        address indexed updater,
        int256 changeBps,
        uint256 timestamp
    );

    event MaxStalenessUpdated(uint256 oldMaxStaleness, uint256 newMaxStaleness);

    event BpsToleranceUpdated(uint256 oldTolerance, uint256 newTolerance);

    /* Errors */

    error InvalidPrice();
    error OldPriceMismatch(uint256 currentPrice, uint256 expectedPrice);
    error ChangePercentMismatch(int256 actualChangeBps, int256 expectedChangeBps, uint256 tolerance);
    error InvalidTolerance();

    /* Constructor */

    /**
     * @notice Initialize the governance oracle wrapper
     * @param _baseCurrency The address of the base currency (zero address for USD)
     * @param _baseCurrencyUnit The decimal precision of the base currency (e.g., 1e18)
     * @param _initialPrice Initial price in base currency units
     */
    constructor(address _baseCurrency, uint256 _baseCurrencyUnit, uint256 _initialPrice) {
        if (_initialPrice == 0) revert InvalidPrice();

        BASE_CURRENCY = _baseCurrency;
        BASE_CURRENCY_UNIT = _baseCurrencyUnit;
        price = _initialPrice;
        lastUpdateTimestamp = block.timestamp;

        // Grant roles to deployer initially
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, msg.sender);

        emit PriceUpdated(0, _initialPrice, msg.sender, 0, block.timestamp);
    }

    /* External Functions */

    /**
     * @notice Update oracle price with double verification
     * @dev Can be called by ORACLE_MANAGER_ROLE or GUARDIAN_ROLE
     * @param _expectedOldPrice Current price (prevents race conditions)
     * @param _newPrice New price to set
     * @param _expectedChangeBps Expected change in basis points (e.g., +50 for +0.5%, -150 for -1.5%)
     */
    function setPrice(uint256 _expectedOldPrice, uint256 _newPrice, int256 _expectedChangeBps) external {
        // Check caller has either ORACLE_MANAGER_ROLE or GUARDIAN_ROLE
        if (!hasRole(ORACLE_MANAGER_ROLE, msg.sender) && !hasRole(GUARDIAN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ORACLE_MANAGER_ROLE);
        }

        // Verification 1: Must know current price (prevents race conditions)
        if (price != _expectedOldPrice) {
            revert OldPriceMismatch(price, _expectedOldPrice);
        }

        // Verification 2: New price must be non-zero
        if (_newPrice == 0) revert InvalidPrice();

        // Verification 3: Calculate actual change and verify it matches expectation
        int256 actualChangeBps = _calculateSignedChangeBps(price, _newPrice);

        // Use configurable tolerance to handle rounding differences
        uint256 diff = _abs(actualChangeBps - _expectedChangeBps);
        if (diff > bpsTolerance) {
            revert ChangePercentMismatch(actualChangeBps, _expectedChangeBps, bpsTolerance);
        }

        // All verifications passed - update price
        uint256 oldPrice = price;
        price = _newPrice;
        lastUpdateTimestamp = block.timestamp;

        emit PriceUpdated(oldPrice, _newPrice, msg.sender, actualChangeBps, block.timestamp);
    }

    /**
     * @notice Update basis points tolerance for price change verification
     * @dev Only ORACLE_MANAGER_ROLE can update tolerance
     * @param _newTolerance New tolerance in basis points (e.g., 5 = 0.05%, 10 = 0.1%)
     */
    function setBpsTolerance(uint256 _newTolerance) external onlyRole(ORACLE_MANAGER_ROLE) {
        // Sanity check: tolerance should be reasonable (max 100 bps = 1%)
        if (_newTolerance > 100) revert InvalidTolerance();

        emit BpsToleranceUpdated(bpsTolerance, _newTolerance);
        bpsTolerance = _newTolerance;
    }

    /**
     * @notice Update max staleness period
     * @dev Only ORACLE_MANAGER_ROLE can update staleness
     * @param _newMaxStaleness New max staleness in seconds
     */
    function setMaxStaleness(uint256 _newMaxStaleness) external onlyRole(ORACLE_MANAGER_ROLE) {
        emit MaxStalenessUpdated(maxStaleness, _newMaxStaleness);
        maxStaleness = _newMaxStaleness;
    }

    /* IOracleWrapper Implementation */

    /**
     * @notice Get price info with staleness check
     * @dev Asset address parameter is ignored, returns same price for all assets
     * @return price Current price in base currency units
     * @return isAlive Whether price is considered fresh (within maxStaleness)
     */
    function getPriceInfo(
        address // asset
    ) external view returns (uint256, bool isAlive) {
        bool alive = maxStaleness == 0 ? true : block.timestamp <= lastUpdateTimestamp + maxStaleness;
        return (price, alive);
    }

    /**
     * @notice Get asset price
     * @dev Asset address parameter is ignored, returns same price for all assets
     * @return Current price in base currency units
     */
    function getAssetPrice(
        address // asset
    ) external view override returns (uint256) {
        return price;
    }

    /* Internal Functions */

    /**
     * @notice Calculate signed change in basis points
     * @dev Positive for increase, negative for decrease
     * @param _oldPrice Old price
     * @param _newPrice New price
     * @return Change in basis points (e.g., +50 for +0.5%, -150 for -1.5%)
     */
    function _calculateSignedChangeBps(uint256 _oldPrice, uint256 _newPrice) internal pure returns (int256) {
        if (_newPrice >= _oldPrice) {
            // Price increase or no change
            uint256 increase = _newPrice - _oldPrice;
            return int256((increase * 10000) / _oldPrice);
        } else {
            // Price decrease
            uint256 decrease = _oldPrice - _newPrice;
            return -int256((decrease * 10000) / _oldPrice);
        }
    }

    /**
     * @notice Absolute value of int256
     */
    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
}
