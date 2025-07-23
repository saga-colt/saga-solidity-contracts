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

import {DLoopIncreaseLeverageBase, ERC20, IERC3156FlashLender} from "../../DLoopIncreaseLeverageBase.sol";
import {OdosSwapLogic, IOdosRouterV2} from "./OdosSwapLogic.sol";

/**
 * @title DLoopIncreaseLeverageOdos
 * @dev Implementation of DLoopIncreaseLeverageBase with Odos swap functionality
 */
contract DLoopIncreaseLeverageOdos is DLoopIncreaseLeverageBase {
    IOdosRouterV2 public immutable odosRouter;

    /**
     * @dev Constructor for the DLoopIncreaseLeverageOdos contract
     * @param _flashLender Address of the flash loan provider
     * @param _odosRouter Address of the Odos router
     */
    constructor(
        IERC3156FlashLender _flashLender,
        IOdosRouterV2 _odosRouter
    ) DLoopIncreaseLeverageBase(_flashLender) {
        odosRouter = _odosRouter;
    }

    /**
     * @dev Swaps an exact amount of output tokens for the minimum input tokens using Odos
     */
    function _swapExactOutputImplementation(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory debtTokenToCollateralSwapData
    ) internal override returns (uint256) {
        return
            OdosSwapLogic.swapExactOutput(
                inputToken,
                outputToken,
                amountOut,
                amountInMaximum,
                receiver,
                deadline,
                debtTokenToCollateralSwapData,
                odosRouter
            );
    }
}
