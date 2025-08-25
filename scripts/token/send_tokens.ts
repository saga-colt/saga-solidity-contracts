import { ethers } from "hardhat";
import hre from "hardhat";
import { getConfig } from "../../config/config";
import { IERC20Detailed } from "../../typechain-types";
import { fetchTokenInfo } from "../../typescript/token/utils";

/**
 * Script to send multiple tokens from deployer wallet to multiple addresses
 * 
 * Usage examples:
 *   yarn hardhat run --network saga_testnet scripts/token/send_tokens.ts
 * 
 * Configure the TOKENS_TO_SEND and DESTINATION_ADDRESSES below before running
 */

// ================================================================================================
// CONFIGURATION - Modify these values before running the script
// ================================================================================================

// List of destination addresses to send tokens to
const DESTINATION_ADDRESSES = [
//   "0x3CED22823Ad70B1d011007fb1d48D279dc3f1f02",
//   "0x781EE269D636b9EcB7C590FCb50120905854e94e",
//   "0x9e3107628e60127E0a9Ba1EFd56611D4A2672f08",
//   "0x078ef0bA848EE19750daF6F06ab1aF3aDD271efe",
//   "0xD3200925Ff2DFB6f4Dfcc4D473DD2Ea690907307",
  "0xe92D69Ed4Fea40760dA2490F170eb59d34cf6811"
  // "0x1234567890123456789012345678901234567890", // Add more addresses as needed
  // "0x5678901234567890123456789012345678901234", // Uncomment and replace with actual addresses
];

// List of tokens to send - can use either symbol (from config) or direct address
// Each token will be sent to ALL destination addresses
const TOKENS_TO_SEND = [
  {
    // Or use direct token address
    address: "0x55F937DEF274C6CBd9444f0857639757C5A2a3E9",
    amount: "10000.0",
  },
  {
    // Or use direct token address
    address: "0x9f2013831e371587a8E39f2A43DF774af2178e35",
    amount: "10000.0",
  },
  {
    // Or use direct token address
    address: "0xD515eb614De9348eF6802ea84695C1975db7D377",
    amount: "10000.0",
  },
  {
    // Or use direct token address
    address: "0xb459960891Ec9fF8736039F5bAE1897223214C18",
    amount: "10000.0",
  },
  {
    // Or use direct token address
    address: "0x64474f3447911DcA644E62A8EED3c422C5B7eFef",
    amount: "10000.0",
  },
  {
    // Or use direct token address
    address: "0x59672F701901b3E56343A5b8EbB8a90aD1221a86",
    amount: "10000.0",
  },
];

// Set to true to skip confirmation prompt (for automated usage)
const SKIP_CONFIRMATION = false;

// Set to true to only simulate transfers without actually sending
const DRY_RUN = false;

// ================================================================================================

interface TokenTransfer {
  symbol?: string;
  address?: string;
  amount: string;
}

interface ResolvedToken {
  address: string;
  symbol: string;
  decimals: number;
  amount: string;
  amountWei: bigint;
  totalAmountWei: bigint; // Total amount needed for all destinations
}

async function resolveTokenAddress(token: TokenTransfer): Promise<string | null> {
  if (token.address) {
    return token.address;
  }
  
  if (token.symbol) {
    try {
      const config = await getConfig(hre);
      const tokenAddresses = config.tokenAddresses as Record<string, string>;
      
      if (tokenAddresses && tokenAddresses[token.symbol]) {
        return tokenAddresses[token.symbol];
      } else {
        console.warn(`⚠️ Token symbol '${token.symbol}' not found in network config`);
        return null;
      }
    } catch (error) {
      console.warn(`⚠️ Could not load network config: ${error}`);
      return null;
    }
  }
  
  return null;
}

async function getTokenDetails(address: string): Promise<{symbol: string, decimals: number} | null> {
  try {
    const tokenInfo = await fetchTokenInfo(hre, address);
    return { symbol: tokenInfo.symbol, decimals: tokenInfo.decimals };
  } catch (error) {
    console.error(`❌ Failed to get token details for ${address}:`, error);
    return null;
  }
}

async function checkTokenBalance(tokenAddress: string, ownerAddress: string, decimals: number): Promise<bigint> {
  try {
    const token = await ethers.getContractAt("IERC20Detailed", tokenAddress) as IERC20Detailed;
    return await token.balanceOf(ownerAddress);
  } catch (error) {
    console.error(`❌ Failed to check balance for token ${tokenAddress}:`, error);
    return 0n;
  }
}

async function sendToken(
  tokenAddress: string, 
  recipient: string, 
  amount: bigint, 
  signer: any
): Promise<string | null> {
  try {
    const token = await ethers.getContractAt("IERC20Detailed", tokenAddress, signer) as IERC20Detailed;
    const tx = await token.transfer(recipient, amount);
    await tx.wait();
    return tx.hash;
  } catch (error) {
    console.error(`❌ Failed to send token ${tokenAddress}:`, error);
    return null;
  }
}

async function getUserConfirmation(message: string): Promise<boolean> {
  if (SKIP_CONFIRMATION) {
    return true;
  }

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question(`${message} (yes/no): `, (answer: string) => {
      readline.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function main(): Promise<void> {
  console.log("🚀 Token Transfer Script");
  console.log("=".repeat(50));
  
  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  
  console.log(`Network: ${hre.network.name}`);
  console.log(`Deployer: ${deployer}`);
  console.log(`Destinations (${DESTINATION_ADDRESSES.length}):`);
  for (const [i, addr] of DESTINATION_ADDRESSES.entries()) {
    console.log(`  ${i + 1}. ${addr}`);
  }
  console.log(`Dry Run: ${DRY_RUN ? 'YES' : 'NO'}`);
  console.log("");

  // Validate destination addresses
  if (DESTINATION_ADDRESSES.length === 0) {
    console.error("❌ No destination addresses specified");
    process.exit(1);
  }
  
  for (const [i, address] of DESTINATION_ADDRESSES.entries()) {
    if (!ethers.isAddress(address)) {
      console.error(`❌ Invalid destination address ${i + 1}: ${address}`);
      process.exit(1);
    }
  }

  // Check deployer balance
//   const deployerBalance = await ethers.provider.getBalance(deployer);
//   console.log(`Deployer ETH balance: ${ethers.formatEther(deployerBalance)} ETH`);
  
//   if (deployerBalance === 0n) {
//     console.error("❌ Deployer has no ETH for gas fees");
//     process.exit(1);
//   }

  // Resolve and validate all tokens
  console.log("\n🔍 Resolving token addresses...");
  const resolvedTokens: ResolvedToken[] = [];

  for (const [index, token] of TOKENS_TO_SEND.entries()) {
    console.log(`\nToken ${index + 1}:`);
    
    // Resolve address
    const address = await resolveTokenAddress(token);
    if (!address) {
      console.error(`❌ Could not resolve address for token ${JSON.stringify(token)}`);
      continue;
    }
    console.log(`  Address: ${address}`);

    // Get token details
    const details = await getTokenDetails(address);
    if (!details) {
      console.error(`❌ Could not get details for token at ${address}`);
      continue;
    }
    console.log(`  Symbol: ${details.symbol}`);
    console.log(`  Decimals: ${details.decimals}`);

    // Parse amount
    let amountWei: bigint;
    try {
      amountWei = ethers.parseUnits(token.amount, details.decimals);
    } catch (error) {
      console.error(`❌ Invalid amount '${token.amount}' for token ${details.symbol}`);
      continue;
    }
    
    // Calculate total amount needed for all destinations
    const totalAmountWei = amountWei * BigInt(DESTINATION_ADDRESSES.length);
    const totalAmountHuman = ethers.formatUnits(totalAmountWei, details.decimals);
    
    console.log(`  Amount per recipient: ${token.amount} ${details.symbol}`);
    console.log(`  Total amount needed: ${totalAmountHuman} ${details.symbol} (for ${DESTINATION_ADDRESSES.length} recipients)`);

    // Check balance
    const balance = await checkTokenBalance(address, deployer, details.decimals);
    const balanceHuman = ethers.formatUnits(balance, details.decimals);
    console.log(`  Deployer Balance: ${balanceHuman} ${details.symbol}`);

    if (balance < totalAmountWei) {
      console.error(`❌ Insufficient balance. Need ${totalAmountHuman}, have ${balanceHuman}`);
      continue;
    }

    resolvedTokens.push({
      address,
      symbol: details.symbol,
      decimals: details.decimals,
      amount: token.amount,
      amountWei,
      totalAmountWei
    });
  }

  if (resolvedTokens.length === 0) {
    console.error("❌ No valid tokens to transfer");
    process.exit(1);
  }

  // Summary
  console.log("\n📋 Transfer Summary:");
  console.log(`Destinations (${DESTINATION_ADDRESSES.length}):`);
  for (const [i, addr] of DESTINATION_ADDRESSES.entries()) {
    console.log(`  ${i + 1}. ${addr}`);
  }
  console.log("\nTokens to transfer:");
  let totalTransfers = 0;
  for (const token of resolvedTokens) {
    console.log(`  ${token.amount} ${token.symbol} → each of ${DESTINATION_ADDRESSES.length} recipients`);
    totalTransfers += DESTINATION_ADDRESSES.length;
  }
  console.log(`Total individual transfers: ${totalTransfers} (${resolvedTokens.length} tokens × ${DESTINATION_ADDRESSES.length} recipients)`);

  // Confirmation
  if (!await getUserConfirmation(`\nProceed with ${DRY_RUN ? 'simulated ' : ''}transfer?`)) {
    console.log("❌ Transfer cancelled by user");
    process.exit(0);
  }

  // Execute transfers
  console.log(`\n🚀 ${DRY_RUN ? 'Simulating' : 'Executing'} transfers...`);
  
  let successCount = 0;
  let failureCount = 0;

  for (const [tokenIndex, token] of resolvedTokens.entries()) {
    console.log(`\n[${tokenIndex + 1}/${resolvedTokens.length}] Transferring ${token.amount} ${token.symbol} to ${DESTINATION_ADDRESSES.length} recipients...`);
    
    for (const [destIndex, destinationAddress] of DESTINATION_ADDRESSES.entries()) {
      console.log(`  [${destIndex + 1}/${DESTINATION_ADDRESSES.length}] Sending to ${destinationAddress}...`);
      
      if (DRY_RUN) {
        console.log(`    ✅ [DRY RUN] Would transfer ${token.amount} ${token.symbol} to ${destinationAddress}`);
        successCount++;
      } else {
        const txHash = await sendToken(token.address, destinationAddress, token.amountWei, deployerSigner);
        
        if (txHash) {
          console.log(`    ✅ Transfer successful!`);
          console.log(`    📃 Transaction: ${txHash}`);
          successCount++;
        } else {
          console.log(`    ❌ Transfer failed!`);
          failureCount++;
        }
      }
    }
  }

  // Final summary
  console.log("\n" + "=".repeat(50));
  console.log("📊 Transfer Results:");
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`📦 Total: ${successCount + failureCount}`);

  if (failureCount > 0) {
    console.log("\n⚠️ Some transfers failed. Check the logs above for details.");
    process.exit(1);
  } else {
    console.log("\n🎉 All transfers completed successfully!");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
  });
