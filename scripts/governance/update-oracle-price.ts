import { ethers } from "hardhat";
import { getConfig } from "../../config/config";
import Safe, { EthersAdapter } from "@safe-global/protocol-kit";
import { SafeApiKit } from "@safe-global/api-kit";

/**
 * Generate Safe transaction to update GovernanceOracleWrapper price
 *
 * Usage:
 *   NEW_PRICE=1.00 npx hardhat run scripts/governance/update-oracle-price.ts --network saga
 *
 * Environment variables:
 *   NEW_PRICE - Price in USD (e.g., "1.00" for $1.00)
 *   ORACLE_ADDRESS - GovernanceOracleWrapper address (optional, uses deployed)
 *   CONFIRM_LARGE_CHANGE - Set to "yes" for changes > 50%
 */

function calculateChangeBps(oldPrice: bigint, newPrice: bigint): bigint {
  if (newPrice >= oldPrice) {
    const increase = newPrice - oldPrice;
    return (increase * 10000n) / oldPrice;
  } else {
    const decrease = oldPrice - newPrice;
    return -((decrease * 10000n) / oldPrice);
  }
}

async function main() {
  const config = await getConfig(hre);
  const [proposer] = await ethers.getSigners();

  // Parse inputs
  const newPriceUsd = process.env.NEW_PRICE;
  if (!newPriceUsd) {
    throw new Error("NEW_PRICE environment variable required (e.g., NEW_PRICE=1.00)");
  }

  const newPrice = ethers.parseUnits(newPriceUsd, 18);
  console.log(`📊 New price: $${newPriceUsd} (${newPrice.toString()} wei)`);

  // Get oracle address
  const oracleAddress = process.env.ORACLE_ADDRESS || (await hre.deployments.get("MUST_GovernanceOracleWrapper")).address;
  console.log(`🔗 Oracle address: ${oracleAddress}`);

  // Get wrapper contract
  const wrapper = await ethers.getContractAt("GovernanceOracleWrapper", oracleAddress);

  // Get current state
  const currentPrice = await wrapper.price();
  const currentPriceUsd = ethers.formatUnits(currentPrice, 18);
  const bpsTolerance = await wrapper.bpsTolerance();

  console.log(`💰 Current price: $${currentPriceUsd}`);
  console.log(`🎯 BPS Tolerance: ${bpsTolerance} (0.0${bpsTolerance}%)`);

  if (currentPrice === newPrice) {
    console.log("⚠️  New price is same as current price. Exiting.");
    return;
  }

  // Calculate change in basis points
  const changeBps = calculateChangeBps(currentPrice, newPrice);
  const changePercent = Number(changeBps) / 100;

  console.log(`\n📈 Price change: ${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}% (${changeBps} bps)`);

  // Sanity check: warn on large changes
  const absChangeBps = changeBps >= 0n ? changeBps : -changeBps;
  if (absChangeBps > 5000n) {
    // 50%
    console.log(`\n⚠️  WARNING: Large price change detected!`);
    console.log(`   Change: ${changePercent.toFixed(2)}%`);
    console.log(`   Please verify this is intentional.`);

    const confirm = process.env.CONFIRM_LARGE_CHANGE;
    if (confirm !== "yes") {
      console.log(`\n   To proceed, set CONFIRM_LARGE_CHANGE=yes`);
      throw new Error("Large change not confirmed");
    }
  }

  // Initialize Safe SDK
  const ethAdapter = new EthersAdapter({
    ethers,
    signerOrProvider: proposer,
  });

  const safeAddress = config.walletAddresses.governanceMultisig;
  const safeSdk = await Safe.create({
    ethAdapter,
    safeAddress,
  });

  console.log(`\n🔐 Governance Safe: ${safeAddress}`);

  // Create transaction
  const txData = wrapper.interface.encodeFunctionData("setPrice", [
    currentPrice, // Expected old price
    newPrice, // New price
    changeBps, // Expected change in bps
  ]);

  const safeTransaction = await safeSdk.createTransaction({
    transactions: [
      {
        to: oracleAddress,
        value: "0",
        data: txData,
      },
    ],
  });

  const safeTxHash = await safeSdk.getTransactionHash(safeTransaction);
  console.log(`\n✅ Safe transaction created`);
  console.log(`   Transaction hash: ${safeTxHash}`);

  // Propose to Safe service
  const safeService = new SafeApiKit({
    chainId: await ethAdapter.getChainId(),
    txServiceUrl: config.safeConfig.txServiceUrl,
  });

  await safeService.proposeTransaction({
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: await proposer.getAddress(),
  });

  console.log(`\n🎉 Transaction proposed to Safe!`);
  console.log(`   View in Safe UI: https://app.safe.global/transactions/queue?safe=saga:${safeAddress}`);
  console.log(`\n📋 Transaction Summary:`);
  console.log(`   Function: setPrice(uint256,uint256,int256)`);
  console.log(`   Expected old price: $${currentPriceUsd}`);
  console.log(`   New price: $${newPriceUsd}`);
  console.log(`   Expected change: ${changeBps} bps (${changePercent.toFixed(2)}%)`);
  console.log(`   Tolerance: ±${bpsTolerance} bps`);
  console.log(`\n   Signers can verify these values in the Safe UI.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
