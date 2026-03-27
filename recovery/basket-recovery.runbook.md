# Basket Recovery Runbook

This recovery path is intentionally handled by dedicated scripts under `scripts/recovery/` instead of a normal `deploy/` tag flow.

Reason:
- the contract arguments depend on a reviewed live vault snapshot,
- `claimBaseD` is incident-specific policy input,
- accidental inclusion in normal fixture/tag deploys would be unsafe.

## Required operator inputs

1. `claimBaseD` in raw 18-decimal D units.
2. Confirmation that the burn sink remains `0x000000000000000000000000000000000000dEaD`.
3. Confirmation of the exact frozen basket.
4. Confirmation that deployment resolution should use deployed `D` and `D_CollateralHolderVault`, or explicit overrides.

## Preconditions

1. Keep `IssuerV2_2` paused.
2. Keep legacy `RedeemerV2` paused.
3. Do not resume normal D operations.
4. Do not unpause D until the new redeemer is deployed, role-configured, and ready.

## Prepare reviewed bundle

1. Copy `recovery/basket-recovery.config.example.json` to an environment-specific file.
2. Fill `claimBaseD`.
3. If the recovery basket should not be the vault's entire supported list, provide an explicit `assets` list.
4. If the recovery basket should include zero-balance supported assets with zero payout, set `includeZeroBalanceAssets=true`.
5. Run:

```bash
npx ts-node --files scripts/recovery/prepareBasketRecovery.ts \
  recovery/basket-recovery.config.saga-mainnet.json \
  recovery/basket-recovery.prepared.saga-mainnet.json
```

6. Review:
- `claimBaseD`
- `reconciliationMintAmount`
- `recoveryAssets`
- each `vaultBalance`
- each `payoutPerD`
- each `requiredBudget`
- any `unallocatableDust`

## Mint reconciliation supply

Run:

```bash
npx hardhat run --network saga_mainnet scripts/recovery/mintRecoverySupply.ts \
  recovery/basket-recovery.prepared.saga-mainnet.json \
  recovery/basket-recovery.mint.saga-mainnet.json
```

Notes:
- the script refuses to mint again if the burn sink balance no longer matches the prepared snapshot,
- if the expected mint already happened, it exits without minting again,
- use `--force` only after manual review if the sink balance changed unexpectedly.

## Deploy recovery redeemer

Run:

```bash
npx hardhat run --network saga_mainnet scripts/recovery/deployBasketRecoveryRedeemer.ts \
  recovery/basket-recovery.prepared.saga-mainnet.json \
  recovery/basket-recovery.deployed.saga-mainnet.json
```

The script:
- deploys `D_BasketRecoveryRedeemer`,
- grants `COLLATERAL_WITHDRAWER_ROLE` if possible,
- grants `DEFAULT_ADMIN_ROLE` and `PAUSER_ROLE` on the new redeemer to governance,
- revokes deployer admin/pauser roles when appropriate,
- queues Safe transactions on Saga mainnet when direct execution is unavailable.

## Readiness gate

Run:

```bash
npx hardhat run --network saga_mainnet scripts/recovery/checkBasketRecoveryReadiness.ts \
  recovery/basket-recovery.prepared.saga-mainnet.json \
  recovery/basket-recovery.deployed.saga-mainnet.json
```

The script fails if:
- the deployed redeemer does not match the prepared bundle,
- the redeemer is already unpaused,
- the redeemer lacks `COLLATERAL_WITHDRAWER_ROLE`,
- the vault is underfunded relative to the frozen basket.

## Opening sequence

1. Keep legacy `RedeemerV2` paused.
2. Keep `IssuerV2_2` paused.
3. Confirm reconciliation mint is complete.
4. Confirm the new redeemer has the vault withdrawer role.
5. Confirm readiness check passes.
6. Unpause the D token if it is paused.
7. Unpause `BasketRecoveryRedeemer`.
8. Publish the fixed per-D basket payout rates.
