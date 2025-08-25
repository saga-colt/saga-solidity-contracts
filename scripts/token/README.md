# Token Transfer Scripts

This directory contains scripts for token-related operations.

## send_tokens.ts

A script to send multiple ERC20 tokens from the deployer wallet to multiple addresses simultaneously.

### Features

- **Multi-destination support** - Send tokens to multiple addresses in one execution
- **Multi-token support** - Send multiple different tokens simultaneously  
- **Flexible token specification** - Use either symbols (from network config) or direct addresses
- **Smart balance validation** - Calculates total amount needed for all destinations
- **Dry-run mode** - Test transfers without actually sending tokens
- **Detailed logging** - Shows progress for each token to each destination
- **Transaction tracking** - Records all transaction hashes
- **Safety confirmations** - Requires user approval before execution

### Configuration

Before running the script, you must modify the configuration variables at the top of the file:

```typescript
// List of destination addresses to send tokens to
const DESTINATION_ADDRESSES = [
  "0x3CED22823Ad70B1d011007fb1d48D279dc3f1f02",
  "0x1234567890123456789012345678901234567890", // Add more addresses as needed
  // "0x5678901234567890123456789012345678901234", // Uncomment and replace with actual addresses
];

// List of tokens to send - each token will be sent to ALL destination addresses
const TOKENS_TO_SEND = [
  {
    symbol: "USDC",      // Use symbol from network config
    amount: "100.0",     // Amount per recipient in human-readable format
  },
  {
    symbol: "USDT", 
    amount: "50.0",
  },
  {
    address: "0x1234567890123456789012345678901234567890", // Or use direct address
    amount: "1000.0",
  }
];

// Optional flags
const SKIP_CONFIRMATION = false;  // Set to true for automated usage
const DRY_RUN = false;           // Set to true to simulate transfers
```

### Usage

1. **Configure the script**: Edit the `DESTINATION_ADDRESSES` and `TOKENS_TO_SEND` variables
2. **Run the script**:
   ```bash
   yarn hardhat run --network <network_name> scripts/token/send_tokens.ts
   ```

### Examples

#### Send tokens to multiple addresses (e.g., team members):
```bash
# Configure DESTINATION_ADDRESSES with multiple wallet addresses
yarn hardhat run --network saga_testnet scripts/token/send_tokens.ts
```

#### Send tokens to multisig and treasury:
```bash
# Add both multisig and treasury addresses to DESTINATION_ADDRESSES
yarn hardhat run --network saga_testnet scripts/token/send_tokens.ts
```

#### Dry run to test configuration:
```bash
# Set DRY_RUN = true in the script
yarn hardhat run --network saga_testnet scripts/token/send_tokens.ts
```

### Safety Features

- **Smart balance validation**: Calculates total amount needed for all destinations and validates deployer has sufficient tokens
- **Address validation**: Validates all destination addresses format  
- **Confirmation prompt**: Shows detailed summary and requires user confirmation before executing transfers (unless skipped)
- **Dry run mode**: Test transfers without actually sending tokens
- **Individual error handling**: Failed transfers to one address don't stop transfers to other addresses
- **Detailed logging**: Shows progress for each token to each destination with transaction hashes

### Multi-Destination Behavior

**Important**: Each token will be sent to **ALL** destination addresses specified in `DESTINATION_ADDRESSES`.

For example, if you configure:
- 2 tokens (USDC: 100, USDT: 50) 
- 3 destination addresses

The script will perform **6 total transfers**:
- 100 USDC → Address 1
- 100 USDC → Address 2  
- 100 USDC → Address 3
- 50 USDT → Address 1
- 50 USDT → Address 2
- 50 USDT → Address 3

**Total tokens needed**: 300 USDC + 150 USDT from deployer wallet.

### Token Resolution

The script supports two ways to specify tokens:

1. **By symbol**: Use the `symbol` field with a symbol from your network configuration
2. **By address**: Use the `address` field with the direct token contract address

Token symbols are resolved using the network configuration files in `config/networks/`.

### Error Handling

The script handles various error scenarios:
- Invalid token addresses
- Insufficient balances
- Network connectivity issues
- Transaction failures

Failed transfers are logged and don't stop the execution of subsequent transfers.

### Output

The script provides detailed output including:
- Token resolution and validation
- Balance checks
- Transfer execution with transaction hashes
- Final summary of successful/failed transfers

Example output:
```
🚀 Token Transfer Script
==================================================
Network: saga_testnet
Deployer: 0x1234...
Destinations (2):
  1. 0x5678...
  2. 0x9ABC...

🔍 Resolving token addresses...

Token 1:
  Address: 0xabcd...
  Symbol: USDC
  Decimals: 6
  Amount per recipient: 100.0 USDC
  Total amount needed: 200.0 USDC (for 2 recipients)
  Deployer Balance: 1000.0 USDC

📋 Transfer Summary:
Destinations (2):
  1. 0x5678...
  2. 0x9ABC...

Tokens to transfer:
  100.0 USDC → each of 2 recipients
Total individual transfers: 2 (1 tokens × 2 recipients)

🚀 Executing transfers...

[1/1] Transferring 100.0 USDC to 2 recipients...
  [1/2] Sending to 0x5678...
    ✅ Transfer successful!
    📃 Transaction: 0x9876...
  [2/2] Sending to 0x9ABC...
    ✅ Transfer successful!
    📃 Transaction: 0x5432...

📊 Transfer Results:
✅ Successful: 2
❌ Failed: 0
📦 Total: 2

🎉 All transfers completed successfully!
```
