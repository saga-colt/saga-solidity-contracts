// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "../odos/OdosSwapUtils.sol";
import "../odos/interface/IOdosRouterV2.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";

/**
 * @title OdosSwapper (Mock)
 * @notice Mock contract for executing Odos swaps using OdosSwapUtils library. Placed under /mocks for testing purposes only.
 */
contract OdosSwapper {
    using OdosSwapUtils for *;
    using SafeTransferLib for ERC20;

    IOdosRouterV2 public immutable router;

    constructor(address _router) {
        router = IOdosRouterV2(payable(_router));
    }

    /**
     * @notice Performs a swap operation using Odos router with provided swap data
     * @param inputToken Address of the input token
     * @param maxIn Maximum input amount approved for the swap
     * @param exactOut Exact amount of output token expected
     * @param swapData Encoded swap path data for Odos router
     */
    function executeSwapOperation(
        address inputToken,
        uint256 maxIn,
        uint256 exactOut,
        bytes calldata swapData
    ) external {
        ERC20(inputToken).safeTransferFrom(msg.sender, address(this), maxIn);
        OdosSwapUtils.executeSwapOperation(
            router,
            inputToken,
            maxIn,
            exactOut,
            swapData
        );
    }
}
