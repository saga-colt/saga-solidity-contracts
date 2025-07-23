// SPDX-License-Identifier: GNU AGPLv3
pragma solidity 0.8.20;

import "../odos/interface/IOdosRouterV2.sol";
import "../odos/OdosSwapUtils.sol";
import "./FlashLoanLiquidatorAaveBorrowRepayBase.sol";

contract FlashLoanLiquidatorAaveBorrowRepayOdos is
    FlashLoanLiquidatorAaveBorrowRepayBase
{
    using SafeERC20 for ERC20;
    IOdosRouterV2 public immutable odosRouter;

    error InsufficientOutputAfterSwap(uint256 expected, uint256 actual);

    constructor(
        ILendingPool _flashLoanLender,
        ILendingPoolAddressesProvider _addressesProvider,
        ILendingPool _liquidateLender,
        uint256 _slippageTolerance,
        IOdosRouterV2 _odosRouter
    )
        FlashLoanLiquidatorAaveBorrowRepayBase(
            _flashLoanLender,
            _addressesProvider,
            _liquidateLender,
            _slippageTolerance
        )
    {
        odosRouter = _odosRouter;
    }

    /// @inheritdoc FlashLoanLiquidatorAaveBorrowRepayBase
    function _swapExactOutput(
        address _inputToken,
        address _outputToken,
        bytes memory _swapData,
        uint256 _amount,
        uint256 _maxIn
    ) internal override returns (uint256) {
        uint256 amountOut = OdosSwapUtils.excuteSwapOperation(
            odosRouter,
            _inputToken,
            _maxIn,
            _amount,
            _swapData
        );

        // Overflow protection
        if (amountOut < _amount) {
            revert InsufficientOutputAfterSwap(amountOut, _amount);
        }

        // We already make sure amountOut is greater than _amount in swap operation, so we can just subtract the amount
        uint256 leftover = amountOut - _amount;

        // Transfer the leftover to the caller
        ERC20(_outputToken).safeTransfer(msg.sender, leftover);

        return amountOut;
    }
}
