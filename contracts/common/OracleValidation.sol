// SPDX-License-Identifier: AGPL-3.0
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

import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { IPriceOracleGetter } from "contracts/dlend/core/interfaces/IPriceOracleGetter.sol";
import { PercentageMath } from "contracts/dlend/core/protocol/libraries/math/PercentageMath.sol";

/**
 * @title OracleValidation
 * @notice Provides oracle price validation for swap operations
 * @dev Validates swap amounts against oracle prices to prevent price manipulation
 * - Protects against oracle price manipulation attacks
 * - Configurable price deviation tolerance
 * - Supports both exact input and exact output validations
 */
abstract contract OracleValidation {
    using PercentageMath for uint256;

    /// @notice Maximum allowed oracle price tolerance in basis points (5%)
    uint256 public constant MAX_ORACLE_PRICE_TOLERANCE_BPS = 500;
    
    /// @notice Current oracle price tolerance in basis points (3% default)
    uint256 public oraclePriceToleranceBps = 300;

    /**
     * @notice Emitted when oracle price tolerance is updated
     * @param oldToleranceBps Previous tolerance in basis points
     * @param newToleranceBps New tolerance in basis points
     */
    event OraclePriceToleranceUpdated(uint256 oldToleranceBps, uint256 newToleranceBps);

    /**
     * @notice Thrown when oracle price deviation exceeds tolerance
     * @param expectedAmount Expected amount based on oracle price
     * @param actualAmount Actual amount from swap
     * @param toleranceBps Tolerance in basis points
     */
    error OraclePriceDeviationExceeded(uint256 expectedAmount, uint256 actualAmount, uint256 toleranceBps);

    /**
     * @notice Thrown when oracle price tolerance exceeds maximum allowed
     * @param requestedToleranceBps Requested tolerance in basis points
     * @param maxToleranceBps Maximum allowed tolerance in basis points
     */
    error OraclePriceToleranceExceedsMaximum(uint256 requestedToleranceBps, uint256 maxToleranceBps);

    /**
     * @dev Virtual function to get the addresses provider
     * @return The addresses provider instance
     */
    function _getAddressesProvider() internal view virtual returns (IPoolAddressesProvider);

    /**
     * @notice Sets the oracle price deviation tolerance
     * @dev Only callable by the owner, cannot exceed MAX_ORACLE_PRICE_TOLERANCE_BPS
     * @param newToleranceBps New tolerance in basis points (e.g., 300 = 3%)
     */
    function _setOraclePriceTolerance(uint256 newToleranceBps) internal {
        if (newToleranceBps > MAX_ORACLE_PRICE_TOLERANCE_BPS) {
            revert OraclePriceToleranceExceedsMaximum(newToleranceBps, MAX_ORACLE_PRICE_TOLERANCE_BPS);
        }
        
        uint256 oldToleranceBps = oraclePriceToleranceBps;
        oraclePriceToleranceBps = newToleranceBps;
        emit OraclePriceToleranceUpdated(oldToleranceBps, newToleranceBps);
    }

    /**
     * @dev Validates oracle price for exact input swaps
     * @param tokenIn The input token address
     * @param tokenOut The output token address
     * @param amountIn The amount of input tokens
     * @param minAmountOut The minimum amount of output tokens expected
     */
    function _validateOraclePriceExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal view {
        if (amountIn == 0 || minAmountOut == 0) return;

        IPoolAddressesProvider addressesProvider = _getAddressesProvider();
        IPriceOracleGetter oracle = IPriceOracleGetter(addressesProvider.getPriceOracle());

        uint256 tokenInPrice = oracle.getAssetPrice(tokenIn);
        uint256 tokenOutPrice = oracle.getAssetPrice(tokenOut);

        if (tokenInPrice == 0 || tokenOutPrice == 0) return;

        // Calculate expected output amount based on oracle prices
        uint256 expectedAmountOut = (amountIn * tokenInPrice) / tokenOutPrice;
        
        // Calculate minimum expected amount with tolerance
        uint256 minExpectedAmountOut = expectedAmountOut.percentMul(
            PercentageMath.PERCENTAGE_FACTOR - oraclePriceToleranceBps
        );

        if (minAmountOut < minExpectedAmountOut) {
            revert OraclePriceDeviationExceeded(
                minExpectedAmountOut,
                minAmountOut,
                oraclePriceToleranceBps
            );
        }
    }

    /**
     * @dev Validates oracle price for exact output swaps
     * @param tokenIn The input token address
     * @param tokenOut The output token address
     * @param maxAmountIn The maximum amount of input tokens
     * @param amountOut The amount of output tokens expected
     */
    function _validateOraclePriceExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 maxAmountIn,
        uint256 amountOut
    ) internal view {
        if (maxAmountIn == 0 || amountOut == 0) return;

        IPoolAddressesProvider addressesProvider = _getAddressesProvider();
        IPriceOracleGetter oracle = IPriceOracleGetter(addressesProvider.getPriceOracle());

        uint256 tokenInPrice = oracle.getAssetPrice(tokenIn);
        uint256 tokenOutPrice = oracle.getAssetPrice(tokenOut);

        if (tokenInPrice == 0 || tokenOutPrice == 0) return;

        // Calculate expected input amount based on oracle prices
        uint256 expectedAmountIn = (amountOut * tokenOutPrice) / tokenInPrice;
        
        // Calculate maximum expected amount with tolerance
        uint256 maxExpectedAmountIn = expectedAmountIn.percentMul(
            PercentageMath.PERCENTAGE_FACTOR + oraclePriceToleranceBps
        );

        if (maxAmountIn > maxExpectedAmountIn) {
            revert OraclePriceDeviationExceeded(
                maxExpectedAmountIn,
                maxAmountIn,
                oraclePriceToleranceBps
            );
        }
    }
}