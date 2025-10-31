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

import "../interface/liquidityV2/BaseLiquidityV2Wrapper.sol";
import "../interface/liquidityV2/ILiquidityV2OracleAggregatorV3Interface.sol";
import "usingtellor/contracts/UsingTellor.sol";

/**
 * @title TellorWrapper
 * @dev Implementation of BaseLiquityV2Wrapper for Tellor oracle feeds
 * Supports both Chainlink-like interface (LiquityV2OracleAggregatorV3Interface) and native Tellor integration
 * Uses Tellor's recommended safety pattern with dispute protection when using native Tellor
 */
contract TellorWrapper is BaseLiquidityV2Wrapper, UsingTellor {
    /* State */
    
    /// @notice Mapping from asset address to Chainlink-like feed
    mapping(address => LiquityV2OracleAggregatorV3Interface) public assetToFeed;
    
    /// @notice Mapping from asset address to Tellor queryId (for native Tellor integration)
    mapping(address => bytes32) public assetToQueryId;
    
    /// @notice Mapping from asset address to last stored timestamp (prevents dispute attacks)
    mapping(address => uint256) public lastStoredTimestamp;
    
    /// @notice Dispute window in seconds (default 15 minutes)
    uint256 public disputeWindow = 15 minutes;

    /* Errors */
    
    error QueryIdNotSet(address asset);
    error DataTooOld(address asset, uint256 timestampRetrieved, uint256 maxAge);
    error TimestampNotNewer(address asset, uint256 timestampRetrieved, uint256 lastStored);
    error MustProvideQueryIdOrFeed();

    constructor(
        address baseCurrency,
        uint256 _baseCurrencyUnit,
        address payable tellorOracle
    ) BaseLiquidityV2Wrapper(baseCurrency, _baseCurrencyUnit) UsingTellor(tellorOracle) {}

    /**
     * @notice Gets the price information for an asset
     * @dev Uses native Tellor pattern if queryId is set, otherwise falls back to Chainlink-like interface
     * @param asset The address of the asset to get the price for
     * @return price The price of the asset in base currency units
     * @return isAlive Whether the price feed is considered active/valid
     */
    function getPriceInfo(address asset) public view virtual override returns (uint256 price, bool isAlive) {
        bytes32 queryId = assetToQueryId[asset];
        
        // If queryId is set, use native Tellor pattern
        if (queryId != bytes32(0)) {
            return _getTellorPrice(asset, queryId);
        }
        
        // Otherwise, use Chainlink-like interface
        LiquityV2OracleAggregatorV3Interface feed = assetToFeed[asset];
        if (address(feed) == address(0)) {
            revert FeedNotSet(asset);
        }

        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();

        // Validate the oracle data
        if (answer <= 0) {
            revert InvalidPrice();
        }

        price = uint256(answer);
        isAlive = updatedAt + feedHeartbeat + heartbeatStaleTimeLimit > block.timestamp;

        price = _convertToBaseCurrencyUnit(price);
    }

    /**
     * @dev Gets price using Tellor's native pattern with dispute protection
     * @param asset The address of the asset
     * @param queryId The Tellor queryId
     * @return price The price in base currency units
     * @return isAlive Whether the price is considered valid
     */
    function _getTellorPrice(address asset, bytes32 queryId) internal view returns (uint256 price, bool isAlive) {
        // Retrieve data at least disputeWindow old to allow time for disputes
        (bytes memory value, uint256 timestampRetrieved) = _getDataBefore(
            queryId,
            block.timestamp - disputeWindow
        );

        // If timestampRetrieved is 0, no data was found
        if (timestampRetrieved == 0) {
            return (0, false);
        }

        // Check that the data is not too old
        uint256 maxAge = feedHeartbeat + heartbeatStaleTimeLimit;
        if (block.timestamp - timestampRetrieved > maxAge) {
            return (0, false);
        }

        // Check that the data is newer than the last stored data to avoid dispute attacks
        uint256 lastStored = lastStoredTimestamp[asset];
        if (timestampRetrieved <= lastStored) {
            return (0, false);
        }

        // Decode the price value
        price = abi.decode(value, (uint256));
        
        // Validate price is positive
        if (price == 0) {
            return (0, false);
        }

        // Price is valid
        isAlive = true;
        
        // Convert to base currency unit
        price = _convertToBaseCurrencyUnit(price);
    }

    /**
     * @notice Sets the Tellor configuration for an asset
     * @dev Configures Tellor integration. Supports both native queryId pattern (recommended) and Chainlink-like feed fallback.
     *      - If queryId is provided (non-zero), uses native Tellor pattern with dispute protection (recommended)
     *      - If queryId is zero and feed is provided, uses Chainlink-like interface as fallback
     *      - Both queryId and feed can be set; queryId takes priority if both are non-zero
     * 
     * ## How to Generate Query IDs:
     * 
     * ### For SpotPrice queries (most common):
     * ```solidity
     * // Example: ETH/USD
     * bytes memory queryData = abi.encode("SpotPrice", abi.encode("eth", "usd"));
     * bytes32 queryId = keccak256(queryData);
     * 
     * // Example: BTC/USD
     * bytes memory queryData = abi.encode("SpotPrice", abi.encode("btc", "usd"));
     * bytes32 queryId = keccak256(queryData);
     * ```
     * 
     * ### For custom queries:
     * ```solidity
     * bytes memory params = abi.encode(param1, param2, ...);
     * bytes memory queryData = abi.encode("QueryType", params);
     * bytes32 queryId = keccak256(queryData);
     * ```
     * 
     * ### Using JavaScript/TypeScript (ethers.js):
     * ```javascript
     * const { ethers } = require("ethers");
     * 
     * // SpotPrice query
     * const queryData = ethers.AbiCoder.defaultAbiCoder().encode(
     *   ["string", "bytes"],
     *   [
     *     "SpotPrice",
     *     ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["eth", "usd"])
     *   ]
     * );
     * const queryId = ethers.keccak256(queryData);
     * ```
     * 
     * ### Common Query IDs:
     * - ETH/USD: keccak256(abi.encode("SpotPrice", abi.encode("eth", "usd")))
     * - BTC/USD: keccak256(abi.encode("SpotPrice", abi.encode("btc", "usd")))
     * - AVAX/USD: keccak256(abi.encode("SpotPrice", abi.encode("avax", "usd")))
     * 
     * @param asset The address of the asset
     * @param queryId The Tellor queryId (bytes32) for native Tellor. Use bytes32(0) to only set feed.
     *                Generate using keccak256(abi.encode(queryType, abi.encode(params)))
     * @param feed The address of the Chainlink-like Tellor feed (fallback). Use address(0) to only set queryId.
     */
    function setAssetConfig(address asset, bytes32 queryId, address feed) external onlyRole(ORACLE_MANAGER_ROLE) {
        // Validate that at least one source is provided
        if (queryId == bytes32(0) && feed == address(0)) {
            revert MustProvideQueryIdOrFeed();
        }

        // If feed is provided, validate decimals
        if (feed != address(0)) {
            LiquityV2OracleAggregatorV3Interface feedInterface = LiquityV2OracleAggregatorV3Interface(feed);
            uint8 feedDecimals = feedInterface.decimals();
            if (feedDecimals != BASE_CURRENCY_DECIMALS) {
                revert DecimalsMismatch(feed, feedDecimals, BASE_CURRENCY_DECIMALS);
            }
            assetToFeed[asset] = feedInterface;
        } else {
            // Clear feed if not provided
            assetToFeed[asset] = LiquityV2OracleAggregatorV3Interface(address(0));
        }

        // Set queryId (can be zero)
        assetToQueryId[asset] = queryId;
    }

    /**
     * @notice Sets the dispute window for Tellor data retrieval
     * @dev The dispute window prevents using recently submitted data that might be disputed
     * @param _disputeWindow The new dispute window in seconds
     */
    function setDisputeWindow(uint256 _disputeWindow) external onlyRole(ORACLE_MANAGER_ROLE) {
        disputeWindow = _disputeWindow;
    }

    /**
     * @notice Updates the last stored timestamp for an asset
     * @dev Should be called after successfully reading a price to prevent dispute attacks
     * @param asset The address of the asset
     * @param timestamp The timestamp of the data that was stored
     */
    function updateLastStoredTimestamp(address asset, uint256 timestamp) external onlyRole(ORACLE_MANAGER_ROLE) {
        uint256 lastStored = lastStoredTimestamp[asset];
        if (timestamp <= lastStored) {
            revert TimestampNotNewer(asset, timestamp, lastStored);
        }
        lastStoredTimestamp[asset] = timestamp;
    }
}
