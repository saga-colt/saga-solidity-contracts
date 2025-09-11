// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "contracts/common/IMintableERC20.sol";
import "contracts/dstable/ERC20StablecoinUpgradeable.sol";
import "contracts/dstable/RedeemerV2.sol";
import "../Uniswap/Uniswapv3/interfaces/ISwapRouter.sol";

/**
 * @title SMOHelper
 * @dev Enhanced Stablecoin Market Operations Helper contract with advanced routing
 *
 * This contract facilitates SMO operations with:
 * 1. Flash minting dSTABLE tokens
 * 2. Redeeming dSTABLE for collateral (using redeemAsProtocol - no fees)
 * 3. Advanced UniswapV3 routing with automatic route discovery
 * 4. Multi-strategy routing (direct, via dUSD, via USDC)
 * 5. Gas optimizations and dust management
 * 6. Repaying the flash loan and distributing profit
 */
contract SMOHelper is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /* Events */
    event SMOExecuted(
        address indexed collateralAsset,
        uint256 dstableAmount,
        uint256 collateralAmount,
        uint256 dstableReceived,
        uint256 profit,
        string routingMethod
    );

    event OperatorSet(address indexed oldOperator, address indexed newOperator);

    /* Errors */
    error ZeroAddress();
    error InsufficientDStableReceived(uint256 expected, uint256 actual);
    error FlashLoanRepaymentFailed();
    error UnauthorizedFlashLoan();
    error InvalidFlashLoanInitiator();
    error SlippageTooHigh(uint256 expected, uint256 actual);
    error InsufficientCollateralReceived(uint256 expected, uint256 actual);
    error FlashLoanAmountExceedsMaximum(uint256 requested, uint256 maximum);
    error InvalidPathLength();

    /* Roles */
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /* Constants */
    // Uniswap V3 addresses
    address public constant UNISWAP_V3_FACTORY =
        0x1F98431c8aD98523631AE4a59f267346ea31F984;

    // Token addresses
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant USDC = 0xfc960C233B8E98e0Cf282e29BDE8d3f105fc24d5;

    // Basis points
    uint256 public constant BPS = 10_000;

    /* State Variables */
    ERC20StablecoinUpgradeable public immutable dstable;
    RedeemerV2 public immutable redeemer;
    address public immutable uniswapRouter;
    address public operator;

    /* Structs */
    struct SMOParams {
        address collateralAsset;
        uint256 minCollateralAmount;
        uint256 minDStableReceived;
        uint256 deadline;
        uint256 slippageBps; // Slippage protection (e.g., 100 = 1%)
        address refundTo; // For dust sweeping
        // Route information (discovered off-chain)
        bytes swapPath; // Encoded Uniswap V3 multihop path
        uint256 expectedAmountOut; // Expected output amount (for slippage calculation)
    }

    constructor(
        address _dstable,
        address _redeemer,
        address _uniswapRouter,
        address _operator
    ) {
        if (
            _dstable == address(0) ||
            _redeemer == address(0) ||
            _uniswapRouter == address(0) ||
            _operator == address(0)
        ) {
            revert ZeroAddress();
        }

        dstable = ERC20StablecoinUpgradeable(_dstable);
        redeemer = RedeemerV2(_redeemer);
        uniswapRouter = _uniswapRouter;
        operator = _operator;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, _operator);
    }

    /**
     * @notice Executes a Stablecoin Market Operation with enhanced routing
     * @param dstableAmount Amount of dSTABLE to flash mint
     * @param params Enhanced SMO parameters including routing options
     */
    function executeSMO(
        uint256 dstableAmount,
        SMOParams calldata params
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        // Validate deadline
        if (block.timestamp > params.deadline) {
            revert("SMOHelper: Transaction deadline exceeded");
        }

        // Validate dSTABLE amount
        if (dstableAmount == 0) {
            revert("SMOHelper: dSTABLE amount cannot be zero");
        }

        // Check if flash loan is supported
        uint256 maxFlashLoan = dstable.maxFlashLoan(address(dstable));
        if (dstableAmount > maxFlashLoan) {
            revert FlashLoanAmountExceedsMaximum(dstableAmount, maxFlashLoan);
        }

        // Encode enhanced parameters
        bytes memory data = abi.encode(params);

        // Execute flash loan with enhanced callback
        dstable.flashLoan(
            IERC3156FlashBorrower(address(this)),
            address(dstable),
            dstableAmount,
            data
        );
    }

    /**
     * @notice Flash loan callback function with enhanced routing
     * @param initiator Address that initiated the flash loan
     * @param amount Amount being flash loaned
     * @param data Encoded SMO parameters
     * @return keccak256("ERC3156FlashBorrower.onFlashLoan")
     */
    function onFlashLoan(
        address initiator,
        address /* token */,
        uint256 amount,
        uint256 /* fee */,
        bytes calldata data
    ) external returns (bytes32) {
        // Validate flash loan
        if (msg.sender != address(dstable)) {
            revert UnauthorizedFlashLoan();
        }
        if (initiator != address(this)) {
            revert InvalidFlashLoanInitiator();
        }

        // Decode SMO parameters
        SMOParams memory params = abi.decode(data, (SMOParams));

        // Validate deadline
        if (block.timestamp > params.deadline) {
            revert("SMOHelper: Transaction deadline exceeded");
        }

        // Step 1: Redeem dSTABLE for collateral (NO FEES - using redeemAsProtocol)
        uint256 collateralBalanceBefore = IERC20(params.collateralAsset)
            .balanceOf(address(this));

        redeemer.redeemAsProtocol(
            amount,
            params.collateralAsset,
            params.minCollateralAmount
        );

        uint256 collateralReceived = IERC20(params.collateralAsset).balanceOf(
            address(this)
        ) - collateralBalanceBefore;

        // Validate collateral received
        if (collateralReceived < params.minCollateralAmount) {
            revert InsufficientCollateralReceived(
                params.minCollateralAmount,
                collateralReceived
            );
        }

        // Step 2: Find and execute optimal swap
        uint256 dstableBalanceBefore = dstable.balanceOf(address(this));
        string memory routingMethod;

        // Approve router to spend collateral tokens
        IERC20(params.collateralAsset).approve(
            uniswapRouter,
            collateralReceived
        );

        // Validate swap path is provided
        if (params.swapPath.length == 0) {
            revert("SMOHelper: No swap path provided");
        }

        // Calculate amount limit with slippage protection
        uint256 amountLimit = _calculateAmountLimit(
            params.expectedAmountOut,
            params.slippageBps
        );

        // Execute multihop swap
        ISwapRouter.ExactInputParams memory swapParams = ISwapRouter
            .ExactInputParams({
                path: params.swapPath,
                recipient: address(this),
                deadline: params.deadline,
                amountIn: collateralReceived,
                amountOutMinimum: amountLimit
            });

        ISwapRouter(uniswapRouter).exactInput(swapParams);
        routingMethod = "V3-Multihop";

        uint256 dstableReceived = dstable.balanceOf(address(this)) -
            dstableBalanceBefore;

        // Validate dSTABLE received
        if (dstableReceived < params.minDStableReceived) {
            revert InsufficientDStableReceived(
                params.minDStableReceived,
                dstableReceived
            );
        }

        // Step 3: Repay flash loan
        if (dstableReceived < amount) {
            revert FlashLoanRepaymentFailed();
        }

        // Transfer dSTABLE back to repay flash loan
        dstable.transfer(address(dstable), amount);

        // Step 4: Calculate and distribute profit
        uint256 profit = dstableReceived - amount;
        if (profit > 0) {
            dstable.transfer(operator, profit);
        }
        IERC20(params.collateralAsset).approve(uniswapRouter, 0);
        // Emit event with routing method
        emit SMOExecuted(
            params.collateralAsset,
            amount,
            collateralReceived,
            dstableReceived,
            profit,
            routingMethod
        );

        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    /**
     * @notice Sets a new operator address
     * @param newOperator The new operator address
     */
    function setOperator(
        address newOperator
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newOperator == address(0)) {
            revert ZeroAddress();
        }

        address oldOperator = operator;
        operator = newOperator;

        // Update roles
        _revokeRole(OPERATOR_ROLE, oldOperator);
        _grantRole(OPERATOR_ROLE, newOperator);

        emit OperatorSet(oldOperator, newOperator);
    }

    /**
     * @notice Pauses the contract
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Rescues stuck ETH
     * @param to Address to send ETH to
     * @param amount Amount of ETH to rescue
     */
    function rescueETH(
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) {
            revert ZeroAddress();
        }
        payable(to).transfer(amount);
    }

    /**
     * @notice Rescues stuck tokens
     * @param token Token to rescue
     * @param to Address to send tokens to
     * @param amount Amount of tokens to rescue
     */
    function rescueTokens(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) {
            revert ZeroAddress();
        }
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Returns the current operator address
     * @return The operator address
     */
    function getOperator() external view returns (address) {
        return operator;
    }

    /**
     * @notice Returns the UniswapV3 router address
     * @return The UniswapV3 router address
     */
    function getUniswapRouter() external view returns (address) {
        return uniswapRouter;
    }

    /**
     * @notice Returns the dSTABLE token address
     * @return The dSTABLE token address
     */
    function getDStableToken() external view returns (address) {
        return address(dstable);
    }

    /**
     * @notice Returns the Redeemer contract address
     * @return The Redeemer contract address
     */
    function getRedeemer() external view returns (address) {
        return address(redeemer);
    }

    /**
     * @notice Checks if the contract supports the IERC3156FlashBorrower interface
     * @param interfaceId The interface ID to check
     * @return True if the interface is supported
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IERC3156FlashBorrower).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // Allow contract to receive ETH
    receive() external payable {}

    /* Internal Functions */

    /**
     * @notice Calculates amount limit with slippage protection (exact input only)
     */
    function _calculateAmountLimit(
        uint256 quotedAmount,
        uint256 slippageBps
    ) internal pure returns (uint256) {
        // For exact input: minOut = floor(quotedOut * (1 - slippageBps/BPS))
        return (quotedAmount * (BPS - slippageBps)) / BPS;
    }

    /**
     * @notice Converts uint256 to string
     */
    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (_i != 0) {
            k = k - 1;
            uint8 temp = (48 + uint8(_i - (_i / 10) * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }

    /**
     * @notice Sweeps dust tokens to refund address
     */
    function _sweepDust(address refundTo) internal {
        // Sweep any remaining dSTABLE dust
        uint256 dustAmount = dstable.balanceOf(address(this));
        if (dustAmount > 0) {
            dstable.transfer(refundTo, dustAmount);
        }
    }
}
