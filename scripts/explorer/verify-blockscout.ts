/*
 * Bulk verify contracts on Blockscout (Saga EVM) via the Etherscan-compatible v1 API.
 * - Reads deployments from deployments/<network>
 * - Loads matching Standard JSON Input from deployments/<network>/solcInputs
 * - Encodes constructor arguments from deployment metadata using ethers
 * - Submits verification and polls for status
 */

import fs from "fs/promises";
import path from "path";
import { URLSearchParams } from "url";
import https from "https";
import { Interface, Fragment, AbiCoder } from "ethers";

type DeploymentFile = {
  address: string;
  args?: any[];
  metadata?: string; // stringified metadata JSON
  // For some deployments the metadata is inlined as object under `metadata`
  // but most hardhat-deploy artifacts store stringified metadata.
  bytecode?: string;
  solcInputHash?: string;
};

type VerifyResult = {
  name: string;
  address: string;
  ok: boolean;
  note?: string;
};

type ParsedMetadata = {
  compiler: { version: string };
  language: string;
  output: { abi: any[] };
  settings: {
    optimizer?: { enabled?: boolean; runs?: number };
    evmVersion?: string;
    compilationTarget: Record<string, string>;
  };
};

const BLOCKSCOUT_API_BASE =
  process.env.BLOCKSCOUT_API_BASE || "https://api-sagaevm.sagaexplorer.io/api";
const DEFAULT_LICENSE_TYPE = "3"; // MIT
// Always show already-verified contracts in output (no flags)

function httpPostForm(
  url: string,
  form: Record<string, string>
): Promise<{ status: string; message: string; result: any }> {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search, protocol } = new URL(url);
    const req = https.request(
      {
        protocol,
        hostname,
        path: `${pathname}${search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(new Error(`Non-JSON response (${res.statusCode}): ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpGet(
  url: string
): Promise<{ status: string; message: string; result: any }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(new Error(`Non-JSON response (${res.statusCode}): ${data}`));
          }
        });
      })
      .on("error", reject);
  });
}

function toCompilerVersionTag(version: string): string {
  // Ensure leading 'v'
  return version.startsWith("v") ? version : `v${version}`;
}

function getCompilationTarget(metadata: ParsedMetadata): {
  contractName: string;
  sourcePath: string;
} {
  const entries = Object.entries(metadata.settings.compilationTarget || {});
  if (entries.length === 0) {
    throw new Error("compilationTarget missing in metadata");
  }
  const [sourcePath, contractName] = entries[0];
  return { contractName, sourcePath };
}

function encodeConstructorArgs(
  abi: any[],
  args: any[] | undefined,
  bytecode?: string
): string {
  if (!args || args.length === 0) return "";
  // Prefer encoding directly from constructor fragment
  const intf = new Interface(abi as Fragment[]);
  const ctor = intf.fragments.find((f) => f.type === "constructor");
  if (!ctor || !("inputs" in ctor)) return "";
  const types = (ctor as any).inputs.map((i: any) => i.type);
  const encoded = AbiCoder.defaultAbiCoder().encode(types, args);
  // Strip 0x
  return encoded.startsWith("0x") ? encoded.slice(2) : encoded;
}

async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function buildCandidateContractNames(
  sourcePath: string,
  contractName: string
): string[] {
  const fileOnly = path.basename(sourcePath);
  return [
    `${sourcePath}:${contractName}`,
    `${fileOnly}:${contractName}`,
    `${contractName}`,
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPrintable(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function printResultLine(r: VerifyResult): void {
  // Single line, same format as final summary
  console.log(
    `${r.ok ? "[OK]" : "[FAIL]"} ${r.name} @ ${r.address}${r.note ? ` - ${r.note}` : ""}`
  );
}

function truncateMiddle(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str;
  const keep = Math.max(maxLen - 3, 0);
  if (keep <= 0) return str.slice(0, maxLen);
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${str.slice(0, head)}...${str.slice(-tail)}`;
}

function summarizeSubmitErrors(
  submitErrors: string[],
  maxReasons = 2,
  maxLen = 140
): string {
  if (!submitErrors || submitErrors.length === 0) return "submit failed";
  const counts = new Map<string, number>();
  const normalizeReason = (msg: string): string => {
    const lower = msg.toLowerCase();
    if (lower.includes("address is not a smart contract")) {
      return "Address is not a smart contract";
    }
    if (lower.includes("already verified")) {
      return "Already verified";
    }
    if (lower.includes("rate limit") || lower.includes("too many requests")) {
      return "Rate limited";
    }
    if (lower.includes("queue")) {
      return "Pending in queue";
    }
    return msg;
  };
  for (const e of submitErrors) {
    const msg = e.replace(/^[^:]+:\\s*/, "").trim();
    const cleaned = normalizeReason(msg.replace(/\s*\|\s*/g, " | "));
    counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
  }
  const items = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (items.length === 1) {
    const [reason, attempts] = items[0];
    return `submit failed (${attempts} attempts): ${truncateMiddle(reason, maxLen)}`;
  }
  const parts = items
    .slice(0, maxReasons)
    .map(
      ([reason, n]) =>
        `${truncateMiddle(reason, Math.floor(maxLen / maxReasons))} (${n}x)`
    );
  return `submit failed: ${parts.join(" | ")}`;
}

function summarizeTimeoutNote(lastNote: string, maxLen = 140): string {
  if (!lastNote) return "timeout waiting for verification";
  return `timeout waiting for verification - last status: ${truncateMiddle(lastNote, maxLen)}`;
}

async function main() {
  const network = process.argv.includes("--network")
    ? process.argv[process.argv.indexOf("--network") + 1]
    : "saga_mainnet";

  const deploymentsDir = path.resolve(process.cwd(), "deployments", network);
  const solcInputsDir = path.join(deploymentsDir, "solcInputs");

  const files = await fs.readdir(deploymentsDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const filterEnv = process.env.VERIFY_ONLY?.trim();
  const filterSet = filterEnv
    ? new Set(filterEnv.split(",").map((s) => s.trim()))
    : undefined;

  const results: Array<VerifyResult> = [];

  for (const file of jsonFiles) {
    const filePath = path.join(deploymentsDir, file);
    let deployment: DeploymentFile;
    try {
      // Start processing this contract
      // (Do not print for filtered-out or zero address cases)
      deployment = await loadJson<DeploymentFile>(filePath);
    } catch {
      continue;
    }

    const name = path.basename(file, ".json");
    if (filterSet && !filterSet.has(name)) {
      continue;
    }
    const address = (deployment.address || "").trim();
    if (!address || address === "0x0000000000000000000000000000000000000000") {
      continue;
    }

    try {
      // Quick skip if already verified
      const statusResp = await httpGet(
        `${BLOCKSCOUT_API_BASE}?module=contract&action=getsourcecode&address=${address}`
      );
      if (statusResp.status === "1" && Array.isArray(statusResp.result)) {
        const rec = statusResp.result[0];
        if (
          rec &&
          rec.SourceCode &&
          rec.SourceCode.length > 0 &&
          rec.ABI &&
          rec.ABI !== "[]"
        ) {
          const r: VerifyResult = {
            name,
            address,
            ok: true,
            note: "already verified",
          };
          results.push(r);
          printResultLine(r);
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      // Parse metadata
      let metadata: ParsedMetadata;
      if (typeof deployment.metadata === "string") {
        metadata = JSON.parse(deployment.metadata) as ParsedMetadata;
      } else if (
        deployment.metadata &&
        typeof deployment.metadata === "object"
      ) {
        metadata = deployment.metadata as unknown as ParsedMetadata;
      } else {
        throw new Error("metadata missing in deployment file");
      }

      const { contractName, sourcePath } = getCompilationTarget(metadata);
      const candidateNames = buildCandidateContractNames(
        sourcePath,
        contractName
      );

      const compilerVersion = toCompilerVersionTag(metadata.compiler.version);
      const optimizer = metadata.settings.optimizer || {
        enabled: true,
        runs: 200,
      };
      const runs = optimizer.runs ?? 200;
      const optimizationUsed = optimizer.enabled ? "1" : "0";

      // Load Standard JSON input
      const solcHash = deployment.solcInputHash;
      if (!solcHash) throw new Error("solcInputHash missing");
      const solcInputPath = path.join(solcInputsDir, `${solcHash}.json`);
      const solcInputRaw = await fs.readFile(solcInputPath, "utf8");

      // Encode constructor args
      const encodedArgs = encodeConstructorArgs(
        metadata.output.abi,
        deployment.args,
        deployment.bytecode
      );

      let finalMsg = "";
      let submitted = false;
      const submitErrors: string[] = [];
      let lastCheckNote = "";
      for (const candidate of candidateNames) {
        const form: Record<string, string> = {
          module: "contract",
          action: "verifysourcecode",
          apikey: "not-required",
          contractaddress: address.toLowerCase(),
          sourceCode: solcInputRaw,
          codeformat: "solidity-standard-json-input",
          contractname: candidate,
          compilerversion: compilerVersion,
          optimizationUsed,
          runs: String(runs),
          licenseType: DEFAULT_LICENSE_TYPE,
        };
        if (encodedArgs && encodedArgs.length > 0) {
          (form as any).constructorArguements = encodedArgs; // sic
        }
        await sleep(750);
        const submit = await httpPostForm(BLOCKSCOUT_API_BASE, form);
        if (submit.status !== "1") {
          // Record detailed API error and try next candidate; API may flake
          const submitMsg = [submit.message, toPrintable(submit.result)]
            .filter(Boolean)
            .join(" - ");
          submitErrors.push(`${candidate}: ${submitMsg || "unknown error"}`);
          continue;
        }
        const guid = submit.result;
        submitted = true;
        for (let i = 0; i < 40; i += 1) {
          await sleep(3000);
          const check = await httpGet(
            `${BLOCKSCOUT_API_BASE}?module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}`
          );
          if (check.status === "1") {
            finalMsg = check.result || "OK";
            break;
          }
          if (
            check.status === "0" &&
            typeof check.result === "string" &&
            (check.result.includes("Already Verified") ||
              check.result.includes("Pass - Verified"))
          ) {
            finalMsg = check.result;
            break;
          }
          // Track last non-success status for better error messages
          lastCheckNote = [check.message, toPrintable(check.result)]
            .filter(Boolean)
            .join(" - ");
        }
        if (finalMsg) break;
      }

      if (!submitted) {
        const note = summarizeSubmitErrors(submitErrors);
        const r: VerifyResult = { name, address, ok: false, note };
        results.push(r);
        printResultLine(r);
      } else if (!finalMsg) {
        const r: VerifyResult = {
          name,
          address,
          ok: false,
          note: summarizeTimeoutNote(lastCheckNote),
        };
        results.push(r);
        printResultLine(r);
      } else {
        const r: VerifyResult = { name, address, ok: true, note: finalMsg };
        results.push(r);
        printResultLine(r);
      }
    } catch (err: any) {
      const r: VerifyResult = {
        name,
        address,
        ok: false,
        note: truncateMiddle(err?.message || String(err), 140),
      };
      results.push(r);
      printResultLine(r);
    }
  }

  // Print a compact summary (show only failures for brevity)
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  console.log(`Verified: ${ok.length}, Failed: ${fail.length}`);
  if (fail.length > 0) {
    console.log("Failures:");
    // Deduplicate failures by name+address to avoid noise
    const seen = new Set<string>();
    for (const r of fail) {
      const key = `${r.name}:${r.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(
        `[FAIL] ${r.name} @ ${r.address}${r.note ? ` - ${truncateMiddle(r.note, 120)}` : ""}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
