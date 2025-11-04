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

import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { BaseUniswapV3SwapAdapter } from "./BaseUniswapV3SwapAdapter.sol";
import { BaseUniswapV3SellAdapter } from "./BaseUniswapV3SellAdapter.sol";
import { ReentrancyGuard } from "contracts/common/ReentrancyGuard.sol";
import { ISwapRouter } from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";
import { IUniswapV3WithdrawSwapAdapter } from "./interfaces/IUniswapV3WithdrawSwapAdapter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title UniswapV3WithdrawSwapAdapter
 * @notice Uniswap V3 Adapter to withdraw and swap
 * @dev Withdraws the asset from the Aave Pool and swaps(exact in) it to another asset
 */
contract UniswapV3WithdrawSwapAdapter is
    BaseUniswapV3SellAdapter,
    ReentrancyGuard,
    IUniswapV3WithdrawSwapAdapter
{
    using SafeERC20 for IERC20;

    // unique identifier to track usage
    uint16 public constant REFERRER = 43984;

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        ISwapRouter swapRouter,
        address owner
    ) BaseUniswapV3SwapAdapter(addressesProvider, pool, swapRouter) Ownable(owner) {
    }

    /**
     * @dev Implementation of virtual function from OracleValidation
     * @return The addresses provider instance
     */
    function _getAddressesProvider() internal view override returns (IPoolAddressesProvider) {
        return ADDRESSES_PROVIDER;
    }

    /**
     * @dev Implementation of the reserve data getter from the base adapter
     * @param asset The address of the asset
     * @return The address of the vToken, sToken and aToken
     */
    function _getReserveData(address asset) internal view override returns (address, address, address) {
        DataTypes.ReserveData memory reserveData = POOL.getReserveData(asset);
        return (reserveData.variableDebtTokenAddress, reserveData.stableDebtTokenAddress, reserveData.aTokenAddress);
    }

    /**
     * @dev Implementation of the supply function from the base adapter
     * @param asset The address of the asset to be supplied
     * @param amount The amount of the asset to be supplied
     * @param to The address receiving the aTokens
     * @param referralCode The referral code to pass to Aave
     */
    function _supply(address asset, uint256 amount, address to, uint16 referralCode) internal override {
        POOL.supply(asset, amount, to, referralCode);
    }

    /// @inheritdoc IUniswapV3WithdrawSwapAdapter
    function withdrawAndSwap(
        WithdrawSwapParams memory withdrawSwapParams,
        PermitInput memory permitInput
    ) external nonReentrant whenNotPaused {
        // pulls liquidity asset from the user and withdraw
        _pullATokenAndWithdraw(
            withdrawSwapParams.oldAsset,
            msg.sender,
            withdrawSwapParams.oldAssetAmount,
            permitInput
        );

        // sell(exact in) withdrawn asset from Aave Pool to new asset
        uint256 amountReceived = _sellOnUniswapV3(
            IERC20Detailed(withdrawSwapParams.oldAsset),
            IERC20Detailed(withdrawSwapParams.newAsset),
            withdrawSwapParams.oldAssetAmount,
            withdrawSwapParams.minAmountToReceive,
            withdrawSwapParams.swapPath,
            withdrawSwapParams.deadline
        );

        // transfer new asset to the user
        IERC20(withdrawSwapParams.newAsset).safeTransfer(msg.sender, amountReceived);
    }


}
