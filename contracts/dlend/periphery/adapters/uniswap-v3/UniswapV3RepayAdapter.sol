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
import { BaseUniswapV3BuyAdapter } from "./BaseUniswapV3BuyAdapter.sol";
import { ReentrancyGuard } from "contracts/common/ReentrancyGuard.sol";
import { ISwapRouter } from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import { DataTypes } from "contracts/dlend/core/protocol/libraries/types/DataTypes.sol";
import { IAaveFlashLoanReceiver } from "../interfaces/IAaveFlashLoanReceiver.sol";
import { IUniswapV3RepayAdapter } from "./interfaces/IUniswapV3RepayAdapter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title UniswapV3RepayAdapter
 * @notice Uniswap V3 Adapter to repay debt with collateral
 * @dev Swaps the existing collateral asset to debt asset in order to repay the debt. It flash-borrows assets from the Aave Pool in case the
 * user position does not remain collateralized during the operation.
 */
contract UniswapV3RepayAdapter is
    BaseUniswapV3BuyAdapter,
    ReentrancyGuard,
    IAaveFlashLoanReceiver,
    IUniswapV3RepayAdapter
{
    using SafeERC20 for IERC20;

    // unique identifier to track usage via flashloan events
    uint16 public constant REFERRER = 43985;

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        ISwapRouter swapRouter,
        address owner
    ) BaseUniswapV3SwapAdapter(addressesProvider, pool, swapRouter) Ownable(owner) {
        // set initial approval for all reserves
        address[] memory reserves = POOL.getReservesList();
        for (uint256 i = 0; i < reserves.length; i++) {
            IERC20(reserves[i]).approve(address(POOL), type(uint256).max);
        }
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

    /// @inheritdoc IUniswapV3RepayAdapter
    function repayWithCollateral(
        RepayParams memory repayParams,
        PermitInput memory collateralATokenPermit
    ) external nonReentrant whenNotPaused {
        // true if flashloan is needed to repay the debt
        if (!repayParams.withFlashLoan) {
            uint256 collateralBalanceBefore = IERC20(repayParams.collateralAsset).balanceOf(
                address(this)
            );
            _swapAndRepay(repayParams, collateralATokenPermit);

            // Supply on behalf of the user in case of excess of collateral asset after the swap
            uint256 collateralBalanceAfter = IERC20(repayParams.collateralAsset).balanceOf(address(this));
            uint256 collateralExcess = collateralBalanceAfter > collateralBalanceBefore
                ? collateralBalanceAfter - collateralBalanceBefore
                : 0;
            if (collateralExcess > 0) {
                _conditionalRenewAllowance(repayParams.collateralAsset, collateralExcess);
                _supply(repayParams.collateralAsset, collateralExcess, repayParams.user, REFERRER);
            }
        } else {
            // flashloan of the current collateral asset to use for repayment
            _flash(repayParams, collateralATokenPermit);
        }
    }


    /**
     * @dev Executes the repay with collateral after receiving the flash-borrowed assets
     * @dev Workflow:
     * 1. Buy debt asset by providing the flash-borrowed collateral in exchange
     * 2. Repay debt
     * 3. Pull aToken collateral from user and withdraw from Pool
     * 4. Repay flashloan
     * @param assets The addresses of the flash-borrowed assets
     * @param amounts The amounts of the flash-borrowed assets
     * @param premiums The premiums of the flash-borrowed assets
     * @param initiator The address of the flashloan initiator
     * @param params The byte-encoded params passed when initiating the flashloan
     * @return True if the execution of the operation succeeds, false otherwise
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != address(POOL)) {
            revert CallerMustBePool(msg.sender, address(POOL));
        }
        if (initiator != address(this)) {
            revert InitiatorMustBeThis(initiator, address(this));
        }

        (RepayParams memory repayParams, PermitInput memory collateralATokenPermit) = abi.decode(
            params,
            (RepayParams, PermitInput)
        );

        address flashLoanAsset = assets[0];
        uint256 flashLoanAmount = amounts[0];
        uint256 flashLoanPremium = premiums[0];

        // buy(exact out) debt asset by providing the flash-borrowed collateral
        uint256 amountSpent = _buyOnUniswapV3(
            IERC20Detailed(flashLoanAsset),
            IERC20Detailed(repayParams.debtRepayAsset),
            flashLoanAmount,
            repayParams.debtRepayAmount,
            repayParams.swapPath,
            repayParams.deadline
        );

        // repay the debt
        _conditionalRenewAllowance(repayParams.debtRepayAsset, repayParams.debtRepayAmount);
        POOL.repay(repayParams.debtRepayAsset, repayParams.debtRepayAmount, 2, repayParams.user);

        // pulls only the amount needed from the user for the flashloan repayment
        // flashLoanAmount - amountSpent = excess in the contract from swap
        // flashLoanAmount + flashLoanPremium = flashloan repayment
        // the amount needed is:
        // flashLoanAmount + flashLoanPremium - (flashLoanAmount - amountSpent)
        // equivalent to
        // flashLoanPremium + amountSpent
        _pullATokenAndWithdraw(
            flashLoanAsset,
            repayParams.user,
            flashLoanPremium + amountSpent,
            collateralATokenPermit
        );

        // flashloan repayment
        _conditionalRenewAllowance(flashLoanAsset, flashLoanAmount + flashLoanPremium);
        return true;
    }

    /**
     * @dev Swaps the collateral asset and repays the debt of received asset from swap
     * @dev Workflow:
     * 1. Pull aToken collateral from user and withdraw from Pool
     * 2. Buy debt asset by providing the withdrawn collateral in exchange
     * 3. Repay debt
     * @param repayParams struct describing the repay swap
     * @param collateralATokenPermit Permit for withdrawing collateral token from the pool
     * @return The amount of withdrawn collateral sold in the swap
     */
    function _swapAndRepay(
        RepayParams memory repayParams,
        PermitInput memory collateralATokenPermit
    ) internal returns (uint256) {
        uint256 collateralAmountReceived = _pullATokenAndWithdraw(
            repayParams.collateralAsset,
            repayParams.user,
            repayParams.maxCollateralAmountToSwap,
            collateralATokenPermit
        );

        // buy(exact out) of debt asset by providing the withdrawn collateral in exchange
        uint256 amountSpent = _buyOnUniswapV3(
            IERC20Detailed(repayParams.collateralAsset),
            IERC20Detailed(repayParams.debtRepayAsset),
            collateralAmountReceived,
            repayParams.debtRepayAmount,
            repayParams.swapPath,
            repayParams.deadline
        );

        // repay the debt with the bought asset (debtRepayAsset) from the swap
        _conditionalRenewAllowance(repayParams.debtRepayAsset, repayParams.debtRepayAmount);
        POOL.repay(repayParams.debtRepayAsset, repayParams.debtRepayAmount, 2, repayParams.user);

        return amountSpent;
    }

    /**
     * @dev Triggers the flashloan passing encoded params for the repay with collateral
     * @param repayParams struct describing the repay swap
     * @param collateralATokenPermit optional permit for collateral's aToken
     */
    function _flash(
        RepayParams memory repayParams,
        PermitInput memory collateralATokenPermit
    ) internal virtual {
        bytes memory params = abi.encode(repayParams, collateralATokenPermit);
        address[] memory assets = new address[](1);
        assets[0] = repayParams.collateralAsset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = repayParams.maxCollateralAmountToSwap;
        uint256[] memory interestRateModes = new uint256[](1);
        interestRateModes[0] = 0;

        POOL.flashLoan(
            address(this),
            assets,
            amounts,
            interestRateModes,
            address(this),
            params,
            REFERRER
        );
    }

}
