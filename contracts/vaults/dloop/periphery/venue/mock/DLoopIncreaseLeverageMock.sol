// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/     \/_/     \/_/   \/_____/    *
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

import {DLoopIncreaseLeverageBase, ERC20, IERC3156FlashLender} from "../../DLoopIncreaseLeverageBase.sol";
import {SimpleDEXMock} from "contracts/testing/dex/SimpleDEXMock.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title DLoopIncreaseLeverageMock
 * @dev Implementation of DLoopIncreaseLeverageBase with SimpleDEXMock swap functionality
 */
contract DLoopIncreaseLeverageMock is DLoopIncreaseLeverageBase {
    SimpleDEXMock public immutable simpleDEXMock;

    /**
     * @dev Constructor for the DLoopIncreaseLeverageMock contract
     * @param _flashLender Address of the flash loan provider
     * @param _simpleDEXMock Address of the SimpleDEXMock contract
     */
    constructor(
        IERC3156FlashLender _flashLender,
        SimpleDEXMock _simpleDEXMock
    ) DLoopIncreaseLeverageBase(_flashLender) {
        simpleDEXMock = _simpleDEXMock;
    }

    /**
     * @dev Swaps an exact amount of output tokens for the minimum input tokens using SimpleDEXMock
     */
    function _swapExactOutputImplementation(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256, // deadline
        bytes memory // debtTokenToCollateralSwapData
    ) internal override returns (uint256) {
        // Approve the SimpleDEXMock to spend the input token
        require(
            inputToken.approve(address(simpleDEXMock), amountInMaximum),
            "Approve simpleDEXMock to spend input token failed"
        );

        return
            simpleDEXMock.executeSwapExactOutput(
                IERC20Metadata(address(inputToken)),
                IERC20Metadata(address(outputToken)),
                amountOut,
                amountInMaximum,
                receiver
            );
    }
}
