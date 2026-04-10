import fs from "fs";
import path from "path";

import hre from "hardhat";

import { getConfig } from "../../config/config";
import {
  D_COLLATERAL_VAULT_CONTRACT_ID,
  D_ISSUER_V2_2_CONTRACT_ID,
  D_REDEEMER_CONTRACT_ID,
  D_TOKEN_ID,
} from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

interface PreparedRecoveryBundle {
  dstable: {
    address: string;
    reconciliationMintAmount: string;
    reconciliationMintSink: string;
  };
  collateralVault: string;
}

function buildTx(to: string, data: string): SafeTransactionData {
  return {
    to,
    value: "0",
    data,
  };
}

async function main(): Promise<void> {
  const [bundlePathArg] = process.argv.slice(2);
  if (!bundlePathArg) {
    throw new Error(
      "Usage: npx ts-node --files scripts/recovery/queueRecoveryGovernanceActions.ts <prepared-bundle.json>",
    );
  }

  const bundlePath = path.resolve(bundlePathArg);
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")) as PreparedRecoveryBundle;

  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const governanceMultisig = config.walletAddresses.governanceMultisig;

  if (!config.safeConfig) {
    throw new Error("Safe config missing for this network");
  }

  const executor = new SagaGovernanceExecutor(hre, signer, config.safeConfig);
  await executor.initialize();

  const dDeployment = await hre.deployments.get(D_TOKEN_ID);
  const issuerDeployment = await hre.deployments.get(D_ISSUER_V2_2_CONTRACT_ID);
  const redeemerDeployment = await hre.deployments.get(D_REDEEMER_CONTRACT_ID);
  const vaultDeployment = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);

  const dstable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", dDeployment.address, signer);
  const vault = await hre.ethers.getContractAt("CollateralVault", vaultDeployment.address, signer);

  const minterRole = await dstable.MINTER_ROLE();
  const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();

  const governanceHasMinter = await dstable.hasRole(minterRole, governanceMultisig);
  const issuerHasMinter = await dstable.hasRole(minterRole, issuerDeployment.address);
  const legacyRedeemerHasWithdrawer = await vault.hasRole(withdrawerRole, redeemerDeployment.address);

  if (!governanceHasMinter) {
    executor.queueTransaction(() =>
      buildTx(dDeployment.address, dstable.interface.encodeFunctionData("grantRole", [minterRole, governanceMultisig])),
    );
  }

  executor.queueTransaction(() =>
    buildTx(
      bundle.dstable.address,
      dstable.interface.encodeFunctionData("mint", [
        bundle.dstable.reconciliationMintSink,
        BigInt(bundle.dstable.reconciliationMintAmount),
      ]),
    ),
  );

  if (!governanceHasMinter) {
    executor.queueTransaction(() =>
      buildTx(dDeployment.address, dstable.interface.encodeFunctionData("revokeRole", [minterRole, governanceMultisig])),
    );
  }

  if (issuerHasMinter) {
    executor.queueTransaction(() =>
      buildTx(dDeployment.address, dstable.interface.encodeFunctionData("revokeRole", [minterRole, issuerDeployment.address])),
    );
  }

  if (legacyRedeemerHasWithdrawer) {
    executor.queueTransaction(() =>
      buildTx(vaultDeployment.address, vault.interface.encodeFunctionData("revokeRole", [withdrawerRole, redeemerDeployment.address])),
    );
  }

  const queued = executor.queuedTransactions;
  if (queued.length === 0) {
    console.log("No new governance actions needed.");
    return;
  }

  console.log("Queueing recovery governance actions:");
  for (const tx of queued) {
    console.log(`  - ${tx.to}`);
  }

  await executor.flush("Recovery mint and legacy privilege cleanup");
  console.log(`Review: https://app.safe.global/transactions/queue?safe=saga:${governanceMultisig}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
