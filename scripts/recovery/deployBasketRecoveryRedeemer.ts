import fs from "fs";
import path from "path";

import hre from "hardhat";

import { getConfig } from "../../config/config";
import { D_BASKET_RECOVERY_REDEEMER_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

interface PreparedRecoveryBundle {
  constructorArgs: {
    dstable: string;
    collateralVault: string;
    claimBaseD: string;
    recoveryAssets: string[];
    payoutPerD: string[];
  };
}

function buildRoleTx(contractAddress: string, data: string): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data,
  };
}

async function main(): Promise<void> {
  const [bundlePathArg, outPathArg] = process.argv.slice(2);
  if (!bundlePathArg) {
    throw new Error(
      "Usage: npx hardhat run --network <network> scripts/recovery/deployBasketRecoveryRedeemer.ts <prepared-bundle.json> [deployment-out.json]",
    );
  }

  const bundlePath = path.resolve(bundlePathArg);
  const outPath = outPathArg ? path.resolve(outPathArg) : undefined;
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")) as PreparedRecoveryBundle;

  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const testMultisig = process.env.TEST_GOVERNANCE_MULTISIG;
  const governanceMultisig = testMultisig || config.walletAddresses.governanceMultisig;
  const safeConfig =
    testMultisig && config.safeConfig
      ? {
          safeAddress: governanceMultisig,
          chainId: config.safeConfig.chainId,
          txServiceUrl: config.safeConfig.txServiceUrl,
        }
      : config.safeConfig;
  const executor = new SagaGovernanceExecutor(hre, signer, safeConfig);
  await executor.initialize();

  const deployment = await hre.deployments.deploy(D_BASKET_RECOVERY_REDEEMER_ID, {
    from: deployer,
    contract: "BasketRecoveryRedeemer",
    args: [
      bundle.constructorArgs.dstable,
      bundle.constructorArgs.collateralVault,
      BigInt(bundle.constructorArgs.claimBaseD),
      bundle.constructorArgs.recoveryAssets,
      bundle.constructorArgs.payoutPerD.map((value) => BigInt(value)),
    ],
    log: true,
    autoMine: true,
  });

  const vault = await hre.ethers.getContractAt("CollateralVault", bundle.constructorArgs.collateralVault, signer);
  const redeemer = await hre.ethers.getContractAt("BasketRecoveryRedeemer", deployment.address, signer);
  const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
  const redeemerAdminRole = await redeemer.DEFAULT_ADMIN_ROLE();
  const redeemerPauserRole = await redeemer.PAUSER_ROLE();
  const hasVaultWithdrawerRole = await vault.hasRole(withdrawerRole, deployment.address);
  const deployerIsGovernance = deployer.toLowerCase() === governanceMultisig.toLowerCase();

  let pendingGovernance = false;

  async function queueOrExecute(description: string, directCall: () => Promise<void>, safeTx?: SafeTransactionData): Promise<void> {
    const completed = await executor.tryOrQueue(directCall, safeTx ? (): SafeTransactionData => safeTx : undefined);

    if (!completed) {
      pendingGovernance = true;
      console.log(`   ⏳ ${description} queued for governance`);
    } else {
      console.log(`   ✅ ${description}`);
    }
  }

  if (!hasVaultWithdrawerRole) {
    await queueOrExecute(
      "Grant COLLATERAL_WITHDRAWER_ROLE to BasketRecoveryRedeemer",
      async (): Promise<void> => {
        await vault.grantRole(withdrawerRole, deployment.address);
      },
      buildRoleTx(
        bundle.constructorArgs.collateralVault,
        vault.interface.encodeFunctionData("grantRole", [withdrawerRole, deployment.address]),
      ),
    );
  }

  if (!(await redeemer.hasRole(redeemerAdminRole, governanceMultisig))) {
    await queueOrExecute(
      "Grant DEFAULT_ADMIN_ROLE to governance on BasketRecoveryRedeemer",
      async (): Promise<void> => {
        await redeemer.grantRole(redeemerAdminRole, governanceMultisig);
      },
      buildRoleTx(deployment.address, redeemer.interface.encodeFunctionData("grantRole", [redeemerAdminRole, governanceMultisig])),
    );
  } else {
    console.log("   ✓ Governance already has DEFAULT_ADMIN_ROLE on BasketRecoveryRedeemer");
  }

  if (!(await redeemer.hasRole(redeemerPauserRole, governanceMultisig))) {
    await queueOrExecute(
      "Grant PAUSER_ROLE to governance on BasketRecoveryRedeemer",
      async (): Promise<void> => {
        await redeemer.grantRole(redeemerPauserRole, governanceMultisig);
      },
      buildRoleTx(deployment.address, redeemer.interface.encodeFunctionData("grantRole", [redeemerPauserRole, governanceMultisig])),
    );
  } else {
    console.log("   ✓ Governance already has PAUSER_ROLE on BasketRecoveryRedeemer");
  }

  if (!deployerIsGovernance && (await redeemer.hasRole(redeemerPauserRole, deployer))) {
    await queueOrExecute(
      "Revoke deployer PAUSER_ROLE on BasketRecoveryRedeemer",
      async (): Promise<void> => {
        await redeemer.revokeRole(redeemerPauserRole, deployer);
      },
      buildRoleTx(deployment.address, redeemer.interface.encodeFunctionData("revokeRole", [redeemerPauserRole, deployer])),
    );
  }

  if (!deployerIsGovernance && (await redeemer.hasRole(redeemerAdminRole, deployer))) {
    await queueOrExecute(
      "Revoke deployer DEFAULT_ADMIN_ROLE on BasketRecoveryRedeemer",
      async (): Promise<void> => {
        await redeemer.revokeRole(redeemerAdminRole, deployer);
      },
      buildRoleTx(deployment.address, redeemer.interface.encodeFunctionData("revokeRole", [redeemerAdminRole, deployer])),
    );
  }

  const roleGrantCalldata = vault.interface.encodeFunctionData("grantRole", [withdrawerRole, deployment.address]);
  const roleGrantAdminCalldata = redeemer.interface.encodeFunctionData("grantRole", [redeemerAdminRole, governanceMultisig]);
  const roleGrantPauserCalldata = redeemer.interface.encodeFunctionData("grantRole", [redeemerPauserRole, governanceMultisig]);
  const revokeAdminCalldata = redeemer.interface.encodeFunctionData("revokeRole", [redeemerAdminRole, deployer]);
  const revokePauserCalldata = redeemer.interface.encodeFunctionData("revokeRole", [redeemerPauserRole, deployer]);

  const result = {
    deploymentName: D_BASKET_RECOVERY_REDEEMER_ID,
    redeemerAddress: deployment.address,
    txHash: deployment.transactionHash,
    collateralVault: bundle.constructorArgs.collateralVault,
    dstable: bundle.constructorArgs.dstable,
    claimBaseD: bundle.constructorArgs.claimBaseD,
    recoveryAssets: bundle.constructorArgs.recoveryAssets,
    payoutPerD: bundle.constructorArgs.payoutPerD,
    roles: {
      collateralWithdrawerRole: withdrawerRole,
      redeemerDefaultAdminRole: redeemerAdminRole,
      redeemerPauserRole,
      governanceMultisig,
      alreadyHadRole: hasVaultWithdrawerRole,
      pendingGovernance,
      grantRoleCalldata: roleGrantCalldata,
      grantAdminRoleCalldata: roleGrantAdminCalldata,
      grantPauserRoleCalldata: roleGrantPauserCalldata,
      revokeDeployerAdminCalldata: revokeAdminCalldata,
      revokeDeployerPauserCalldata: revokePauserCalldata,
    },
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`Deployment summary written to ${outPath}`);
  }

  console.log(`BasketRecoveryRedeemer deployed at ${deployment.address}`);
  if (pendingGovernance) {
    const flushed = await executor.flush("Deploy BasketRecoveryRedeemer and hand off roles");

    if (!flushed) {
      throw new Error("Failed to queue required governance actions for BasketRecoveryRedeemer");
    }

    console.log("Some follow-up actions require governance signatures via Safe.");
    console.log(`Review: https://app.safe.global/transactions/queue?safe=saga:${governanceMultisig}`);
  } else if (!hasVaultWithdrawerRole) {
    console.log("The recovery redeemer does NOT yet have COLLATERAL_WITHDRAWER_ROLE on the collateral vault.");
    console.log(`Grant role calldata: ${roleGrantCalldata}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
