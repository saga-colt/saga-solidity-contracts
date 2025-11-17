import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { isMainnet } from "./deploy";
import { SafeTransactionBatch, SafeTransactionData, SagaSafeConfig, SagaSafeManager } from "./saga-safe-manager";

/**
 * Saga-specific GovernanceExecutor that uses the API Kit-based Safe Manager
 * This avoids the Protocol Kit which doesn't support Saga's Safe deployments
 */
export class SagaGovernanceExecutor {
  private readonly hre: HardhatRuntimeEnvironment;
  private readonly signer: Signer;
  private readonly safeManager?: SagaSafeManager;
  private readonly transactions: SafeTransactionData[] = [];
  readonly useSafe: boolean;

  constructor(hre: HardhatRuntimeEnvironment, signer: Signer, safeConfig?: SagaSafeConfig) {
    this.hre = hre;
    this.signer = signer;

    const envForce = process.env.USE_SAFE?.toLowerCase() === "true";
    const networkIsMainnet = isMainnet(hre.network.name);

    this.useSafe = Boolean(safeConfig) && (networkIsMainnet || envForce);

    if (this.useSafe && safeConfig) {
      this.safeManager = new SagaSafeManager(hre, signer, safeConfig);
    }
  }

  /** Initialize Safe only if Safe mode is enabled */
  async initialize(): Promise<void> {
    if (this.safeManager) {
      await this.safeManager.initialize();
    }
  }

  /** Expose queued transactions (read-only) */
  get queuedTransactions(): readonly SafeTransactionData[] {
    return this.transactions;
  }

  /**
   * Queue a Safe transaction without attempting a direct call.
   *
   * @param safeTxBuilder - Builder returning the Safe transaction to enqueue
   */
  queueTransaction(safeTxBuilder: () => SafeTransactionData): void {
    if (!this.useSafe) {
      throw new Error("Safe mode disabled; cannot queue governance transaction");
    }
    const tx = safeTxBuilder();
    this.transactions.push(tx);
  }

  /**
   * Attempt an on-chain call; on failure, queue a Safe transaction if enabled.
   * Returns whether the requirement is considered complete (true) or pending
   * governance/manual action (false).
   *
   * @param directCall - Async fn that attempts to perform the action directly on-chain
   * @param safeTxBuilder - Optional builder that returns a Safe transaction when queuing is needed
   */
  async tryOrQueue<T>(directCall: () => Promise<T>, safeTxBuilder?: () => SafeTransactionData): Promise<boolean> {
    try {
      await directCall();
      return true;
    } catch (error) {
      if (this.useSafe && safeTxBuilder) {
        const tx = safeTxBuilder();
        this.transactions.push(tx);
        return false;
      }

      console.warn("Direct execution failed; marking requirement as pending:", error);
      return false;
    }
  }

  /**
   * Flush queued transactions into a Safe batch (if any and in Safe mode).
   * Returns true if either not in Safe mode, or batch prepared successfully.
   *
   * @param description - Human-readable summary for the Safe batch
   */
  async flush(description: string): Promise<boolean> {
    if (!this.useSafe || !this.safeManager || this.transactions.length === 0) {
      return true;
    }

    const batch: SafeTransactionBatch = {
      description,
      transactions: this.transactions,
    };

    const res = await this.safeManager.createBatchTransaction(batch);

    if (!res.success) {
      const reason = res.error ? `: ${res.error}` : "";
      throw new Error(`Failed to create Safe transactions${reason}`);
    }

    return true;
  }
}
