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

pragma solidity 0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IERC3156FlashBorrower} from "./interface/flashloan/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "./interface/flashloan/IERC3156FlashLender.sol";
import {DLoopCoreBase} from "../core/DLoopCoreBase.sol";
import {SwappableVault} from "contracts/common/SwappableVault.sol";
import {RescuableVault} from "contracts/common/RescuableVault.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";

/**
 * @title DLoopDecreaseLeverageBase
 * @dev A helper contract for decreasing leverage with flash loans
 *      - Suppose the core contract current leverage is 4x, target leverage is 3x, collateral token is WETH, debt token is dUSD
 *      - User wants to decrease leverage to target (3x) but doesn't have enough debt tokens
 *      - This contract will flashloan debt tokens, call decreaseLeverage on core to get collateral tokens,
 *        swap the received collateral tokens to debt tokens, and use the debt tokens to repay the flashloan
 *      - Example: Flash loan 50,000 dUSD -> call decreaseLeverage with 50,000 dUSD -> receive 25+ WETH -> swap to 50,000+ dUSD -> repay flash loan
 */
abstract contract DLoopDecreaseLeverageBase is
    IERC3156FlashBorrower,
    Ownable,
    ReentrancyGuard,
    SwappableVault,
    RescuableVault
{
    using SafeERC20 for ERC20;

    /* Constants */

    bytes32 public constant FLASHLOAN_CALLBACK =
        keccak256("ERC3156FlashBorrower.onFlashLoan");

    /* Core state */

    IERC3156FlashLender public immutable flashLender;
    // [dLoopCore][tokenAddress] -> leftOverAmount
    mapping(address => mapping(address => uint256))
        public minLeftoverCollateralTokenAmount;
    // [tokenAddress] -> exists (for gas efficient token tracking)
    mapping(address => bool) private _existingCollateralTokensMap;
    address[] public existingCollateralTokens;

    /* Errors */

    error UnknownLender(address msgSender, address flashLender);
    error UnknownInitiator(address initiator, address thisContract);
    error IncompatibleDLoopCoreDebtToken(
        address currentDebtToken,
        address dLoopCoreDebtToken
    );
    error CollateralTokenBalanceNotIncreasedAfterDecreaseLeverage(
        uint256 collateralTokenBalanceBeforeDecrease,
        uint256 collateralTokenBalanceAfterDecrease
    );
    error FlashLoanAmountExceedsMaxAvailable(
        uint256 requiredFlashLoanAmount,
        uint256 maxFlashLoanAmount
    );
    error LeverageNotDecreased(
        uint256 leverageBeforeDecrease,
        uint256 leverageAfterDecrease
    );
    error ReceivedCollateralTokenNotMetMinReceiveAmount(
        uint256 receivedCollateralTokenAmount,
        uint256 minOutputCollateralTokenAmount
    );
    error FlashLenderNotSameAsDebtToken(address flashLender, address debtToken);

    /* Events */

    event LeftoverCollateralTokensTransferred(
        address indexed dLoopCore,
        address indexed collateralToken,
        uint256 amount
    );
    event MinLeftoverCollateralTokenAmountSet(
        address indexed dLoopCore,
        address indexed collateralToken,
        uint256 minAmount
    );

    /* Structs */

    struct FlashLoanParams {
        address user;
        uint256 additionalDebtFromUser;
        uint256 requiredDebtAmount;
        bytes collateralToDebtTokenSwapData;
        DLoopCoreBase dLoopCore;
    }

    // Struct to group decrease leverage operation state to reduce stack depth
    struct DecreaseLeverageState {
        uint256 leverageBeforeDecrease;
        uint256 leverageAfterDecrease;
        uint256 collateralTokenBalanceBeforeDecrease;
        uint256 collateralTokenBalanceAfterDecrease;
        uint256 requiredFlashLoanAmount;
        uint256 debtFromUser;
        uint256 requiredDebtFromFlashLoan;
    }

    /**
     * @dev Constructor for the DLoopDecreaseLeverageBase contract
     * @param _flashLender Address of the flash loan provider
     */
    constructor(IERC3156FlashLender _flashLender) Ownable(msg.sender) {
        flashLender = _flashLender;
    }

    /* RescuableVault Override */

    /**
     * @dev Gets the restricted rescue tokens
     * @return restrictedTokens Restricted rescue tokens
     */
    function getRestrictedRescueTokens()
        public
        view
        virtual
        override
        returns (address[] memory restrictedTokens)
    {
        // Return the existing tokens as we handle leftover collateral tokens
        return existingCollateralTokens;
    }

    /* Decrease Leverage */

    /**
     * @dev Decreases leverage with flash loans
     *      - Flash loans debt tokens, calls decreaseLeverage, swaps received collateral tokens to debt tokens, uses debt tokens to repay flash loan
     * @param additionalDebtFromUser Additional debt token amount from user (can be 0)
     * @param minOutputCollateralTokenAmount Minimum amount of collateral token to receive (slippage protection)
     * @param collateralToDebtTokenSwapData Swap data from collateral token to debt token
     * @param dLoopCore Address of the DLoopCore contract to use
     * @return receivedCollateralTokenAmount Amount of collateral tokens received from decrease leverage operation
     */
    function decreaseLeverage(
        uint256 additionalDebtFromUser,
        uint256 minOutputCollateralTokenAmount,
        bytes calldata collateralToDebtTokenSwapData,
        DLoopCoreBase dLoopCore
    ) public nonReentrant returns (uint256 receivedCollateralTokenAmount) {
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // Transfer any additional debt token from user if provided
        if (additionalDebtFromUser > 0) {
            debtToken.safeTransferFrom(
                msg.sender,
                address(this),
                additionalDebtFromUser
            );
        }

        // Calculate the required debt amount to reach target leverage
        (uint256 requiredDebtAmount, int8 direction) = dLoopCore
            .getAmountToReachTargetLeverage(true); // Use vault token balance

        // Verify we need to decrease leverage
        if (direction != -1) {
            revert("Current leverage is already at or below target");
        }

        // Use struct to group related variables and reduce stack depth
        DecreaseLeverageState memory state;

        // Calculate how much we need from flash loan
        state.debtFromUser =
            additionalDebtFromUser +
            debtToken.balanceOf(address(this));
        if (requiredDebtAmount > state.debtFromUser) {
            state.requiredDebtFromFlashLoan =
                requiredDebtAmount -
                state.debtFromUser;

            // Check if flash loan amount is available
            uint256 maxFlashLoanAmount = flashLender.maxFlashLoan(
                address(debtToken)
            );
            if (state.requiredDebtFromFlashLoan > maxFlashLoanAmount) {
                revert FlashLoanAmountExceedsMaxAvailable(
                    state.requiredDebtFromFlashLoan,
                    maxFlashLoanAmount
                );
            }

            // Create flash loan params
            FlashLoanParams memory params = FlashLoanParams(
                msg.sender,
                additionalDebtFromUser,
                requiredDebtAmount,
                collateralToDebtTokenSwapData,
                dLoopCore
            );
            bytes memory data = _encodeParamsToData(params);

            // Record initial leverage
            state.leverageBeforeDecrease = dLoopCore.getCurrentLeverageBps();

            // This value is used to check if the collateral token balance increased after decrease leverage
            state.collateralTokenBalanceBeforeDecrease = collateralToken
                .balanceOf(address(this));

            // Approve flash lender to spend debt tokens for repayment
            debtToken.forceApprove(
                address(flashLender),
                state.requiredDebtFromFlashLoan +
                    flashLender.flashFee(
                        address(debtToken),
                        state.requiredDebtFromFlashLoan
                    )
            );

            // Make sure the flashLender is the same as the debt token
            if (address(flashLender) != address(debtToken)) {
                revert FlashLenderNotSameAsDebtToken(
                    address(flashLender),
                    address(debtToken)
                );
            }

            // Execute flash loan - main logic in onFlashLoan
            flashLender.flashLoan(
                this,
                address(debtToken),
                state.requiredDebtFromFlashLoan,
                data
            );

            // Verify leverage decreased
            state.leverageAfterDecrease = dLoopCore.getCurrentLeverageBps();
            if (state.leverageAfterDecrease >= state.leverageBeforeDecrease) {
                revert LeverageNotDecreased(
                    state.leverageBeforeDecrease,
                    state.leverageAfterDecrease
                );
            }

            // Calculate received collateral tokens
            state.collateralTokenBalanceAfterDecrease = collateralToken
                .balanceOf(address(this));
            if (
                state.collateralTokenBalanceAfterDecrease <=
                state.collateralTokenBalanceBeforeDecrease
            ) {
                revert CollateralTokenBalanceNotIncreasedAfterDecreaseLeverage(
                    state.collateralTokenBalanceBeforeDecrease,
                    state.collateralTokenBalanceAfterDecrease
                );
            }

            receivedCollateralTokenAmount =
                state.collateralTokenBalanceAfterDecrease -
                state.collateralTokenBalanceBeforeDecrease;
        } else {
            // No flash loan needed, direct decrease leverage
            state.leverageBeforeDecrease = dLoopCore.getCurrentLeverageBps();
            state.collateralTokenBalanceBeforeDecrease = collateralToken
                .balanceOf(address(this));

            // Approve debt token for core contract
            debtToken.forceApprove(address(dLoopCore), state.debtFromUser);

            // Call decrease leverage directly
            dLoopCore.decreaseLeverage(
                additionalDebtFromUser,
                minOutputCollateralTokenAmount
            );

            // Verify leverage decreased
            state.leverageAfterDecrease = dLoopCore.getCurrentLeverageBps();
            if (state.leverageAfterDecrease >= state.leverageBeforeDecrease) {
                revert LeverageNotDecreased(
                    state.leverageBeforeDecrease,
                    state.leverageAfterDecrease
                );
            }

            // Calculate received collateral tokens
            state.collateralTokenBalanceAfterDecrease = collateralToken
                .balanceOf(address(this));
            if (
                state.collateralTokenBalanceAfterDecrease <=
                state.collateralTokenBalanceBeforeDecrease
            ) {
                revert CollateralTokenBalanceNotIncreasedAfterDecreaseLeverage(
                    state.collateralTokenBalanceBeforeDecrease,
                    state.collateralTokenBalanceAfterDecrease
                );
            }

            receivedCollateralTokenAmount =
                state.collateralTokenBalanceAfterDecrease -
                state.collateralTokenBalanceBeforeDecrease;
        }

        // Slippage protection
        if (receivedCollateralTokenAmount < minOutputCollateralTokenAmount) {
            revert ReceivedCollateralTokenNotMetMinReceiveAmount(
                receivedCollateralTokenAmount,
                minOutputCollateralTokenAmount
            );
        }

        // Handle any leftover collateral tokens
        uint256 leftoverAmount = collateralToken.balanceOf(address(this));
        if (
            leftoverAmount >
            minLeftoverCollateralTokenAmount[address(dLoopCore)][
                address(collateralToken)
            ]
        ) {
            collateralToken.safeTransfer(address(dLoopCore), leftoverAmount);
            emit LeftoverCollateralTokensTransferred(
                address(dLoopCore),
                address(collateralToken),
                leftoverAmount
            );
        }

        // Transfer received collateral tokens to user
        collateralToken.safeTransfer(msg.sender, receivedCollateralTokenAmount);

        return receivedCollateralTokenAmount;
    }

    /* Flash loan entrypoint */

    /**
     * @dev Callback function for flash loans
     * @param initiator Address that initiated the flash loan
     * @param token Address of the flash-borrowed token
     * @param fee Flash loan fee
     * @param data Additional data passed to the flash loan
     * @return bytes32 The flash loan callback success bytes
     */
    function onFlashLoan(
        address initiator,
        address token,
        uint256, // amount (flash loan amount)
        uint256 fee,
        bytes calldata data
    ) external override returns (bytes32) {
        // This function does not need nonReentrant as the flash loan will be called by decreaseLeverage() public
        // function, which is already protected by nonReentrant
        // Moreover, this function is only be able to be called by the address(this) (check the initiator condition)
        // thus even though the flash loan is public and not protected by nonReentrant, it is still safe
        if (msg.sender != address(flashLender))
            revert UnknownLender(msg.sender, address(flashLender));
        if (initiator != address(this))
            revert UnknownInitiator(initiator, address(this));

        // Decode flash loan params
        FlashLoanParams memory flashLoanParams = _decodeDataToParams(data);
        DLoopCoreBase dLoopCore = flashLoanParams.dLoopCore;
        ERC20 collateralToken = dLoopCore.collateralToken();
        ERC20 debtToken = dLoopCore.debtToken();

        // Verify token compatibility
        if (token != address(debtToken))
            revert IncompatibleDLoopCoreDebtToken(token, address(debtToken));

        // Record collateral token balance before decrease leverage
        uint256 collateralTokenBalanceBeforeDecrease = collateralToken
            .balanceOf(address(this));

        // Approve debt for core contract
        debtToken.forceApprove(
            address(dLoopCore),
            flashLoanParams.requiredDebtAmount
        );

        // Call decrease leverage on core contract
        dLoopCore.decreaseLeverage(
            flashLoanParams.additionalDebtFromUser,
            0 // No min amount check here, will be checked in main function
        );

        // Verify we received collateral tokens
        uint256 collateralTokenBalanceAfterDecrease = collateralToken.balanceOf(
            address(this)
        );
        if (
            collateralTokenBalanceAfterDecrease <=
            collateralTokenBalanceBeforeDecrease
        ) {
            revert CollateralTokenBalanceNotIncreasedAfterDecreaseLeverage(
                collateralTokenBalanceBeforeDecrease,
                collateralTokenBalanceAfterDecrease
            );
        }

        // Swap collateral tokens to debt tokens to repay flash loan
        uint256 requiredDebtFromFlashLoan = flashLoanParams.requiredDebtAmount -
            flashLoanParams.additionalDebtFromUser -
            debtToken.balanceOf(address(this));

        _swapExactOutput(
            collateralToken,
            debtToken,
            requiredDebtFromFlashLoan + fee,
            type(uint256).max, // No slippage protection here
            address(this),
            block.timestamp,
            flashLoanParams.collateralToDebtTokenSwapData
        );

        return FLASHLOAN_CALLBACK;
    }

    /* Setters */

    /**
     * @dev Sets the minimum leftover collateral token amount for a given dLoopCore and collateral token
     * @param dLoopCore Address of the dLoopCore contract
     * @param collateralToken Address of the collateral token
     * @param minAmount Minimum leftover collateral token amount for the given dLoopCore and collateral token
     */
    function setMinLeftoverCollateralTokenAmount(
        address dLoopCore,
        address collateralToken,
        uint256 minAmount
    ) external nonReentrant onlyOwner {
        minLeftoverCollateralTokenAmount[dLoopCore][
            collateralToken
        ] = minAmount;
        if (!_existingCollateralTokensMap[collateralToken]) {
            _existingCollateralTokensMap[collateralToken] = true;
            existingCollateralTokens.push(collateralToken);
        }
        emit MinLeftoverCollateralTokenAmountSet(
            dLoopCore,
            collateralToken,
            minAmount
        );
    }

    /* Data encoding/decoding helpers */

    /**
     * @dev Encodes flash loan parameters to data
     * @param _flashLoanParams Flash loan parameters
     * @return data Encoded data
     */
    function _encodeParamsToData(
        FlashLoanParams memory _flashLoanParams
    ) internal pure returns (bytes memory data) {
        data = abi.encode(
            _flashLoanParams.user,
            _flashLoanParams.additionalDebtFromUser,
            _flashLoanParams.requiredDebtAmount,
            _flashLoanParams.collateralToDebtTokenSwapData,
            _flashLoanParams.dLoopCore
        );
    }

    /**
     * @dev Decodes data to flash loan parameters
     * @param data Encoded data
     * @return _flashLoanParams Decoded flash loan parameters
     */
    function _decodeDataToParams(
        bytes memory data
    ) internal pure returns (FlashLoanParams memory _flashLoanParams) {
        (
            _flashLoanParams.user,
            _flashLoanParams.additionalDebtFromUser,
            _flashLoanParams.requiredDebtAmount,
            _flashLoanParams.collateralToDebtTokenSwapData,
            _flashLoanParams.dLoopCore
        ) = abi.decode(data, (address, uint256, uint256, bytes, DLoopCoreBase));
    }
}
