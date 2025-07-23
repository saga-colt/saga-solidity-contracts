# dTRINITY → Saga Fork Replacement Guide

This document outlines all the Sonic-specific and dTRINITY-specific values that need to be replaced when forking the protocol for the Saga blockchain.

## 🔍 Search Reference Tags
Use these tags when doing replacements:
- `#SONIC_NETWORK_CONFIG` - Network configuration replacements
- `#SONIC_CHAIN_DATA` - Chain IDs, URLs, and addresses  
- `#DTRINITY_USER_FACING` - User-facing branding and display names
- `#DTRINITY_KEEP_INTERNAL` - Internal references to keep for compatibility

---

## 1. SONIC BLOCKCHAIN REPLACEMENTS

### Network Configuration Files `#SONIC_NETWORK_CONFIG`

**Primary Configuration:**
- **File:** `hardhat.config.ts:166-178`
  - Network names: `sonic_testnet` → `saga_testnet`
  - Network names: `sonic_mainnet` → `saga_mainnet`
  - RPC URLs: 
    - Testnet: `https://rpc.blaze.soniclabs.com` → `[SAGA_TESTNET_RPC]`
    - Mainnet: `https://rpc.soniclabs.com` → `[SAGA_MAINNET_RPC]`
  - Documentation URL: `https://docs.soniclabs.com/sonic/build-on-sonic/getting-started` → `[SAGA_DOCS_URL]`
  - Environment variables: `sonic_testnet`, `sonic_mainnet` → `saga_testnet`, `saga_mainnet`

**Bot Configuration:**
- **File:** `bot/dlend-liquidator/hardhat.config.ts:25-34`
  - Same network name and RPC URL replacements as above
  - Environment variables: `SONIC_TESTNET_PRIVATE_KEY`, `SONIC_MAINNET_PRIVATE_KEY` → `SAGA_TESTNET_PRIVATE_KEY`, `SAGA_MAINNET_PRIVATE_KEY`

### Chain Data & Explorers `#SONIC_CHAIN_DATA`

**Etherscan Configuration:**
- **File:** `hardhat.config.ts:202-210`
  - API key: `4EJCRRD3JKIE6TKF6ME7AKVYWFEJI79A26` → `[SAGA_API_KEY]`
  - Chain ID: `146` → `[SAGA_CHAIN_ID]`
  - API URL: `https://api.sonicscan.org/api` → `[SAGA_EXPLORER_API]`
  - Browser URL: `https://sonicscan.org` → `[SAGA_EXPLORER_URL]`

**Makefile Explorer URLs:**
- **File:** `Makefile:135-141`
  - Testnet API: `https://api-testnet.sonicscan.org` → `[SAGA_TESTNET_EXPLORER_API]`
  - Mainnet API: `https://api.sonicscan.org` → `[SAGA_MAINNET_EXPLORER_API]`

### Network-Specific Configuration Files `#SONIC_NETWORK_CONFIG`

**🚨 ENTIRE FILES TO REPLACE:**
- `config/networks/sonic_mainnet.ts` → `config/networks/saga_mainnet.ts`
- `config/networks/sonic_testnet.ts` → `config/networks/saga_testnet.ts`
- `bot/dlend-liquidator/config/networks/sonic_mainnet.ts` → `bot/dlend-liquidator/config/networks/saga_mainnet.ts`

**Key values within these files:**
- Token addresses (all Sonic-specific addresses)
- Oracle feed addresses  
- Governance multisig addresses
- Subgraph URL: `https://graph-node-sonic.dtrinity.org/subgraphs/name/dtrinity-aave-sonic` → `[SAGA_SUBGRAPH_URL]`
- Special token name: `"Wrapped Staked Sonic USD"` → `"Wrapped Staked Saga USD"`

### Code References `#SONIC_NETWORK_CONFIG`

**Configuration Imports:**
- **File:** `config/config.ts:4-21`
  - Import paths and network switching logic for sonic networks

**Helper Functions:**
- **File:** `typescript/hardhat/deploy.ts:12-28`
  - Function `isSonicTestnet()` → `isSagaTestnet()`
  - Network references throughout

**Named Accounts:**
- **File:** `typescript/hardhat/named-accounts.ts:13,19,109-110`
  - Network name references in account configurations

### Test Files `#SONIC_NETWORK_CONFIG`

**Test Fixtures:**
- **File:** `test/pendle/fixture.ts:1-23`
  - Export names: `SONIC_MAINNET_PT_TOKENS` → `SAGA_MAINNET_PT_TOKENS`
  - Export names: `SONIC_PY_FACTORY` → `SAGA_PY_FACTORY`

**Test Logic:**
- **Files:** `test/pendle/PendleSwapPOC.ts`, `test/pendle/sdk.ts`
  - Network checks and token usage references

### Infrastructure `#SONIC_CHAIN_DATA`

**Deployment Artifacts:**
- **Directory:** `bot/dlend-liquidator/deployments/sonic_mainnet/` → `bot/dlend-liquidator/deployments/saga_mainnet/`

**Slack Integration:**
- **File:** `bot/dlend-liquidator/typescript/odos_bot/notification.ts:23-28`
  - Environment variables: `SONIC_MAINNET_SLACK_BOT_TOKEN`, `SONIC_MAINNET_SLACK_CHANNEL_ID` → `SAGA_MAINNET_SLACK_BOT_TOKEN`, `SAGA_MAINNET_SLACK_CHANNEL_ID`

**Shell Scripts:**
- All script names: `deploy-sonic-*.sh` → `deploy-saga-*.sh`
- Script references and network parameters within

**Docker & Build:**
- **File:** `bot/dlend-liquidator/Makefile:3`
  - Docker image: `liquidator-bot-sonic` → `liquidator-bot-saga`

### Documentation `#SONIC_NETWORK_CONFIG`

- **File:** `contracts/dstable/dstable-design.md:5` - "Sonic blockchain" → "Saga blockchain"
- **File:** `scripts/dloop/README.md` - Multiple Sonic network references
- **File:** `scripts/oracle/show_oracle_prices.ts:10-22` - Example usage comments

---

## 2. dTRINITY BRANDING REPLACEMENTS

### 🟢 REPLACE - User-Facing Strings `#DTRINITY_USER_FACING`

**Token Display Names:**
- **File:** `deploy/02_dusd_ecosystem/01_dusd_token.ts:17`
  - `"dTRINITY USD"` → `"[NEW_USD_TOKEN_NAME]"`

**Staking Token Names:**
- **Files:** Multiple config files (sonic_mainnet.ts:391, sonic_testnet.ts:429, localhost.ts:475)
  - `"Staked dUSD"` → `"Staked [NEW_USD_TOKEN_NAME]"`

**Vault Names:**
- **Files:** Multiple config files
  - `"Leveraged sFRAX-dUSD Vault"` → `"Leveraged sFRAX-[NEW_USD_SYMBOL] Vault"`
  - `"FRAX-dUSD-3x"` → `"FRAX-[NEW_USD_SYMBOL]-3x"`

**Boost/Vesting Names:**
- **Files:** Multiple config files (sonic_mainnet.ts:427, localhost.ts:549, sonic_testnet.ts:467)
  - `"dBOOST sdUSD Season 1"` → `"[NEW_BOOST_NAME] s[NEW_USD_SYMBOL] Season 1"`
  - `"sdUSD-S1"` → `"s[NEW_USD_SYMBOL]-S1"`

**Documentation:**
- **File:** `contracts/dlend/README.md:1`
  - `"# dTrinity Lend core smart contracts"` → `"# [NEW_PROJECT_NAME] Lend core smart contracts"`

**Test Assertions:**
- **File:** `test/dstable/Stablecoin.ts:36`
  - `assert.equal(name, "dTRINITY USD");` → `assert.equal(name, "[NEW_USD_TOKEN_NAME]");`

### 🟡 REPLACE - Token Symbols `#DTRINITY_SYMBOL_REPLACEMENTS`

**⚠️ IMPORTANT: Token symbols WILL be changed (not kept for compatibility as originally planned)**

**Primary Token Symbols:**
- **File:** `deploy/02_dusd_ecosystem/01_dusd_token.ts:17`
  - `"dUSD"` → `"[NEW_USD_SYMBOL]"`

**Staking Token Symbols:**
- **Files:** Multiple config files (sonic_mainnet.ts:391, sonic_testnet.ts:429, localhost.ts:475)
  - `"sdUSD"` → `"s[NEW_USD_SYMBOL]"`

**Vesting Token Symbols:**
- **Files:** Multiple config files (sonic_mainnet.ts:427, localhost.ts:549, sonic_testnet.ts:467)
  - `"sdUSD-S1"` → `"s[NEW_USD_SYMBOL]-S1"`

**Static AToken Wrapper Symbols:**
- **File:** `deploy/07_dlend_static_wrappers/02_dstable_atoken_wrappers.ts:91-92`
  - Generated symbols: `"Static [aTokenSymbol]"`, `"stk[aTokenSymbol]"` (will update automatically when dUSD symbol changes)

**TypeScript Constants:**
- **File:** `typescript/token/utils.ts:9`
  - `DSTABLE_SYMBOLS = ["dUSD", "dS"]` → `DSTABLE_SYMBOLS = ["[NEW_USD_SYMBOL]"]` (also removing dS)

**Test Fixture Symbols:**
- **Files:** `test/dstable/fixtures.ts:20,89`, `test/dstake/fixture.ts:32,45,64`
  - Various `"dUSD"`, `"sdUSD"` → `"[NEW_USD_SYMBOL]"`, `"s[NEW_USD_SYMBOL]"`

### 🔴 KEEP - Internal/Compatibility `#DTRINITY_KEEP_INTERNAL`

**Attribution Comments:**
- **File:** `contracts/dlend/core/misc/AaveOracle.sol:29`
  - `"* @author Aave (modified by dTrinity)"` - Keep for proper attribution
- **File:** `contracts/vaults/atoken_wrapper/StaticATokenFactory.sol:15`
  - `"* @author BGD labs (modified by dTrinity)"` - Keep for proper attribution

**Package Metadata:**
- **File:** `package.json:4`
  - `"author": "dTRINITY"` - Keep as internal metadata

---

## 3. dS STABLECOIN REMOVAL `#DS_REMOVAL`

### 🗑️ REMOVE - Files/Directories to Delete Entirely

**Complete dS Ecosystem Deployment:**
- **Directory:** `deploy/01_ds_ecosystem/` (13 deployment scripts)
  - **Action:** Delete entire directory
  - **Reason:** Contains all dS token deployment infrastructure

**Liquidator Bot Artifacts:**
- **Files:** 
  - `bot/dlend-liquidator/deployments/sonic_mainnet/FlashMintDstableLiquidatorOdos-dS.json`
  - `bot/dlend-liquidator/deployments/sonic_mainnet/FlashMintDstableLiquidatorPTOdos-dS.json`
  - **Action:** Delete these deployment artifacts
  - **Reason:** dS-specific liquidator contracts

### 🔧 MODIFY - Files with dS References to Clean

**TypeScript Constants:**
- **File:** `typescript/deploy-ids.ts:47-53,116,131-133,137`
  - **Remove:** All dS-related deployment ID constants (DS_TOKEN_ID, DS_ISSUER_CONTRACT_ID, etc.)

- **File:** `typescript/token/utils.ts:9`
  - **Change:** `DSTABLE_SYMBOLS = ["dUSD", "dS"]` → `DSTABLE_SYMBOLS = ["[NEW_USD_SYMBOL]"]`

- **File:** `typescript/atoken_wrapper/ids.ts:8,15`
  - **Remove:** dS case from conditional logic

**Network Configuration Files:**
- **Files:** `config/networks/sonic_mainnet.ts`, `config/networks/localhost.ts`
  - **Remove:** All dS imports, configuration blocks, and token addresses
  - **Remove:** dS from dLend reserves configuration

- **File:** `config/types.ts:106`
  - **Remove:** `readonly dS: string;` from TokenAddresses interface

**dLend Configuration:**
- **File:** `config/dlend/reserves-params.ts:34-37`
  - **Remove:** `strategyDS` export and configuration

**Deployment Scripts:**
- **File:** `deploy/09_redeemer_with_fees/01_deploy_redeemer_with_fees.ts`
  - **Remove:** All dS-related deployment logic while keeping dUSD functionality

- **File:** `deploy/07_dlend_static_wrappers/02_dstable_atoken_wrappers.ts`
  - **Update:** Will automatically exclude dS when removed from DSTABLE_SYMBOLS

**Test Files:**
- **File:** `test/dstable/fixtures.ts:88-97`
  - **Remove:** DS_CONFIG export

- **File:** `test/dstake/fixture.ts:32,62-78,81`
  - **Remove:** SDS_CONFIG and related references

- **Files:** `test/dstable/RedeemerWithFees.ts`, `test/dstake/DStakeRewardManagerDLend.ts`, `test/dlend/fixtures.ts`
  - **Remove:** dS test cases and conditional logic

### ✅ KEEP - dSTABLE Infrastructure for Future Stablecoins

**Core Contract Templates:** `contracts/dstable/`
- ERC20StablecoinUpgradeable.sol, Issuer.sol, Redeemer.sol, etc.
- **Reason:** Generic, reusable infrastructure

**Oracle System:** `contracts/oracle_aggregator/`
- **Reason:** Currency-agnostic oracle infrastructure

**dUSD Ecosystem:** `deploy/02_dusd_ecosystem/`
- **Reason:** Primary USD stablecoin implementation

**Interface Definitions:** All IMintableERC20 and related interfaces
- **Reason:** Standard interfaces for future token integration

---

## 4. REPLACEMENT CHECKLIST

### Phase 1: Network Infrastructure
- [ ] Update hardhat.config.ts network configurations
- [ ] Replace network-specific config files (sonic_mainnet.ts, sonic_testnet.ts)
- [ ] Update bot configuration files
- [ ] Replace chain IDs, RPC URLs, and explorer URLs
- [ ] Update environment variable names
- [ ] Replace subgraph URLs

### Phase 2: Code References  
- [ ] Update helper functions (isSonicTestnet → isSagaTestnet)
- [ ] Replace network name references in TypeScript files
- [ ] Update test files and fixtures
- [ ] Replace deployment script names and references
- [ ] Update Makefile targets

### Phase 3: Token Branding & Symbols
- [ ] Replace user-facing token names in deployment scripts
- [ ] Update token symbols in deployment scripts (dUSD → NEW_USD_SYMBOL)
- [ ] Update staking token display names and symbols in config files
- [ ] Replace vault names and symbols
- [ ] Update boost/vesting product names and symbols
- [ ] Fix test assertions with new token names and symbols
- [ ] Update TypeScript constants (DSTABLE_SYMBOLS array)
- [ ] Update documentation headers

### Phase 4: dS Stablecoin Removal
- [ ] Delete deploy/01_ds_ecosystem/ directory entirely
- [ ] Delete dS liquidator bot deployment artifacts
- [ ] Remove dS deployment ID constants from typescript/deploy-ids.ts
- [ ] Remove dS from typescript/token/utils.ts DSTABLE_SYMBOLS array
- [ ] Clean dS references from network configuration files
- [ ] Remove dS from dLend reserves configuration
- [ ] Remove dS test fixtures and test cases
- [ ] Update TokenAddresses interface to remove dS property

### Phase 5: Infrastructure & Deployment
- [ ] Rename deployment artifact directories
- [ ] Update Docker image names
- [ ] Replace Slack integration environment variables
- [ ] Update shell script names and content
- [ ] Replace documentation references

---

## 5. REFERENCE MAPPING TABLE

| Category | Current Value | Replacement Needed |
|----------|---------------|-------------------|
| **Network Names** | sonic_testnet, sonic_mainnet | saga_testnet, saga_mainnet |
| **Chain ID** | 146 | [SAGA_CHAIN_ID] |
| **RPC URLs** | https://rpc.soniclabs.com | [SAGA_RPC_URL] |
| **Explorer** | https://sonicscan.org | [SAGA_EXPLORER_URL] |
| **API URLs** | https://api.sonicscan.org | [SAGA_API_URL] |
| **USD Token Name** | "dTRINITY USD" | "[NEW_USD_TOKEN_NAME]" |
| **USD Token Symbol** | "dUSD" | "[NEW_USD_SYMBOL]" |
| **Staked USD Symbol** | "sdUSD" | "s[NEW_USD_SYMBOL]" |
| **Boost Name** | "dBOOST" | "[NEW_BOOST_NAME]" |
| **Project Name** | "dTrinity" | "[NEW_PROJECT_NAME]" |
| **Subgraph URL** | graph-node-sonic.dtrinity.org | [SAGA_SUBGRAPH_URL] |

---

**⚠️ IMPORTANT NOTES:**
1. **Token symbols WILL be changed** (updated from original plan)
2. **dS stablecoin will be completely removed** while preserving dSTABLE infrastructure
3. **dSTABLE infrastructure confirmed reusable** for future stablecoins (dEUR, dJPY, etc.)
4. Internal attribution comments should be kept for proper credit
5. Test localhost network behavior to ensure nothing breaks between changes
6. No references to dPOOL and dLOOP were found (as expected)

**📋 Ready for your input on the replacement values marked with [BRACKETS]**