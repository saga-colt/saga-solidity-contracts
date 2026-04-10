import fs from "fs";
import path from "path";

import { formatUnits, getAddress } from "ethers";
import hre from "hardhat";

import { D_BASKET_RECOVERY_REDEEMER_ID } from "../../typescript/deploy-ids";

interface PreparedRecoveryAsset {
  address: string;
  symbol: string;
  decimals: number;
  requiredBudget: string;
}

interface PreparedRecoveryBundle {
  dstable: {
    address: string;
    decimals: number;
    symbol: string;
    claimBaseD: string;
    claimBaseDFormatted: string;
    currentTotalSupply: string;
    currentTotalSupplyFormatted: string;
    reconciledTotalSupplyAfterMint: string;
    reconciledTotalSupplyAfterMintFormatted: string;
  };
  collateralVault: string;
  recoveryAssets: PreparedRecoveryAsset[];
  constructorArgs: {
    dstable: string;
    collateralVault: string;
    claimBaseD: string;
    recoveryAssets: string[];
    payoutPerD: string[];
  };
}

async function main(): Promise<void> {
  const [bundlePathArg, redeemerRefArg] = process.argv.slice(2);
  if (!bundlePathArg) {
    throw new Error(
      "Usage: npx hardhat run --network <network> scripts/recovery/checkBasketRecoveryReadiness.ts <prepared-bundle.json> [redeemer-address-or-deployment-summary.json]",
    );
  }

  const bundlePath = path.resolve(bundlePathArg);
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")) as PreparedRecoveryBundle;

  let redeemerAddress: string | null = null;
  if (redeemerRefArg) {
    const resolved = path.resolve(redeemerRefArg);
    if (fs.existsSync(resolved)) {
      const deploymentSummary = JSON.parse(fs.readFileSync(resolved, "utf8")) as { redeemerAddress?: string };
      redeemerAddress = deploymentSummary.redeemerAddress ?? null;
    } else {
      redeemerAddress = redeemerRefArg;
    }
  }

  if (!redeemerAddress) {
    const deployment = await hre.deployments.getOrNull(D_BASKET_RECOVERY_REDEEMER_ID);
    redeemerAddress = deployment?.address ?? null;
  }

  if (!redeemerAddress) {
    throw new Error("Could not resolve BasketRecoveryRedeemer address. Pass it explicitly or deploy it first.");
  }

  const signer = await hre.ethers.getSigner((await hre.getNamedAccounts()).deployer);
  const redeemer = await hre.ethers.getContractAt("BasketRecoveryRedeemer", redeemerAddress, signer);
  const vault = await hre.ethers.getContractAt("CollateralVault", bundle.collateralVault, signer);
  const dstable = await hre.ethers.getContractAt(
    ["function paused() view returns (bool)", "function totalSupply() view returns (uint256)"],
    bundle.dstable.address,
    signer,
  );

  const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
  const hasVaultRole = await vault.hasRole(withdrawerRole, redeemerAddress);
  const isPaused = await redeemer.paused();
  const dstablePaused = await dstable.paused();
  const dstableTotalSupply = await dstable.totalSupply();
  const totalRedeemedD = await redeemer.totalRedeemedD();
  const failures: string[] = [];
  const deployedDstable = await redeemer.dstable();
  const deployedVault = await redeemer.collateralVault();
  const deployedClaimBaseD = await redeemer.claimBaseD();
  const deployedAssets = (await redeemer.recoveryAssets()).map((asset) => getAddress(asset));
  const expectedAssets = bundle.constructorArgs.recoveryAssets.map((asset) => getAddress(asset));

  if (getAddress(deployedDstable) !== getAddress(bundle.constructorArgs.dstable)) {
    failures.push("BasketRecoveryRedeemer dstable address does not match the prepared bundle");
  }
  if (getAddress(deployedVault) !== getAddress(bundle.constructorArgs.collateralVault)) {
    failures.push("BasketRecoveryRedeemer collateral vault address does not match the prepared bundle");
  }
  if (deployedClaimBaseD !== BigInt(bundle.constructorArgs.claimBaseD)) {
    failures.push("BasketRecoveryRedeemer claimBaseD does not match the prepared bundle");
  }
  if (deployedAssets.length !== expectedAssets.length) {
    failures.push("BasketRecoveryRedeemer recovery asset count does not match the prepared bundle");
  } else {
    for (let i = 0; i < expectedAssets.length; i++) {
      if (deployedAssets[i] !== expectedAssets[i]) {
        failures.push(`BasketRecoveryRedeemer recovery asset at index ${i} does not match the prepared bundle`);
        continue;
      }

      const deployedPayout = await redeemer.payoutPerD(deployedAssets[i]);
      if (deployedPayout !== BigInt(bundle.constructorArgs.payoutPerD[i])) {
        failures.push(`BasketRecoveryRedeemer payoutPerD for ${deployedAssets[i]} does not match the prepared bundle`);
      }
    }
  }

  if (!isPaused) {
    failures.push("BasketRecoveryRedeemer is not paused");
  }
  if (!hasVaultRole) {
    failures.push("BasketRecoveryRedeemer does not have COLLATERAL_WITHDRAWER_ROLE on the collateral vault");
  }
  if (dstableTotalSupply < BigInt(bundle.dstable.claimBaseD)) {
    failures.push("D totalSupply is below claimBaseD; reconciliation mint is incomplete or claimBaseD is overstated");
  }

  console.log(`BasketRecoveryRedeemer: ${redeemerAddress}`);
  console.log(`  paused: ${isPaused}`);
  console.log(`  totalRedeemedD: ${formatUnits(totalRedeemedD, bundle.dstable.decimals)} ${bundle.dstable.symbol}`);
  console.log(`  dstable: ${deployedDstable}`);
  console.log(`  claimBaseD: ${formatUnits(deployedClaimBaseD, bundle.dstable.decimals)} ${bundle.dstable.symbol}`);
  console.log(`  live totalSupply: ${formatUnits(dstableTotalSupply, bundle.dstable.decimals)} ${bundle.dstable.symbol}`);
  console.log(
    `  prepared projected totalSupply after mint: ${bundle.dstable.reconciledTotalSupplyAfterMintFormatted} ${bundle.dstable.symbol}`,
  );
  console.log(`Collateral vault: ${bundle.collateralVault}`);
  console.log(`  has COLLATERAL_WITHDRAWER_ROLE: ${hasVaultRole}`);
  console.log(`D token paused: ${dstablePaused}`);

  console.log("Recovery asset funding status:");
  for (const asset of bundle.recoveryAssets) {
    const erc20 = await hre.ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], asset.address, signer);
    const balance = await erc20.balanceOf(bundle.collateralVault);
    const required = BigInt(asset.requiredBudget);
    const ok = balance >= required;
    if (!ok) {
      failures.push(`${asset.symbol} vault balance is below required recovery budget`);
    }
    console.log(
      `  - ${asset.symbol}: vault=${formatUnits(balance, asset.decimals)} / required=${formatUnits(required, asset.decimals)} => ${ok ? "OK" : "LOW"}`,
    );
  }

  console.log("Note: the D token must be unpaused before users can burn/redeem through BasketRecoveryRedeemer.");

  if (failures.length > 0) {
    console.log("Readiness check FAILED:");
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Readiness check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
