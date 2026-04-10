import fs from "fs";
import path from "path";

import { formatUnits, getAddress, ZeroAddress } from "ethers";
import hre from "hardhat";

import { D_COLLATERAL_VAULT_CONTRACT_ID, D_TOKEN_ID } from "../../typescript/deploy-ids";
import { fetchTokenInfo } from "../../typescript/token/utils";

const DEAD_BURN_SINK = "0x000000000000000000000000000000000000dEaD";

interface RecoveryConfigInput {
  dstable?: string;
  collateralVault?: string;
  claimBaseD: string;
  reconciliationMintAmount?: string;
  reconciliationMintSink?: string;
  assets?: Array<string | { address: string; symbol?: string }>;
  includeZeroBalanceAssets?: boolean;
}

interface PreparedRecoveryAsset {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  vaultBalance: string;
  vaultBalanceFormatted: string;
  payoutPerD: string;
  payoutPerDFormatted: string;
  requiredBudget: string;
  requiredBudgetFormatted: string;
  unallocatableDust: string;
  unallocatableDustFormatted: string;
}

interface SkippedRecoveryAsset {
  address: string;
  symbol: string;
  name: string;
  reason: string;
}

interface ZeroPayoutRecoveryAsset {
  address: string;
  symbol: string;
  name: string;
  vaultBalance: string;
  vaultBalanceFormatted: string;
}

async function main(): Promise<void> {
  const [configPathArg, outPathArg] = process.argv.slice(2);
  if (!configPathArg || !outPathArg) {
    throw new Error("Usage: npx ts-node --files scripts/recovery/prepareBasketRecovery.ts <config.json> <out.json>");
  }

  const configPath = path.resolve(configPathArg);
  const outPath = path.resolve(outPathArg);
  const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as RecoveryConfigInput;

  const dstableAddress = await resolveDstableAddress(rawConfig.dstable);
  const collateralVaultAddress = await resolveCollateralVaultAddress(rawConfig.collateralVault);
  const claimBaseD = BigInt(rawConfig.claimBaseD);
  const reconciliationMintSink = getAddress(rawConfig.reconciliationMintSink ?? DEAD_BURN_SINK);

  if (claimBaseD <= 0n) {
    throw new Error("claimBaseD must be greater than 0");
  }
  if (reconciliationMintSink === ZeroAddress) {
    throw new Error("reconciliationMintSink cannot be the zero address; OZ ERC20 mint(address(0), ...) reverts");
  }

  const dstableInfo = await fetchTokenInfo(hre, dstableAddress);
  const dUnit = 10n ** BigInt(dstableInfo.decimals);

  const vault = await hre.ethers.getContractAt("CollateralVault", collateralVaultAddress);
  const configuredAssetAddresses = await resolveRecoveryAssetAddresses(vault, rawConfig.assets ?? []);
  const usingExplicitAssets = (rawConfig.assets?.length ?? 0) > 0;

  const assets: PreparedRecoveryAsset[] = [];
  const skippedZeroBalanceAssets: SkippedRecoveryAsset[] = [];
  const zeroPayoutAssets: ZeroPayoutRecoveryAsset[] = [];
  const includeZeroBalanceAssets = rawConfig.includeZeroBalanceAssets ?? false;
  for (const assetAddress of configuredAssetAddresses) {
    const tokenInfo = await fetchTokenInfo(hre, assetAddress);
    const erc20 = await hre.ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], assetAddress);
    const vaultBalance = BigInt((await erc20.balanceOf(collateralVaultAddress)).toString());

    if (vaultBalance === 0n && !includeZeroBalanceAssets && !usingExplicitAssets) {
      skippedZeroBalanceAssets.push({
        address: assetAddress,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        reason: "zero vault balance",
      });
      continue;
    }

    const payoutPerD = (vaultBalance * dUnit) / claimBaseD;
    const requiredBudget = (payoutPerD * claimBaseD) / dUnit;
    const unallocatableDust = vaultBalance - requiredBudget;
    if (payoutPerD === 0n) {
      zeroPayoutAssets.push({
        address: assetAddress,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        vaultBalance: vaultBalance.toString(),
        vaultBalanceFormatted: formatUnits(vaultBalance, tokenInfo.decimals),
      });
    }

    assets.push({
      address: assetAddress,
      symbol: tokenInfo.symbol,
      name: tokenInfo.name,
      decimals: tokenInfo.decimals,
      vaultBalance: vaultBalance.toString(),
      vaultBalanceFormatted: formatUnits(vaultBalance, tokenInfo.decimals),
      payoutPerD: payoutPerD.toString(),
      payoutPerDFormatted: formatUnits(payoutPerD, tokenInfo.decimals),
      requiredBudget: requiredBudget.toString(),
      requiredBudgetFormatted: formatUnits(requiredBudget, tokenInfo.decimals),
      unallocatableDust: unallocatableDust.toString(),
      unallocatableDustFormatted: formatUnits(unallocatableDust, tokenInfo.decimals),
    });
  }

  if (assets.length === 0) {
    throw new Error(
      "No recovery assets were selected. Provide assets explicitly or ensure the collateral vault has supported non-zero balance assets.",
    );
  }

  if (!usingExplicitAssets && skippedZeroBalanceAssets.length > 0) {
    const skippedList = skippedZeroBalanceAssets.map((asset) => `${asset.symbol} (${asset.address})`).join(", ");
    throw new Error(
      `vault.listCollateral() contains zero-balance supported assets that would be omitted from the frozen basket: ${skippedList}. ` +
        "Either provide an explicit assets list to make that omission intentional, or set includeZeroBalanceAssets=true to freeze the full supported list.",
    );
  }

  const totalSupplyReader = await hre.ethers.getContractAt(["function totalSupply() view returns (uint256)"], dstableAddress);
  const balanceReader = await hre.ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], dstableAddress);
  const currentTotalSupply = BigInt((await totalSupplyReader.totalSupply()).toString());
  const burnSinkBalance = BigInt((await balanceReader.balanceOf(reconciliationMintSink)).toString());

  const configuredReconciliationMintAmount =
    rawConfig.reconciliationMintAmount === undefined ? undefined : BigInt(rawConfig.reconciliationMintAmount);
  const expectedReconciliationMintAmount = claimBaseD > currentTotalSupply ? claimBaseD - currentTotalSupply : 0n;
  if (configuredReconciliationMintAmount !== undefined && configuredReconciliationMintAmount !== expectedReconciliationMintAmount) {
    throw new Error(
      `Configured reconciliationMintAmount ${configuredReconciliationMintAmount.toString()} does not match the required mint ` +
        `${expectedReconciliationMintAmount.toString()} derived from claimBaseD (${claimBaseD.toString()}) ` +
        `minus currentTotalSupply (${currentTotalSupply.toString()}).`,
    );
  }

  const reconciliationMintAmount = expectedReconciliationMintAmount;
  const network = await hre.ethers.provider.getNetwork();
  const reconciledTotalSupplyAfterMint = currentTotalSupply + reconciliationMintAmount;
  const accountingWarnings: string[] = [];
  if (burnSinkBalance > currentTotalSupply) {
    accountingWarnings.push(
      "Burn sink balance already exceeds current D totalSupply(); live ERC20 accounting is inconsistent before the planned reconciliation mint.",
    );
  }
  if (burnSinkBalance > reconciledTotalSupplyAfterMint) {
    accountingWarnings.push(
      "Burn sink balance also exceeds the projected totalSupply after the planned reconciliation mint; review the accounting hole assumptions before opening redemption.",
    );
  }
  const preparedOutput = {
    preparedAt: new Date().toISOString(),
    networkName: hre.network.name,
    chainId: network.chainId.toString(),
    notes: [
      "claimBaseD is the redeemable D denominator for basket ratios.",
      "reconciliationMintAmount is derived as max(claimBaseD - currentTotalSupply, 0) and must be minted to a non-redeemable burn sink before opening redemption.",
      "Minting to address(0) is impossible with ERC20StablecoinUpgradeable because OZ _mint(address(0), ...) reverts.",
      "The BasketRecoveryRedeemer should be the only active redemption path; keep legacy RedeemerV2 paused.",
      usingExplicitAssets
        ? "Recovery asset list was provided explicitly by the operator."
        : "Recovery asset list came from vault.listCollateral(); any zero-balance omissions must be made explicit by the operator.",
      ...accountingWarnings,
    ],
    dstable: {
      address: dstableInfo.address,
      symbol: dstableInfo.symbol,
      name: dstableInfo.name,
      decimals: dstableInfo.decimals,
      currentTotalSupply: currentTotalSupply.toString(),
      currentTotalSupplyFormatted: formatUnits(currentTotalSupply, dstableInfo.decimals),
      claimBaseD: claimBaseD.toString(),
      claimBaseDFormatted: formatUnits(claimBaseD, dstableInfo.decimals),
      reconciliationMintAmount: reconciliationMintAmount.toString(),
      reconciliationMintAmountFormatted: formatUnits(reconciliationMintAmount, dstableInfo.decimals),
      reconciliationMintSink,
      burnSinkBalanceBeforeMint: burnSinkBalance.toString(),
      burnSinkBalanceBeforeMintFormatted: formatUnits(burnSinkBalance, dstableInfo.decimals),
      reconciledTotalSupplyAfterMint: reconciledTotalSupplyAfterMint.toString(),
      reconciledTotalSupplyAfterMintFormatted: formatUnits(reconciledTotalSupplyAfterMint, dstableInfo.decimals),
    },
    collateralVault: collateralVaultAddress,
    recoveryAssets: assets,
    skippedZeroBalanceAssets,
    zeroPayoutAssets,
    constructorArgs: {
      dstable: dstableAddress,
      collateralVault: collateralVaultAddress,
      claimBaseD: claimBaseD.toString(),
      recoveryAssets: assets.map((asset) => asset.address),
      payoutPerD: assets.map((asset) => asset.payoutPerD),
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(preparedOutput, null, 2));

  console.log(`Prepared basket recovery bundle written to ${outPath}`);
  console.log(`Network: ${hre.network.name} (chainId=${network.chainId.toString()})`);
  console.log(`D claim base: ${preparedOutput.dstable.claimBaseDFormatted}`);
  console.log(`Reconciliation mint amount: ${preparedOutput.dstable.reconciliationMintAmountFormatted}`);
  console.log("Recovery assets:");
  for (const asset of assets) {
    console.log(
      `  - ${asset.symbol} @ ${asset.address}: vault=${asset.vaultBalanceFormatted}, payoutPerD=${asset.payoutPerDFormatted}, dust=${asset.unallocatableDustFormatted}`,
    );
  }
  if (zeroPayoutAssets.length > 0) {
    console.log("Warning: some selected recovery assets have non-zero vault balance but payoutPerD=0.");
    for (const asset of zeroPayoutAssets) {
      console.log(`  - ${asset.symbol} @ ${asset.address}: vault=${asset.vaultBalanceFormatted}`);
    }
    console.log("These balances will remain as dust under the current claim base and token decimal mix.");
  }
  for (const warning of accountingWarnings) {
    console.log(`Warning: ${warning}`);
  }
}

async function resolveDstableAddress(maybeAddress?: string): Promise<string> {
  if (maybeAddress) {
    return getAddress(maybeAddress);
  }

  const deployment = await hre.deployments.getOrNull(D_TOKEN_ID);
  if (!deployment) {
    throw new Error(`Could not resolve ${D_TOKEN_ID}. Provide dstable explicitly in the config.`);
  }

  return getAddress(deployment.address);
}

async function resolveCollateralVaultAddress(maybeAddress?: string): Promise<string> {
  if (maybeAddress) {
    return getAddress(maybeAddress);
  }

  const deployment = await hre.deployments.getOrNull(D_COLLATERAL_VAULT_CONTRACT_ID);
  if (!deployment) {
    throw new Error(`Could not resolve ${D_COLLATERAL_VAULT_CONTRACT_ID}. Provide collateralVault explicitly in the config.`);
  }

  return getAddress(deployment.address);
}

async function resolveRecoveryAssetAddresses(
  vault: { listCollateral: () => Promise<string[]> },
  configuredAssets: Array<string | { address: string; symbol?: string }>,
): Promise<string[]> {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const candidateAddresses =
    configuredAssets.length > 0
      ? configuredAssets.map((entry) => (typeof entry === "string" ? entry : entry.address))
      : await vault.listCollateral();

  for (const rawAddress of candidateAddresses) {
    const normalized = getAddress(rawAddress);
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(normalized);
    }
  }

  return ordered;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
