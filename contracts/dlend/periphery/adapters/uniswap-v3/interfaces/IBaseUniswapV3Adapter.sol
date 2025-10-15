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

import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/**
 * @title IBaseUniswapV3Adapter
 * @notice Base interface for Uniswap V3 adapters
 * @dev Defines common structures and errors used across all Uniswap V3 adapters
 */
interface IBaseUniswapV3Adapter {
    /**
     * @notice Structure for permit signature data
     * @param aToken The aToken address
     * @param value The permit value
     * @param deadline The permit deadline
     * @param v The permit signature v
     * @param r The permit signature r
     * @param s The permit signature s
     */
    struct PermitInput {
        IERC20Permit aToken;
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /**
     * @dev Error thrown when the caller is not the Pool
     * @param caller The actual caller address
     * @param pool The expected pool address
     */
    error CallerMustBePool(address caller, address pool);

    /**
     * @dev Error thrown when the initiator is not this contract
     * @param initiator The actual initiator address
     * @param expected The expected initiator address (this contract)
     */
    error InitiatorMustBeThis(address initiator, address expected);

    /**
     * @dev Error thrown when swap amount is invalid
     * @param amount The invalid amount
     */
    error InvalidSwapAmount(uint256 amount);

    /**
     * @dev Error thrown when swap path is invalid
     */
    error InvalidSwapPath();

    /**
     * @dev Error thrown when deadline has passed
     * @param deadline The deadline that was set
     * @param currentTime The current block timestamp
     */
    error DeadlineExpired(uint256 deadline, uint256 currentTime);

    /**
     * @dev Error thrown when balance before swap is insufficient
     * @param balance The actual balance
     * @param required The required balance
     */
    error InsufficientBalanceBeforeSwap(uint256 balance, uint256 required);

    /**
     * @dev Error thrown when balance after swap is insufficient
     * @param balance The actual balance after swap
     * @param minimum The minimum expected balance
     */
    error InsufficientBalanceAfterSwap(uint256 balance, uint256 minimum);

    /**
     * @dev Emitted after a successful swap from assetFrom to assetTo (exact input)
     * @param fromAsset The address of the source asset
     * @param toAsset The address of the target asset
     * @param fromAmount The amount of fromAsset that was swapped
     * @param receivedAmount The amount of toAsset received
     */
    event Bought(
        address indexed fromAsset,
        address indexed toAsset,
        uint256 fromAmount,
        uint256 receivedAmount
    );

    /**
     * @dev Emitted after a successful swap from assetFrom to assetTo (exact output)
     * @param fromAsset The address of the source asset
     * @param toAsset The address of the target asset
     * @param amountSold The amount of fromAsset that was swapped
     * @param toAmount The amount of toAsset received
     */
    event Sold(
        address indexed fromAsset,
        address indexed toAsset,
        uint256 amountSold,
        uint256 toAmount
    );
}

