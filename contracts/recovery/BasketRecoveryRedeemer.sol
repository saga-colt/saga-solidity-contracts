// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import "contracts/common/IMintableERC20.sol";
import "contracts/dstable/CollateralVault.sol";

/**
 * @title BasketRecoveryRedeemer
 * @notice Wind-down-only redeemer that burns D and withdraws a fixed pro-rata basket from the live collateral vault.
 * @dev
 *  - Ratios are frozen at deployment time.
 *  - Minting must remain disabled during the recovery process.
 *  - A separate supply-reconciliation mint to a non-redeemable burn sink may be required before opening redemption.
 *  - This contract must be granted COLLATERAL_WITHDRAWER_ROLE on the target collateral vault.
 */
contract BasketRecoveryRedeemer is AccessControl, Pausable, ReentrancyGuard {
    struct RecoveryAssetState {
        uint256 payoutPerD;
        uint256 cumulativePaid;
        bool configured;
    }

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IMintableERC20 public immutable dstable;
    uint8 public immutable dstableDecimals;
    uint256 private immutable _dstableUnit;
    CollateralVault public immutable collateralVault;
    uint256 public immutable claimBaseD;

    address[] private _recoveryAssets;
    mapping(address => RecoveryAssetState) private _assetStates;

    uint256 public totalRedeemedD;

    event RecoveryAssetConfigured(address indexed asset, uint256 payoutPerD, uint256 requiredBudget);
    event BasketRedemption(address indexed redeemer, uint256 dstableAmount);
    event BasketRedemptionAsset(address indexed redeemer, address indexed asset, uint256 assetAmount);

    error CannotBeZeroAddress();
    error ZeroClaimBase();
    error EmptyRecoveryAssetList();
    error AllPayoutRatesZero();
    error InvalidArrayLengths(uint256 assetsLength, uint256 payoutLength);
    error DuplicateRecoveryAsset(address asset);
    error UnknownRecoveryAsset(address asset);
    error ZeroRedeemAmount();
    error RedemptionAmountTooSmall(uint256 dstableAmount);
    error ClaimBaseExceeded(uint256 requestedTotalRedeemed, uint256 claimBaseD);
    error InsufficientVaultBalance(address asset, uint256 requiredAmount, uint256 availableAmount);

    constructor(
        address _dstable,
        address _collateralVault,
        uint256 _claimBaseD,
        address[] memory recoveryAssets_,
        uint256[] memory payoutPerD_
    ) {
        if (_dstable == address(0) || _collateralVault == address(0)) {
            revert CannotBeZeroAddress();
        }
        if (_claimBaseD == 0) {
            revert ZeroClaimBase();
        }
        if (recoveryAssets_.length == 0) {
            revert EmptyRecoveryAssetList();
        }
        if (recoveryAssets_.length != payoutPerD_.length) {
            revert InvalidArrayLengths(recoveryAssets_.length, payoutPerD_.length);
        }

        dstable = IMintableERC20(_dstable);
        dstableDecimals = dstable.decimals();
        _dstableUnit = 10 ** uint256(dstableDecimals);
        collateralVault = CollateralVault(_collateralVault);
        claimBaseD = _claimBaseD;

        bool anyNonZeroPayout = false;
        for (uint256 i = 0; i < recoveryAssets_.length; i++) {
            address asset = recoveryAssets_[i];
            if (asset == address(0)) {
                revert CannotBeZeroAddress();
            }
            for (uint256 j = 0; j < i; j++) {
                if (recoveryAssets_[j] == asset) {
                    revert DuplicateRecoveryAsset(asset);
                }
            }

            uint256 assetPayoutPerD = payoutPerD_[i];
            if (assetPayoutPerD > 0) {
                anyNonZeroPayout = true;
            }

            _recoveryAssets.push(asset);
            _assetStates[asset] = RecoveryAssetState({
                payoutPerD: assetPayoutPerD,
                cumulativePaid: 0,
                configured: true
            });

            emit RecoveryAssetConfigured(asset, assetPayoutPerD, requiredBudgetForAssetInternal(assetPayoutPerD));
        }

        if (!anyNonZeroPayout) {
            revert AllPayoutRatesZero();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        _pause();
    }

    /**
     * @notice Redeem D for the fixed recovery basket.
     * @dev Uses cumulative accounting per asset so the total distributed amount is deterministic and
     *      independent of how users partition redemptions across transactions.
     */
    function redeem(uint256 dstableAmount) external whenNotPaused nonReentrant {
        if (dstableAmount == 0) {
            revert ZeroRedeemAmount();
        }

        uint256 redeemedAfter = totalRedeemedD + dstableAmount;
        if (redeemedAfter > claimBaseD) {
            revert ClaimBaseExceeded(redeemedAfter, claimBaseD);
        }

        uint256 assetCount = _recoveryAssets.length;
        uint256[] memory payouts = new uint256[](assetCount);
        uint256[] memory cumulativePaidAfter = new uint256[](assetCount);

        bool anyPositivePayout = false;
        for (uint256 i = 0; i < assetCount; i++) {
            address asset = _recoveryAssets[i];
            RecoveryAssetState storage assetState = _assetStates[asset];

            uint256 nextCumulativePaid = Math.mulDiv(redeemedAfter, assetState.payoutPerD, _dstableUnit);
            uint256 payout = nextCumulativePaid - assetState.cumulativePaid;

            payouts[i] = payout;
            cumulativePaidAfter[i] = nextCumulativePaid;

            if (payout > 0) {
                anyPositivePayout = true;

                uint256 available = IERC20Metadata(asset).balanceOf(address(collateralVault));
                if (available < payout) {
                    revert InsufficientVaultBalance(asset, payout, available);
                }
            }
        }

        if (!anyPositivePayout) {
            revert RedemptionAmountTooSmall(dstableAmount);
        }

        dstable.burnFrom(msg.sender, dstableAmount);
        totalRedeemedD = redeemedAfter;

        emit BasketRedemption(msg.sender, dstableAmount);

        for (uint256 i = 0; i < assetCount; i++) {
            address asset = _recoveryAssets[i];
            RecoveryAssetState storage assetState = _assetStates[asset];

            assetState.cumulativePaid = cumulativePaidAfter[i];

            uint256 payout = payouts[i];
            if (payout > 0) {
                collateralVault.withdrawTo(msg.sender, payout, asset);
                emit BasketRedemptionAsset(msg.sender, asset, payout);
            }
        }
    }

    function previewRedeem(
        uint256 dstableAmount
    ) external view returns (address[] memory assets, uint256[] memory payouts, bool anyPositivePayout) {
        if (dstableAmount == 0) {
            assets = _copyRecoveryAssets();
            payouts = new uint256[](_recoveryAssets.length);
            return (assets, payouts, false);
        }

        uint256 redeemedAfter = totalRedeemedD + dstableAmount;
        if (redeemedAfter > claimBaseD) {
            revert ClaimBaseExceeded(redeemedAfter, claimBaseD);
        }

        uint256 assetCount = _recoveryAssets.length;
        assets = _copyRecoveryAssets();
        payouts = new uint256[](assetCount);

        for (uint256 i = 0; i < assetCount; i++) {
            address asset = assets[i];
            RecoveryAssetState storage assetState = _assetStates[asset];
            uint256 nextCumulativePaid = Math.mulDiv(redeemedAfter, assetState.payoutPerD, _dstableUnit);
            payouts[i] = nextCumulativePaid - assetState.cumulativePaid;
            if (payouts[i] > 0) {
                anyPositivePayout = true;
            }
        }
    }

    function recoveryAssets() external view returns (address[] memory) {
        return _copyRecoveryAssets();
    }

    function recoveryAssetCount() external view returns (uint256) {
        return _recoveryAssets.length;
    }

    function getAssetState(
        address asset
    ) external view returns (uint256 payoutPerD_, uint256 cumulativePaid_, uint256 requiredBudget, uint256 remainingBudget) {
        RecoveryAssetState storage assetState = _assetStates[asset];
        if (!assetState.configured) {
            revert UnknownRecoveryAsset(asset);
        }

        payoutPerD_ = assetState.payoutPerD;
        cumulativePaid_ = assetState.cumulativePaid;
        requiredBudget = requiredBudgetForAssetInternal(assetState.payoutPerD);
        remainingBudget = requiredBudget > cumulativePaid_ ? requiredBudget - cumulativePaid_ : 0;
    }

    function isRecoveryAsset(address asset) external view returns (bool) {
        return _assetStates[asset].configured;
    }

    function payoutPerD(address asset) external view returns (uint256) {
        RecoveryAssetState storage assetState = _assetStates[asset];
        if (!assetState.configured) {
            revert UnknownRecoveryAsset(asset);
        }
        return assetState.payoutPerD;
    }

    function cumulativePaid(address asset) external view returns (uint256) {
        RecoveryAssetState storage assetState = _assetStates[asset];
        if (!assetState.configured) {
            revert UnknownRecoveryAsset(asset);
        }
        return assetState.cumulativePaid;
    }

    function requiredBudgetForAsset(address asset) external view returns (uint256) {
        RecoveryAssetState storage assetState = _assetStates[asset];
        if (!assetState.configured) {
            revert UnknownRecoveryAsset(asset);
        }
        return requiredBudgetForAssetInternal(assetState.payoutPerD);
    }

    function remainingBudgetForAsset(address asset) external view returns (uint256) {
        RecoveryAssetState storage assetState = _assetStates[asset];
        if (!assetState.configured) {
            revert UnknownRecoveryAsset(asset);
        }

        uint256 requiredBudget = requiredBudgetForAssetInternal(assetState.payoutPerD);
        uint256 alreadyPaid = assetState.cumulativePaid;
        return requiredBudget > alreadyPaid ? requiredBudget - alreadyPaid : 0;
    }

    function remainingClaimBaseD() external view returns (uint256) {
        return claimBaseD > totalRedeemedD ? claimBaseD - totalRedeemedD : 0;
    }

    function dstableUnit() external view returns (uint256) {
        return _dstableUnit;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function requiredBudgetForAssetInternal(uint256 assetPayoutPerD) internal view returns (uint256) {
        return Math.mulDiv(claimBaseD, assetPayoutPerD, _dstableUnit);
    }

    function _copyRecoveryAssets() internal view returns (address[] memory copiedAssets) {
        uint256 assetCount = _recoveryAssets.length;
        copiedAssets = new address[](assetCount);
        for (uint256 i = 0; i < assetCount; i++) {
            copiedAssets[i] = _recoveryAssets[i];
        }
    }
}
