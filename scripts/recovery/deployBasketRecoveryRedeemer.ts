import fs from "fs";
import path from "path";

import hre from "hardhat";

import { D_BASKET_RECOVERY_REDEEMER_ID } from "../../typescript/deploy-ids";

interface PreparedRecoveryBundle {
  constructorArgs: {
    dstable: string;
    collateralVault: string;
    claimBaseD: string;
    recoveryAssets: string[];
    payoutPerD: string[];
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

  const signer = await hre.ethers.getSigner(deployer);
  const vault = await hre.ethers.getContractAt("CollateralVault", bundle.constructorArgs.collateralVault, signer);
  const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
  const adminRole = await vault.DEFAULT_ADMIN_ROLE();
  const hasVaultWithdrawerRole = await vault.hasRole(withdrawerRole, deployment.address);
  const deployerIsVaultAdmin = await vault.hasRole(adminRole, deployer);

  let grantRoleExecuted = false;
  if (!hasVaultWithdrawerRole && deployerIsVaultAdmin) {
    console.log("Granting COLLATERAL_WITHDRAWER_ROLE on the collateral vault to the recovery redeemer...");
    await (await vault.grantRole(withdrawerRole, deployment.address)).wait();
    grantRoleExecuted = true;
  }

  const roleGrantCalldata = vault.interface.encodeFunctionData("grantRole", [withdrawerRole, deployment.address]);

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
      deployerIsVaultAdmin,
      alreadyHadRole: hasVaultWithdrawerRole,
      grantRoleExecuted,
      grantRoleCalldata: roleGrantCalldata,
    },
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`Deployment summary written to ${outPath}`);
  }

  console.log(`BasketRecoveryRedeemer deployed at ${deployment.address}`);
  if (!hasVaultWithdrawerRole && !grantRoleExecuted) {
    console.log("The recovery redeemer does NOT yet have COLLATERAL_WITHDRAWER_ROLE on the collateral vault.");
    console.log(`Grant role calldata: ${roleGrantCalldata}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
