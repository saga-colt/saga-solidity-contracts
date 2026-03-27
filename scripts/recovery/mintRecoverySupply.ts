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
  };
}

async function main(): Promise<void> {
  const [bundlePathArg, outPathArg] = process.argv.slice(2);
  if (!bundlePathArg) {
    throw new Error(
      "Usage: npx hardhat run --network <network> scripts/recovery/mintRecoverySupply.ts <prepared-bundle.json> [mint-out.json]",
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
  const mintCalldata = dstable.interface.encodeFunctionData("mint", [sink, mintAmount]);

  let txHash: string | null = null;
  if (hasMinterRole) {
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
