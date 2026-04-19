import fs from "fs";
import path from "path";

import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";

const DEFAULT_RPC_URL = "https://sagaevm.jsonrpc.sagarpc.io/";
const DEFAULT_D_DEPLOYMENT = path.resolve(process.cwd(), "deployments/saga_mainnet/D.json");

interface DDeployment {
  address: string;
}

interface RecoveryConfigFile {
  claimBaseD: string;
  reconciliationMintAmount?: string;
}

interface CliOptions {
  reconciliationMintAmount: bigint;
  totalSupply?: bigint;
  rpcUrl: string;
  deploymentPath: string;
  configPath?: string;
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0) {
    throw new Error(
      "Usage: npx ts-node --files scripts/recovery/deriveClaimBaseD.ts <reconciliationMintAmount> " +
        "[--total-supply <raw>] [--rpc-url <url>] [--deployment <path>] [--config <path>]",
    );
  }

  const reconciliationMintAmount = BigInt(argv[0]);
  let totalSupply: bigint | undefined;
  let rpcUrl = DEFAULT_RPC_URL;
  let deploymentPath = DEFAULT_D_DEPLOYMENT;
  let configPath: string | undefined;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--total-supply") {
      totalSupply = BigInt(requireValue(argv, ++i, "--total-supply"));
      continue;
    }
    if (arg === "--rpc-url") {
      rpcUrl = requireValue(argv, ++i, "--rpc-url");
      continue;
    }
    if (arg === "--deployment") {
      deploymentPath = path.resolve(requireValue(argv, ++i, "--deployment"));
      continue;
    }
    if (arg === "--config") {
      configPath = path.resolve(requireValue(argv, ++i, "--config"));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (reconciliationMintAmount < 0n) {
    throw new Error("reconciliationMintAmount must be non-negative");
  }

  return {
    reconciliationMintAmount,
    totalSupply,
    rpcUrl,
    deploymentPath,
    configPath,
  };
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

async function resolveDInfo(
  deploymentPath: string,
  rpcUrl: string,
): Promise<{ address: string; decimals: number; symbol: string; totalSupply: bigint }> {
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as DDeployment;
  const address = getAddress(deployment.address);
  const provider = new JsonRpcProvider(rpcUrl);
  const dstable = new Contract(
    address,
    [
      "function totalSupply() view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
    ],
    provider,
  );

  const [totalSupplyRaw, decimalsRaw, symbol] = await Promise.all([dstable.totalSupply(), dstable.decimals(), dstable.symbol()]);

  return {
    address,
    decimals: Number(decimalsRaw),
    symbol,
    totalSupply: BigInt(totalSupplyRaw.toString()),
  };
}

function updateConfigFile(configPath: string, claimBaseD: bigint, reconciliationMintAmount: bigint): void {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as RecoveryConfigFile;
  raw.claimBaseD = claimBaseD.toString();
  raw.reconciliationMintAmount = reconciliationMintAmount.toString();
  fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const dInfo = await resolveDInfo(options.deploymentPath, options.rpcUrl);
  const totalSupply = options.totalSupply ?? dInfo.totalSupply;
  const claimBaseD = totalSupply + options.reconciliationMintAmount;

  console.log(`D: ${dInfo.address}`);
  console.log(`Source totalSupply: ${totalSupply.toString()} (${formatUnits(totalSupply, dInfo.decimals)} ${dInfo.symbol})`);
  console.log(
    `Trusted reconciliationMintAmount: ${options.reconciliationMintAmount.toString()} (${formatUnits(options.reconciliationMintAmount, dInfo.decimals)} ${dInfo.symbol})`,
  );
  console.log(`Derived claimBaseD: ${claimBaseD.toString()} (${formatUnits(claimBaseD, dInfo.decimals)} ${dInfo.symbol})`);

  if (options.configPath) {
    updateConfigFile(options.configPath, claimBaseD, options.reconciliationMintAmount);
    console.log(`Updated config: ${options.configPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
