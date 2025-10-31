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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interface/IOracleWrapper.sol";

/**
 * @title OracleAggregator
 * @notice Aggregates price data from multiple oracles
 * @dev Implements IPriceOracleGetter for compatibility with Aave
 */
contract OracleAggregator is AccessControl, IOracleWrapper {
    /* Core state */

    /// @notice Mapping from asset address to oracle address
    mapping(address => address) public assetOracles;

    /// @notice 1 Unit of base currency (10^priceDecimals)
    uint256 public immutable baseCurrencyUnit;

    /// @notice Address representing the base currency
    address public immutable baseCurrency;

    /* Freeze and Override State */

    /// @notice Struct for price override
    struct PriceOverride {
        uint256 price;
        uint256 expiresAt;
    }

    /// @notice Mapping from asset address to freeze status
    mapping(address => bool) public isFrozen;

    /// @notice Mapping from asset address to price override
    mapping(address => PriceOverride) public priceOverrides;

    /// @notice Default expiration time for price overrides (default 24 hours)
    uint256 public overrideExpirationTime = 24 hours;

    /* Events */

    event OracleUpdated(address indexed asset, address indexed oracle);
    event AssetFrozen(address indexed asset);
    event AssetUnfrozen(address indexed asset);
    event PriceOverrideSet(address indexed asset, uint256 price, uint256 expiresAt);
    event PriceOverrideCleared(address indexed asset);
    event OverrideExpirationTimeUpdated(uint256 newExpirationTime);

    /* Roles */

    /// @notice Role for managing oracles
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    /// @notice Role for freezing/unfreezing assets
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    /* Errors */
    error UnexpectedBaseUnit(address asset, address oracle, uint256 expectedBaseUnit, uint256 oracleBaseUnit);
    error OracleNotSet(address asset);
    error PriceNotAlive(address asset);
    error AssetAlreadyFrozen(address asset);
    error AssetNotFrozen(address asset);
    error NoPriceOverride(address asset);
    error InvalidExpirationTime(uint256 expirationTime, uint256 currentTime);

    /**
     * @notice Constructor to initialize the OracleAggregator
     * @param _baseCurrency Address of the base currency
     * @param _baseCurrencyUnit Number of decimal places for price values
     */
    constructor(address _baseCurrency, uint256 _baseCurrencyUnit) {
        baseCurrency = _baseCurrency;
        baseCurrencyUnit = _baseCurrencyUnit;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, msg.sender);
    }

    /**
     * @notice Sets the oracle for a specific asset
     * @param asset Address of the asset
     * @param oracle Address of the oracle for the asset
     */
    function setOracle(address asset, address oracle) external onlyRole(ORACLE_MANAGER_ROLE) {
        uint256 oracleBaseUnit = IOracleWrapper(oracle).BASE_CURRENCY_UNIT();
        if (oracleBaseUnit != baseCurrencyUnit) {
            revert UnexpectedBaseUnit(asset, oracle, baseCurrencyUnit, oracleBaseUnit);
        }
        assetOracles[asset] = oracle;
        emit OracleUpdated(asset, oracle);
    }

    /**
     * @notice Removes the oracle for a specific asset
     * @param asset Address of the asset
     */
    function removeOracle(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        assetOracles[asset] = address(0);
        emit OracleUpdated(asset, address(0));
    }

    /**
     * @notice Returns the base currency
     * @return Address representing the base currency
     */
    function BASE_CURRENCY() external view returns (address) {
        return baseCurrency;
    }

    /**
     * @notice Returns the base currency unit
     * @return Base currency unit (10^priceDecimals)
     */
    function BASE_CURRENCY_UNIT() external view returns (uint256) {
        return baseCurrencyUnit;
    }

    /**
     * @notice Gets the price of an asset
     * @param asset Address of the asset
     * @return Price of the asset
     */
    function getAssetPrice(address asset) external view returns (uint256) {
        (uint256 price, bool isAlive) = getPriceInfo(asset);
        if (!isAlive) {
            revert PriceNotAlive(asset);
        }
        return price;
    }

    /**
     * @notice Gets the price info of an asset
     * @param asset Address of the asset
     * @return price Price of the asset
     * @return isAlive Whether the price is considered valid
     */
    function getPriceInfo(address asset) public view returns (uint256 price, bool isAlive) {
        // Check if asset is frozen
        if (isFrozen[asset]) {
            PriceOverride memory override_ = priceOverrides[asset];
            
            // Check if override exists and is not expired
            if (override_.expiresAt > block.timestamp && override_.price > 0) {
                return (override_.price, false); // Return override price with isAlive = false
            }
            
            // Asset is frozen but no valid override
            revert NoPriceOverride(asset);
        }

        // Not frozen - normal oracle lookup
        address oracle = assetOracles[asset];
        if (oracle == address(0)) {
            revert OracleNotSet(asset);
        }
        return IOracleWrapper(oracle).getPriceInfo(asset);
    }

    /**
     * @notice Freezes an asset
     * @dev Only GUARDIAN_ROLE can freeze assets
     * @param asset Address of the asset to freeze
     */
    function freezeAsset(address asset) external onlyRole(GUARDIAN_ROLE) {
        if (isFrozen[asset]) {
            revert AssetAlreadyFrozen(asset);
        }
        isFrozen[asset] = true;
        emit AssetFrozen(asset);
    }

    /**
     * @notice Unfreezes an asset
     * @dev Only GUARDIAN_ROLE can unfreeze assets
     * @param asset Address of the asset to unfreeze
     */
    function unfreezeAsset(address asset) external onlyRole(GUARDIAN_ROLE) {
        if (!isFrozen[asset]) {
            revert AssetNotFrozen(asset);
        }
        isFrozen[asset] = false;
        emit AssetUnfrozen(asset);
    }

    /**
     * @notice Sets a price override for a frozen asset
     * @dev Only works when asset is frozen. Uses default expiration time.
     * Can be called by ORACLE_MANAGER_ROLE or GUARDIAN_ROLE
     * @param asset Address of the asset
     * @param price The override price
     */
    function setPriceOverride(address asset, uint256 price) external {
        if (!isFrozen[asset]) {
            revert AssetNotFrozen(asset);
        }
        if (!hasRole(ORACLE_MANAGER_ROLE, msg.sender) && !hasRole(GUARDIAN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ORACLE_MANAGER_ROLE);
        }
        uint256 expiresAt = block.timestamp + overrideExpirationTime;
        priceOverrides[asset] = PriceOverride({ price: price, expiresAt: expiresAt });
        emit PriceOverrideSet(asset, price, expiresAt);
    }

    /**
     * @notice Sets a price override for a frozen asset with custom expiration
     * @dev Only works when asset is frozen
     * Can be called by ORACLE_MANAGER_ROLE or GUARDIAN_ROLE
     * @param asset Address of the asset
     * @param price The override price
     * @param expirationTime The expiration timestamp
     */
    function setPriceOverride(
        address asset,
        uint256 price,
        uint256 expirationTime
    ) external {
        if (!isFrozen[asset]) {
            revert AssetNotFrozen(asset);
        }
        if (!hasRole(ORACLE_MANAGER_ROLE, msg.sender) && !hasRole(GUARDIAN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ORACLE_MANAGER_ROLE);
        }
        if (expirationTime <= block.timestamp) {
            revert InvalidExpirationTime(expirationTime, block.timestamp);
        }
        priceOverrides[asset] = PriceOverride({ price: price, expiresAt: expirationTime });
        emit PriceOverrideSet(asset, price, expirationTime);
    }

    /**
     * @notice Clears a price override for an asset
     * @dev Can be called by ORACLE_MANAGER_ROLE or GUARDIAN_ROLE
     * @param asset Address of the asset
     */
    function clearPriceOverride(address asset) external {
        if (!hasRole(ORACLE_MANAGER_ROLE, msg.sender) && !hasRole(GUARDIAN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, ORACLE_MANAGER_ROLE);
        }
        delete priceOverrides[asset];
        emit PriceOverrideCleared(asset);
    }

    /**
     * @notice Sets the default expiration time for price overrides
     * @param time The new expiration time in seconds
     */
    function setOverrideExpirationTime(uint256 time) external onlyRole(ORACLE_MANAGER_ROLE) {
        overrideExpirationTime = time;
        emit OverrideExpirationTimeUpdated(time);
    }
}
