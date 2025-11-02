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

import "../interface/liquityV2/BaseLiquityV2Wrapper.sol";
import "../interface/liquityV2/ILiquityV2OracleAggregatorV3Interface.sol";

/**
 * @title TellorWrapper
 * @dev Implementation of BaseLiquityV2Wrapper for Tellor oracle feeds
 * Uses Chainlink-like interface (LiquityV2OracleAggregatorV3Interface) to read prices directly from feeds
 */
contract TellorWrapper is BaseLiquityV2Wrapper {
    /* State */

    /// @notice Mapping from asset address to Chainlink-like feed
    mapping(address => LiquityV2OracleAggregatorV3Interface) public assetToFeed;

    constructor(
        address baseCurrency,
        uint256 _baseCurrencyUnit
    ) BaseLiquityV2Wrapper(baseCurrency, _baseCurrencyUnit) {}

    /**
     * @notice Gets the price information for an asset
     * @dev Reads price directly from Chainlink-like feed using latestRoundData()
     * @param asset The address of the asset to get the price for
     * @return price The price of the asset in base currency units
     * @return isAlive Whether the price feed is considered active/valid
     */
    function getPriceInfo(address asset) public view virtual override returns (uint256 price, bool isAlive) {
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
     * @notice Sets the Tellor oracle feed for an asset
     * @dev Validates that the feed is not zero address and that feed decimals match the base currency decimals
     * @param asset The address of the asset
     * @param feed The address of the Tellor oracle feed implementing LiquityV2OracleAggregatorV3Interface
     */
    function setFeed(address asset, address feed) external onlyRole(ORACLE_MANAGER_ROLE) {
        if (feed == address(0)) {
            revert FeedNotSet(asset);
        }

        LiquityV2OracleAggregatorV3Interface feedInterface = LiquityV2OracleAggregatorV3Interface(feed);

        // Validate that feed decimals match expected decimals
        uint8 feedDecimals = feedInterface.decimals();
        if (feedDecimals != BASE_CURRENCY_DECIMALS) {
            revert DecimalsMismatch(feed, feedDecimals, BASE_CURRENCY_DECIMALS);
        }

        assetToFeed[asset] = feedInterface;
    }
}
