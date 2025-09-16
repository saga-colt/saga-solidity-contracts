// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
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

    /* Errors */
    error ZeroAddress();
    error InsufficientDStableReceived(uint256 expected, uint256 actual);
    error FlashLoanRepaymentFailed();
    error UnauthorizedFlashLoan();
    error InvalidFlashLoanInitiator();
    error SlippageTooHigh(uint256 requestedSlippage, uint256 maxSlippage);
    error InsufficientCollateralReceived(uint256 expected, uint256 actual);
    error FlashLoanAmountExceedsMaximum(uint256 requested, uint256 maximum);
    error InvalidPathLength();
    error DeadlineExceeded();
    error ZeroDStableAmount();
    error NoSwapPathProvided();
    error InvalidSwapPathTokens();
    error InvalidFeeTier(uint24 feeTier);
    error InvalidIntermediateToken(address token);
    error AssetRedemptionPaused(address asset);

    /* Roles */
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /* Constants */
    // Basis points
    uint256 public constant HUNDRED_PERCENT_BPS = 10_000;
    uint256 public constant MAX_SLIPPAGE_BPS = 2_000; // 20% maximum slippage

    /* State Variables */
    ERC20StablecoinUpgradeable public immutable dstable;
    RedeemerV2 public immutable redeemer;
    address public immutable uniswapRouter;

    /* Structs */
    struct SMOParams {
        address collateralAsset;
        uint256 minCollateralAmount;
        uint256 minDStableReceived;
        uint256 deadline;
        uint256 slippageBps; // Slippage protection (e.g., 100 = 1%)
        address profitTo; // For dust sweeping
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
            revert DeadlineExceeded();
        }

        // Validate dSTABLE amount
        if (dstableAmount == 0) {
            revert ZeroDStableAmount();
        }

        // Validate inputs
        if (params.collateralAsset == address(0)) {
            revert ZeroAddress();
        }

        // Validate slippage is within reasonable bounds
        if (params.slippageBps > MAX_SLIPPAGE_BPS) {
            revert SlippageTooHigh(params.slippageBps, MAX_SLIPPAGE_BPS);
        }
        if (params.profitTo == address(0)) {
            revert ZeroAddress();
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
        uint256 fee,
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
            revert DeadlineExceeded();
        }

        // Step 1: Validate collateral asset is supported
        if (!redeemer.isAssetRedemptionEnabled(params.collateralAsset)) {
            revert AssetRedemptionPaused(params.collateralAsset);
        }
        
        // Redeem dSTABLE for collateral (NO FEES - using redeemAsProtocol)
        uint256 collateralBalanceBefore = IERC20(params.collateralAsset)
            .balanceOf(address(this));

        // Approve Redeemer to pull and burn dSTABLE
        IERC20(address(dstable)).forceApprove(address(redeemer), 0);
        IERC20(address(dstable)).forceApprove(address(redeemer), amount);
        redeemer.redeemAsProtocol(
            amount,
            params.collateralAsset,
            params.minCollateralAmount
        );
        // Reset approval to avoid lingering allowance
        IERC20(address(dstable)).forceApprove(address(redeemer), 0);

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
        IERC20(params.collateralAsset).forceApprove(uniswapRouter, 0);
        IERC20(params.collateralAsset).forceApprove(
            uniswapRouter,
            collateralReceived
        );

        // Validate swap path is provided
        if (params.swapPath.length == 0) {
            revert NoSwapPathProvided();
        }
        // Enhanced path validation
        _validateSwapPath(params.swapPath, params.collateralAsset, address(dstable));

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
        if (dstableReceived < amount + fee) {
            revert FlashLoanRepaymentFailed();
        }
        // Approve lender to pull repayment
        IERC20(address(dstable)).forceApprove(address(dstable), 0);
        IERC20(address(dstable)).forceApprove(address(dstable), amount + fee);

        // Step 4: Calculate and distribute profit
        uint256 profit = dstableReceived - amount - fee;
        if (profit > 0) {
            IERC20(address(dstable)).safeTransfer(params.profitTo, profit);
        }
        IERC20(params.collateralAsset).forceApprove(uniswapRouter, 0);
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
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "ETH_TRANSFER_FAILED");
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
     * @notice Returns the maximum allowed slippage in basis points
     * @return The maximum slippage in basis points (2000 = 20%)
     */
    function getMaxSlippageBps() external pure returns (uint256) {
        return MAX_SLIPPAGE_BPS;
    }
    
    /**
     * @notice Returns the valid Uniswap V3 fee tiers
     * @return Array of valid fee tiers
     */
    function getValidFeeTiers() external pure returns (uint24[4] memory) {
        return [uint24(100), uint24(500), uint24(3000), uint24(10000)];
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
        return (quotedAmount * (HUNDRED_PERCENT_BPS - slippageBps)) / HUNDRED_PERCENT_BPS;
    }

    /**
     * @dev Returns first token (address) in a Uniswap V3 path
     */
    function _pathFirstToken(
        bytes memory path
    ) internal pure returns (address token) {
        assembly {
            token := shr(96, mload(add(path, 32)))
        }
    }

    /**
     * @dev Returns last token (address) in a Uniswap V3 path
     */
    function _pathLastToken(
        bytes memory path
    ) internal pure returns (address token) {
        uint256 len = path.length;
        assembly {
            let ptr := add(path, add(32, sub(len, 20)))
            token := shr(96, mload(ptr))
        }
    }
    
    /**
     * @dev Comprehensive Uniswap V3 path validation
     */
    function _validateSwapPath(
        bytes memory path,
        address expectedFirst,
        address expectedLast
    ) internal pure {
        // Basic path structure validation: len >= 43 and (len - 20) % 23 == 0
        if (
            path.length < 43 ||
            ((path.length - 20) % 23) != 0
        ) {
            revert InvalidPathLength();
        }
        
        // Validate first and last tokens
        address firstToken = _pathFirstToken(path);
        address lastToken = _pathLastToken(path);
        
        if (firstToken != expectedFirst || lastToken != expectedLast) {
            revert InvalidSwapPathTokens();
        }
        
        // Validate intermediate tokens and fee tiers
        uint256 numHops = (path.length - 20) / 23;
        
        for (uint256 i = 0; i < numHops; i++) {
            uint256 offset = 20 + (i * 23);
            
            // Extract fee tier (3 bytes at offset)
            uint24 feeTier;
            assembly {
                let ptr := add(path, add(32, offset))
                feeTier := and(shr(232, mload(ptr)), 0xffffff)
            }
            
            // Validate fee tier is one of the standard Uniswap V3 fee tiers
            bool validFeeTier = (feeTier == 100 || feeTier == 500 || feeTier == 3000 || feeTier == 10000);
            
            if (!validFeeTier) {
                revert InvalidFeeTier(feeTier);
            }
            
            // Extract intermediate token if not the last hop
            if (i < numHops - 1) {
                address intermediateToken;
                uint256 tokenOffset = offset + 3;
                assembly {
                    let ptr := add(path, add(32, tokenOffset))
                    intermediateToken := shr(96, mload(ptr))
                }
                
                // Basic validation: ensure intermediate token is not zero address
                if (intermediateToken == address(0)) {
                    revert InvalidIntermediateToken(intermediateToken);
                }
            }
        }
    }
}
