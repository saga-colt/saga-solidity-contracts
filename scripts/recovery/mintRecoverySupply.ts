import fs from "fs";
import path from "path";

import { ZeroAddress } from "ethers";
import hre from "hardhat";

interface PreparedRecoveryBundle {
  dstable: {
    address: string;
    reconciliationMintAmount: string;
    reconciliationMintAmountFormatted: string;
    reconciliationMintSink: string;
    burnSinkBalanceBeforeMint: string;
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const positionalArgs = args.filter((arg) => arg !== "--force");
  const [bundlePathArg, outPathArg] = positionalArgs;
  if (!bundlePathArg) {
    throw new Error(
      "Usage: npx hardhat run --network <network> scripts/recovery/mintRecoverySupply.ts <prepared-bundle.json> [mint-out.json] [--force]",
    );
  }

  const bundlePath = path.resolve(bundlePathArg);
  const outPath = outPathArg ? path.resolve(outPathArg) : undefined;
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")) as PreparedRecoveryBundle;

  const sink = bundle.dstable.reconciliationMintSink;
  if (sink === ZeroAddress) {
    throw new Error("reconciliationMintSink cannot be the zero address; use a non-redeemable burn sink such as 0x...dEaD");
  }

  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);
  const dstable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", bundle.dstable.address, signer);

  const minterRole = await dstable.MINTER_ROLE();
  const hasMinterRole = await dstable.hasRole(minterRole, deployer);
  const mintAmount = BigInt(bundle.dstable.reconciliationMintAmount);
  const expectedSinkBalanceBeforeMint = BigInt(bundle.dstable.burnSinkBalanceBeforeMint);
  const currentSinkBalance = BigInt((await dstable.balanceOf(sink)).toString());
  const mintCalldata = dstable.interface.encodeFunctionData("mint", [sink, mintAmount]);

  let alreadyMinted = false;
  if (currentSinkBalance === expectedSinkBalanceBeforeMint + mintAmount) {
    alreadyMinted = true;
    console.log(`Burn sink ${sink} already holds the expected post-mint balance. Skipping duplicate mint.`);
  } else if (currentSinkBalance !== expectedSinkBalanceBeforeMint && !force) {
    throw new Error(
      `Burn sink balance changed since preparation. Expected ${expectedSinkBalanceBeforeMint.toString()} before mint, found ${currentSinkBalance.toString()}. ` +
        "Refusing to mint again. Re-run preparation or pass --force after manual review.",
    );
  } else if (currentSinkBalance !== expectedSinkBalanceBeforeMint) {
    console.log(
      `WARNING: burn sink balance differs from prepared snapshot (${currentSinkBalance.toString()} vs ${expectedSinkBalanceBeforeMint.toString()}); proceeding due to --force.`,
    );
  }

  let txHash: string | null = null;
  if (alreadyMinted) {
    txHash = null;
  } else if (hasMinterRole) {
    console.log(`Minting ${bundle.dstable.reconciliationMintAmountFormatted} D to burn sink ${sink} for supply reconciliation...`);
    const tx = await dstable.mint(sink, mintAmount);
    const receipt = await tx.wait();
    txHash = receipt?.hash ?? tx.hash;
    console.log(`Mint complete in tx ${txHash}`);
  } else {
    console.log(`Deployer ${deployer} does not have MINTER_ROLE on ${bundle.dstable.address}.`);
    console.log(`Submit this calldata via governance / Safe: ${mintCalldata}`);
  }

  const result = {
    dstable: bundle.dstable.address,
    reconciliationMintAmount: bundle.dstable.reconciliationMintAmount,
    reconciliationMintSink: sink,
    minterRole,
    hasMinterRole,
    expectedBurnSinkBalanceBeforeMint: expectedSinkBalanceBeforeMint.toString(),
    currentBurnSinkBalance: currentSinkBalance.toString(),
    alreadyMinted,
    txHash,
    mintCalldata,
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`Mint summary written to ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
