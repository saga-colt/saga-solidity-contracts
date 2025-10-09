## Role Automation

- `make roles.scan`, `make roles.transfer --dry-run-only`, and `make roles.revoke --dry-run-only` now use the shared runners. Defaults point at the mainnet manifest (`manifests/saga-mainnet-roles.json`) so you can run them without additional arguments.
- To work against the testnet, override the defaults inline: `make roles.scan ROLES_NETWORK=saga_testnet ROLES_MANIFEST=manifests/saga-testnet-roles.json`.
- Mainnet actions assume the Saga governance Safe (`0xf19c…8644e`, threshold 2 on chain id 5464, RPC `https://sagaevm.jsonrpc.sagarpc.io/`). Verify with the Safe owners before executing live transfers.
- The testnet manifest intentionally omits Safe metadata—`make roles.revoke` will require you to pass `--safe-address`/`--chain-id` explicitly if you need to queue revocations there.
- Reports land under `reports/roles/` (ignored in git). JSON snapshots are overwritten per run; copy them elsewhere if you need to compare runs.
