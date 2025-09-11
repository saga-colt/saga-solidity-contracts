// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";

/**
 * @title MockDStable
 * @dev Mock implementation of dSTABLE token with flash mint functionality for testing
 */
contract MockDStable is ERC20, IERC3156FlashLender {
    bytes32 private constant RETURN_VALUE = keccak256("ERC3156FlashBorrower.onFlashLoan");

    error ERC3156UnsupportedToken(address token);
    error ERC3156ExceededMaxLoan(uint256 maxLoan);
    error ERC3156InvalidReceiver(address receiver);

    constructor() ERC20("Mock dSTABLE", "mdSTABLE") {
        _mint(msg.sender, 1000000 * 10**18); // Mint 1M tokens
    }

    function maxFlashLoan(address token) public view virtual returns (uint256) {
        return token == address(this) ? type(uint256).max - totalSupply() : 0;
    }

    function flashFee(address token, uint256 value) public view virtual returns (uint256) {
        if (token != address(this)) {
            revert ERC3156UnsupportedToken(token);
        }
        return 0; // No fee for testing
    }

    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 value,
        bytes calldata data
    ) public virtual returns (bool) {
        uint256 maxLoan = maxFlashLoan(token);
        if (value > maxLoan) {
            revert ERC3156ExceededMaxLoan(maxLoan);
        }
        uint256 fee = flashFee(token, value);
        _mint(address(receiver), value);
        if (receiver.onFlashLoan(_msgSender(), token, value, fee, data) != RETURN_VALUE) {
            revert ERC3156InvalidReceiver(address(receiver));
        }
        _spendAllowance(address(receiver), address(this), value + fee);
        _burn(address(receiver), value + fee);
        return true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
