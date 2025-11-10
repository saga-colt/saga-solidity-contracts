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
import "./ThresholdingUtils.sol";

/**
 * @title TellorCompositeWrapper
 * @dev Implementation of BaseLiquityV2Wrapper for composite Tellor oracle feeds with thresholding
 * Chains two Tellor feeds together (e.g., yUSD/USDC * USDC/USD = yUSD/USD)
 */
contract TellorCompositeWrapper is BaseLiquityV2Wrapper, ThresholdingUtils {
    /* Core state */

    struct CompositeFeed {
        address feed1; // Primary feed (e.g., yUSD/USDC)
        address feed2; // Secondary feed (e.g., USDC/USD)
        ThresholdConfig primaryThreshold; // Primary price source threshold config
        ThresholdConfig secondaryThreshold; // Secondary price source threshold config
    }

    mapping(address => CompositeFeed) public compositeFeeds;

    /* Events */

    event CompositeFeedAdded(
        address indexed asset,
        address feed1,
        address feed2,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    );
    event CompositeFeedRemoved(address indexed asset);
    event CompositeFeedUpdated(
        address indexed asset,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    );

    constructor(
        address baseCurrency,
        uint256 _baseCurrencyUnit
    ) BaseLiquityV2Wrapper(baseCurrency, _baseCurrencyUnit) {}

    /**
     * @notice Adds a composite feed for an asset
     * @dev Both feeds must implement LiquityV2OracleAggregatorV3Interface
     * @param asset The asset address to set the composite feed for
     * @param feed1 The primary feed address (e.g., yUSD/USDC)
     * @param feed2 The secondary feed address (e.g., USDC/USD)
     * @param lowerThresholdInBase1 Lower threshold for feed1 in BASE_CURRENCY_UNIT
     * @param fixedPriceInBase1 Fixed price for feed1 in BASE_CURRENCY_UNIT
     * @param lowerThresholdInBase2 Lower threshold for feed2 in BASE_CURRENCY_UNIT
     * @param fixedPriceInBase2 Fixed price for feed2 in BASE_CURRENCY_UNIT
     */
    function addCompositeFeed(
        address asset,
        address feed1,
        address feed2,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        if (feed1 == address(0) || feed2 == address(0)) {
            revert FeedNotSet(asset);
        }

        // Validate that feed decimals match expected decimals
        uint8 feed1Decimals = LiquityV2OracleAggregatorV3Interface(feed1).decimals();
        uint8 feed2Decimals = LiquityV2OracleAggregatorV3Interface(feed2).decimals();

        if (feed1Decimals != BASE_CURRENCY_DECIMALS) {
            revert DecimalsMismatch(feed1, feed1Decimals, BASE_CURRENCY_DECIMALS);
        }
        if (feed2Decimals != BASE_CURRENCY_DECIMALS) {
            revert DecimalsMismatch(feed2, feed2Decimals, BASE_CURRENCY_DECIMALS);
        }

        compositeFeeds[asset] = CompositeFeed({
            feed1: feed1,
            feed2: feed2,
            primaryThreshold: ThresholdConfig({
                lowerThresholdInBase: lowerThresholdInBase1,
                fixedPriceInBase: fixedPriceInBase1
            }),
            secondaryThreshold: ThresholdConfig({
                lowerThresholdInBase: lowerThresholdInBase2,
                fixedPriceInBase: fixedPriceInBase2
            })
        });
        emit CompositeFeedAdded(
            asset,
            feed1,
            feed2,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2
        );
    }

    /**
     * @notice Removes a composite feed for an asset
     * @param asset The asset address to remove the composite feed for
     */
    function removeCompositeFeed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete compositeFeeds[asset];
        emit CompositeFeedRemoved(asset);
    }

    /**
     * @notice Updates the threshold configuration for an existing composite feed
     * @param asset The asset address to update
     * @param lowerThresholdInBase1 Lower threshold for feed1 in BASE_CURRENCY_UNIT
     * @param fixedPriceInBase1 Fixed price for feed1 in BASE_CURRENCY_UNIT
     * @param lowerThresholdInBase2 Lower threshold for feed2 in BASE_CURRENCY_UNIT
     * @param fixedPriceInBase2 Fixed price for feed2 in BASE_CURRENCY_UNIT
     */
    function updateCompositeFeed(
        address asset,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        CompositeFeed storage feed = compositeFeeds[asset];
        if (feed.feed1 == address(0) || feed.feed2 == address(0)) {
            revert FeedNotSet(asset);
        }
        feed.primaryThreshold.lowerThresholdInBase = lowerThresholdInBase1;
        feed.primaryThreshold.fixedPriceInBase = fixedPriceInBase1;
        feed.secondaryThreshold.lowerThresholdInBase = lowerThresholdInBase2;
        feed.secondaryThreshold.fixedPriceInBase = fixedPriceInBase2;
        emit CompositeFeedUpdated(
            asset,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2
        );
    }

    /**
     * @notice Gets the price information for an asset by composing two feeds
     * @dev Multiplies feed1 * feed2 to get the final price (e.g., yUSD/USDC * USDC/USD = yUSD/USD)
     * @param asset The address of the asset to get the price for
     * @return price The composite price of the asset in base currency units
     * @return isAlive Whether both price feeds are considered active/valid
     */
    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        CompositeFeed memory feed = compositeFeeds[asset];
        if (feed.feed1 == address(0) || feed.feed2 == address(0)) {
            revert FeedNotSet(asset);
        }

        // Get price from feed1
        (, int256 answer1, , uint256 updatedAt1, ) = LiquityV2OracleAggregatorV3Interface(feed.feed1).latestRoundData();

        // Get price from feed2
        (, int256 answer2, , uint256 updatedAt2, ) = LiquityV2OracleAggregatorV3Interface(feed.feed2).latestRoundData();

        // Validate prices
        if (answer1 <= 0 || answer2 <= 0) {
            revert InvalidPrice();
        }

        uint256 price1 = uint256(answer1);
        uint256 price2 = uint256(answer2);

        // Convert both prices to BASE_CURRENCY_UNIT first
        uint256 priceInBase1 = _convertToBaseCurrencyUnit(price1);
        uint256 priceInBase2 = _convertToBaseCurrencyUnit(price2);

        // Apply thresholding to prices in BASE_CURRENCY_UNIT if specified
        if (feed.primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, feed.primaryThreshold);
        }
        if (feed.secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, feed.secondaryThreshold);
        }

        // Multiply the two prices: (feed1 * feed2) / BASE_CURRENCY_UNIT
        // Example: (yUSD/USDC * USDC/USD) / 1e8 = yUSD/USD
        price = (priceInBase1 * priceInBase2) / BASE_CURRENCY_UNIT;

        // Check if both feeds are alive based on heartbeat
        isAlive =
            price > 0 &&
            updatedAt1 + feedHeartbeat + heartbeatStaleTimeLimit > block.timestamp &&
            updatedAt2 + feedHeartbeat + heartbeatStaleTimeLimit > block.timestamp;
    }
}
