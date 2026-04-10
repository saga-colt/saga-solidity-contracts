# Basket Recovery Runbook

This recovery path is intentionally handled by dedicated scripts under `scripts/recovery/` instead of a normal `deploy/` tag flow.

Reason:

- the contract arguments depend on a reviewed live vault snapshot,
- `claimBaseD` is incident-specific policy input,
- accidental inclusion in normal fixture/tag deploys would be unsafe.

## Required operator inputs

1. `claimBaseD` in raw 18-decimal D units.
2. Confirmation that `claimBaseD` comes from the frozen non-dead holder snapshot, not from `totalSupply()`.
3. Confirmation that the burn sink remains `0x000000000000000000000000000000000000dEaD`.
4. Confirmation of the exact frozen basket.
5. Confirmation that deployment resolution should use deployed `D` and `D_CollateralHolderVault`, or explicit overrides.

## Preconditions

1. Keep `IssuerV2_2` paused.
2. Keep legacy `RedeemerV2` paused.
3. Do not resume normal D operations.
4. Do not unpause D until the new redeemer is deployed, role-configured, and ready.

## Saga Mainnet Snapshot

Current pre-recovery snapshot on Saga mainnet as of 2026-04-10:

- `claimBaseD`: pending the frozen non-dead holder snapshot; do not reuse `D.totalSupply()` as a substitute
- observed `D.totalSupply()`: `1092432313218908894107481` (`1092432.313218908894107481 D`)
- `reconciliationMintSink`: `0x000000000000000000000000000000000000dEaD`
- current D balance at the burn sink before the planned reconciliation mint: `14059213281592607716076142` (`14059213.281592607716076142 D`)
- live pause state observed on-chain:
  - `D.paused() = false`
  - `IssuerV2_2.paused() = false`
  - `RedeemerV2.paused() = false`
- finalized explicit recovery basket:
  - `vyUSD` `0x704a58f888f18506C9Fc199e53AE220B5fdCaEd8`: `1190842450426070805633955` (`1190842.450426070805633955`)
  - `MUST` `0xA8b56ce258a7f55327BdE886B0e947EE059ca434`: `3560133346713730385538439` (`3560133.346713730385538439`)
- residual non-basket vault dust at snapshot time:
  - `yUSD`: `1`
  - `USDT`: `31179` (`0.031179`)
  - `USDN`: `379165` (`0.379165`)

Relevant observed transactions:

- Attacker D sent to the burn sink: [`0xc6257c03f0610789e9c6c19fb2b453f7b0ad37a17bad1e4e960f4a5cf9565cfc`](https://sagaevm.sagaexplorer.io/tx/0xc6257c03f0610789e9c6c19fb2b453f7b0ad37a17bad1e4e960f4a5cf9565cfc)
- MUST top-up into `D_CollateralHolderVault`: [`0xc2131f45d861c55a877d99ef8de9e796b909ec0cb885ea42a100a852d9572ec6`](https://sagaevm.sagaexplorer.io/tx/0xc2131f45d861c55a877d99ef8de9e796b909ec0cb885ea42a100a852d9572ec6)

Important interpretation:

- The existing D already at `0x...dEaD` is treated as irredeemable attacker balance and is excluded from `claimBaseD`.
- `reconciliationMintAmount` must be derived as `max(claimBaseD - currentTotalSupply(), 0)`; it is an additional mint to the same sink, not a target final sink balance.
- Because the burn sink already has unrelated D, preparation and mint review must use the live pre-mint sink balance and reason about the mint as a delta.
- The live ERC-20 accounting remains visibly inconsistent: `D.totalSupply()` is below the current `0x...dEaD` balance even before the reconciliation mint. Treat this as an unresolved accounting-state concern that must be consciously accepted before opening redemption.

## Prepare reviewed bundle

1. Copy `recovery/basket-recovery.config.example.json` to an environment-specific file.
2. Fill `claimBaseD`.
3. Leave `reconciliationMintAmount` unset unless you are intentionally cross-checking the derived value.
4. If the recovery basket should not be the vault's entire supported list, provide an explicit `assets` list.
5. If the recovery basket should include zero-balance supported assets with zero payout, set `includeZeroBalanceAssets=true`.
6. Run:

```bash
npx ts-node --files scripts/recovery/prepareBasketRecovery.ts \
  recovery/basket-recovery.config.saga-mainnet.json \
  recovery/basket-recovery.prepared.saga-mainnet.json
```

7. Review:

- `claimBaseD`
- `reconciliationMintAmount`
- `reconciledTotalSupplyAfterMint` equals `claimBaseD`
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
- the script assumes the prepared bundle already derived `reconciliationMintAmount = max(claimBaseD - currentTotalSupply, 0)`,
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
