import SafeApiKit from "@safe-global/api-kit";
import { ethers, Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export interface SafeTransactionData {
  readonly to: string;
  readonly value: string;
  readonly data: string;
  readonly operation?: number; // 0 = Call, 1 = DelegateCall
}

export interface SafeTransactionBatch {
  readonly transactions: SafeTransactionData[];
  readonly description: string;
}

export interface SagaSafeConfig {
  readonly safeAddress: string;
  readonly chainId: number;
  readonly txServiceUrl: string;
}

export interface SafeOperationResult {
  readonly success: boolean;
  readonly safeTxHash?: string;
  readonly error?: string;
}

/**
 * Saga-specific Safe Manager using only the API Kit
 * This bypasses the Protocol Kit which doesn't support Saga's Safe deployments
 */
export class SagaSafeManager {
  private apiKit?: SafeApiKit;
  private signer: Signer;
  private config: SagaSafeConfig;
  private hre: HardhatRuntimeEnvironment;
  private signerAddress?: string;

  constructor(hre: HardhatRuntimeEnvironment, signer: Signer, config: SagaSafeConfig) {
    this.hre = hre;
    this.signer = signer;
    this.config = config;
  }

  /**
   * Initialize the Safe API Kit
   */
  async initialize(): Promise<void> {
    try {
      console.log(`🔄 Initializing Saga Safe API Kit for Safe ${this.config.safeAddress}`);

      // Get signer address
      this.signerAddress = await this.signer.getAddress();

      // Initialize API Kit
      this.apiKit = new SafeApiKit({
        chainId: BigInt(this.config.chainId),
        txServiceUrl: this.config.txServiceUrl,
      });

      // Verify Safe exists
      const safeInfo = await this.apiKit.getSafeInfo(this.config.safeAddress);
      console.log(`✅ Safe Manager initialized successfully`);
      console.log(`   - Safe version: ${safeInfo.version}`);
      console.log(`   - Threshold: ${safeInfo.threshold}/${safeInfo.owners.length}`);
      console.log(`   - Nonce: ${safeInfo.nonce}`);
    } catch (error) {
      console.error(`❌ Failed to initialize Saga Safe Manager:`, error);
      throw error;
    }
  }

  /**
   * Create a batch transaction using MultiSendCallOnly and propose it to the Safe
   *
   * @param batch
   */
  async createBatchTransaction(batch: SafeTransactionBatch): Promise<SafeOperationResult> {
    if (!this.apiKit || !this.signerAddress) {
      throw new Error("Safe Manager not initialized. Call initialize() first.");
    }

    try {
      console.log(`\n📦 Creating Safe batch transaction: ${batch.description}`);
      console.log(`   - Requested transactions: ${batch.transactions.length}`);

      // Get Safe info for nonce
      const safeInfo = await this.apiKit.getSafeInfo(this.config.safeAddress);
      let nonce = Number(safeInfo.nonce);

      const pendingTxIdentities = new Set<string>();

      // Check for pending transactions and adjust nonce accordingly
      try {
        const pendingTxs = await this.apiKit.getPendingTransactions(this.config.safeAddress);

        if (pendingTxs.results && pendingTxs.results.length > 0) {
          // Find the highest nonce among pending transactions
          const maxPendingNonce = Math.max(...pendingTxs.results.map((tx: any) => Number(tx.nonce)));

          if (maxPendingNonce >= nonce) {
            nonce = maxPendingNonce + 1;
            console.log(`   - Found ${pendingTxs.results.length} pending transactions, using nonce ${nonce}`);
          }

          for (const pendingTx of pendingTxs.results) {
            const identity = this.buildTransactionIdentity({
              to: pendingTx.to,
              value: pendingTx.value ?? "0",
              data: pendingTx.data ?? "0x",
              operation: typeof pendingTx.operation === "number" ? pendingTx.operation : Number(pendingTx.operation ?? 0),
            });

            pendingTxIdentities.add(identity);
          }
        }
      } catch (error) {
        console.log(`   - Could not fetch pending transactions, using current nonce ${nonce}`);
      }

      // Filter out duplicate and already-pending transactions
      const uniqueTransactions: SafeTransactionData[] = [];
      const batchIdentities = new Set<string>();

      for (const tx of batch.transactions) {
        const identity = this.buildTransactionIdentity(tx);

        if (batchIdentities.has(identity)) {
          console.log(`   - Skipping duplicate transaction already present in batch (to=${tx.to})`);
          continue;
        }

        if (pendingTxIdentities.has(identity)) {
          console.log(`   - Skipping transaction already pending in Safe queue (to=${tx.to})`);
          continue;
        }

        batchIdentities.add(identity);
        uniqueTransactions.push(tx);
      }

      if (uniqueTransactions.length === 0) {
        console.log(`   - No new transactions to propose (all already pending or duplicates)`);
        return {
          success: true,
          safeTxHash: undefined,
        };
      }

      console.log(`   - Unique new transactions: ${uniqueTransactions.length}`);

      // MultiSendCallOnly contract address on Saga (Safe 1.4.1)
      const MULTISEND_CALL_ONLY_ADDRESS = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";

      // Encode unique transactions into MultiSend format
      const multiSendData = this.encodeMultiSendData(uniqueTransactions);

      // Skip if an identical MultiSend transaction is already pending
      const multiSendIdentity = this.buildTransactionIdentity({
        to: MULTISEND_CALL_ONLY_ADDRESS,
        value: "0",
        data: multiSendData,
        operation: 1,
      });

      if (pendingTxIdentities.has(multiSendIdentity)) {
        console.log(`   - Matching MultiSend transaction already pending. Skipping proposal.`);
        return {
          success: true,
        };
      }

      console.log(`   - Safe nonce: ${nonce}`);
      console.log(`   - MultiSendCallOnly address: ${MULTISEND_CALL_ONLY_ADDRESS}`);

      // Create the Safe transaction calling MultiSendCallOnly
      const safeTx = {
        to: MULTISEND_CALL_ONLY_ADDRESS,
        value: "0",
        data: multiSendData,
        operation: 1, // DelegateCall for MultiSend
        safeTxGas: "0",
        baseGas: "0",
        gasPrice: "0",
        gasToken: ethers.ZeroAddress,
        refundReceiver: ethers.ZeroAddress,
        nonce: nonce,
      };

      // Calculate Safe transaction hash
      const safeTxHash = await this.calculateSafeTxHash(safeTx);

      console.log(`   - Safe transaction hash: ${safeTxHash.slice(0, 20)}...`);

      // Sign the transaction
      const signature = await this.signSafeTransaction(safeTxHash);

      // Propose the transaction to the Safe service
      await this.apiKit.proposeTransaction({
        safeAddress: this.config.safeAddress,
        safeTransactionData: safeTx,
        safeTxHash: safeTxHash,
        senderAddress: this.signerAddress,
        senderSignature: signature,
      });

      console.log(`\n✅ Safe batch transaction proposed successfully`);
      console.log(`   - Batched ${uniqueTransactions.length} operations into 1 Safe transaction`);
      console.log(`   - View in Safe UI: https://app.safe.global/transactions/queue?safe=saga:${this.config.safeAddress}`);

      return {
        success: true,
        safeTxHash: safeTxHash,
      };
    } catch (error) {
      console.error(`❌ Failed to create Safe batch transaction:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Encode multiple transactions into MultiSend format
   *
   * @param transactions
   */
  private encodeMultiSendData(transactions: SafeTransactionData[]): string {
    // MultiSend encodes transactions as: [operation(1)][to(20)][value(32)][dataLength(32)][data(dataLength)]
    let encodedTxs = "0x";

    for (const tx of transactions) {
      const operation = (tx.operation ?? 0).toString(16).padStart(2, "0");
      const to = tx.to.slice(2).padStart(40, "0");
      const value = BigInt(tx.value).toString(16).padStart(64, "0");
      const data = tx.data.slice(2);
      const dataLength = (data.length / 2).toString(16).padStart(64, "0");

      encodedTxs += operation + to + value + dataLength + data;
    }

    // Encode as MultiSendCallOnly.multiSend(bytes)
    const multiSendInterface = new ethers.Interface(["function multiSend(bytes memory transactions) public payable"]);

    return multiSendInterface.encodeFunctionData("multiSend", [encodedTxs]);
  }

  /**
   * Calculate the Safe transaction hash
   *
   * @param safeTx
   */
  private async calculateSafeTxHash(safeTx: any): Promise<string> {
    // Get Safe contract info
    const safeInfo = await this.apiKit!.getSafeInfo(this.config.safeAddress);

    // EIP-712 domain for Safe
    const domain = {
      chainId: this.config.chainId,
      verifyingContract: this.config.safeAddress,
    };

    // Safe transaction type
    const types = {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    };

    // Safe transaction data
    const message = {
      to: safeTx.to,
      value: safeTx.value,
      data: safeTx.data,
      operation: safeTx.operation,
      safeTxGas: safeTx.safeTxGas,
      baseGas: safeTx.baseGas,
      gasPrice: safeTx.gasPrice,
      gasToken: safeTx.gasToken,
      refundReceiver: safeTx.refundReceiver,
      nonce: safeTx.nonce,
    };

    // Calculate EIP-712 hash
    const safeTxHash = ethers.TypedDataEncoder.hash(domain, types, message);

    return safeTxHash;
  }

  /**
   * Build a deterministic identity string for a Safe transaction payload
   *
   * @param tx
   */
  private buildTransactionIdentity(tx: Pick<SafeTransactionData, "to" | "value" | "data" | "operation">): string {
    const to = ethers.getAddress(tx.to);
    const value = BigInt(tx.value ?? "0").toString();
    const data = (tx.data ?? "0x").toLowerCase();
    const operation = tx.operation ?? 0;

    return `${to}|${value}|${data}|${operation}`;
  }

  /**
   * Sign a Safe transaction hash
   *
   * @param safeTxHash
   */
  private async signSafeTransaction(safeTxHash: string): Promise<string> {
    // Sign the Safe transaction hash
    const signature = await this.signer.signMessage(ethers.getBytes(safeTxHash));

    // Adjust v for eth_sign compatibility (add 4)
    const signatureBytes = ethers.getBytes(signature);
    signatureBytes[signatureBytes.length - 1] += 4;

    return ethers.hexlify(signatureBytes);
  }
}
