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
import { IUniswapV3DebtSwapAdapter } from "./interfaces/IUniswapV3DebtSwapAdapter.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title UniswapV3DebtSwapAdapter
 * @notice Uniswap V3 Adapter to perform a swap of debt to another debt
 * @dev Swaps debt from one asset to another. It flash-borrows the new debt asset from the Aave Pool,
 * swaps it to the old debt asset, and repays the old debt.
 */
contract UniswapV3DebtSwapAdapter is
    BaseUniswapV3BuyAdapter,
    ReentrancyGuard,
    IAaveFlashLoanReceiver,
    IUniswapV3DebtSwapAdapter
{
    using SafeERC20 for IERC20;

    // unique identifier to track usage via flashloan events
    uint16 public constant REFERRER = 43983;

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

    /// @inheritdoc IUniswapV3DebtSwapAdapter
    function swapDebt(
        DebtSwapParams memory debtSwapParams,
        PermitInput memory debtTokenPermit
    ) external nonReentrant whenNotPaused {
        // true if flashloan is needed to swap debt
        if (!debtSwapParams.withFlashLoan) {
            _swapAndRepay(debtSwapParams);
        } else {
            _flash(debtSwapParams, debtTokenPermit);
        }
    }


    /**
     * @dev Executes the debt swap after receiving the flash-borrowed assets
     * @dev Workflow:
     * 1. Swap flash-borrowed new debt to old debt
     * 2. Repay old debt
     * 3. Flashloan repayment (automatically borrows new debt for user)
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

        (DebtSwapParams memory debtSwapParams, ) = abi.decode(
            params,
            (DebtSwapParams, PermitInput)
        );

        address flashLoanAsset = assets[0];
        uint256 flashLoanAmount = amounts[0];
        uint256 flashLoanPremium = premiums[0];

        // buy(exact out) old debt with the flash-borrowed new debt
        _buyOnUniswapV3(
            IERC20Detailed(flashLoanAsset),
            IERC20Detailed(debtSwapParams.debtAsset),
            flashLoanAmount,
            debtSwapParams.debtRepayAmount,
            debtSwapParams.swapPath,
            debtSwapParams.deadline
        );

        // repay the old debt
        _conditionalRenewAllowance(debtSwapParams.debtAsset, debtSwapParams.debtRepayAmount);
        POOL.repay(debtSwapParams.debtAsset, debtSwapParams.debtRepayAmount, 2, debtSwapParams.user);

        // flashloan repayment - allowance already set in constructor
        _conditionalRenewAllowance(flashLoanAsset, flashLoanAmount + flashLoanPremium);
        return true;
    }

    /**
     * @dev Swaps new debt to old debt and repays old debt (without flashloan)
     * @dev Workflow:
     * 1. Borrow new debt asset
     * 2. Swap new debt to old debt
     * 3. Repay old debt
     * @param debtSwapParams The debt swap parameters
     * @return The amount spent in the swap
     */
    function _swapAndRepay(
        DebtSwapParams memory debtSwapParams
    ) internal returns (uint256) {
        // borrow the new debt asset
        POOL.borrow(debtSwapParams.newDebtAsset, debtSwapParams.maxNewDebtAmount, 2, REFERRER, debtSwapParams.user);

        // buy(exact out) old debt with new debt
        uint256 amountSpent = _buyOnUniswapV3(
            IERC20Detailed(debtSwapParams.newDebtAsset),
            IERC20Detailed(debtSwapParams.debtAsset),
            debtSwapParams.maxNewDebtAmount,
            debtSwapParams.debtRepayAmount,
            debtSwapParams.swapPath,
            debtSwapParams.deadline
        );

        // repay the old debt
        _conditionalRenewAllowance(debtSwapParams.debtAsset, debtSwapParams.debtRepayAmount);
        POOL.repay(debtSwapParams.debtAsset, debtSwapParams.debtRepayAmount, 2, debtSwapParams.user);

        // transfer any leftover new debt asset to the user
        uint256 newDebtBalance = IERC20(debtSwapParams.newDebtAsset).balanceOf(address(this));
        if (newDebtBalance > 0) {
            IERC20(debtSwapParams.newDebtAsset).safeTransfer(debtSwapParams.user, newDebtBalance);
        }

        return amountSpent;
    }


    /**
     * @dev Triggers the flashloan for debt swap
     * @param debtSwapParams The debt swap parameters
     * @param debtTokenPermit The permit signature for debt token
     */
    function _flash(
        DebtSwapParams memory debtSwapParams,
        PermitInput memory debtTokenPermit
    ) internal virtual {
        bytes memory flashParams = abi.encode(debtSwapParams, debtTokenPermit);
        address[] memory assets = new address[](1);
        assets[0] = debtSwapParams.newDebtAsset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = debtSwapParams.maxNewDebtAmount;
        uint256[] memory interestRateModes = new uint256[](1);
        interestRateModes[0] = 2; // Variable debt mode - will borrow on behalf of user

        POOL.flashLoan(
            address(this),
            assets,
            amounts,
            interestRateModes,
            debtSwapParams.user,
            flashParams,
            REFERRER
        );
    }

}
