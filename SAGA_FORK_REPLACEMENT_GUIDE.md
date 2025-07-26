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
    - Testnet: `https://rpc.blaze.soniclabs.com` → `https://sagaevm.jsonrpc.sagarpc.io/`
    - Mainnet: `https://rpc.soniclabs.com` → `https://sagaevm.jsonrpc.sagarpc.io/`
  - Documentation URL: `https://docs.soniclabs.com/sonic/build-on-sonic/getting-started` → **REMOVE** (delete documentation references)
  - Environment variables: `sonic_testnet`, `sonic_mainnet` → `saga_testnet`, `saga_mainnet`
  - **NOTE:** Both testnet and mainnet use same RPC as Saga has no testnet - staging deployed to mainnet with isolation

**Bot Configuration:**
- **File:** `bot/dlend-liquidator/hardhat.config.ts:25-34`
  - Same network name and RPC URL replacements as above
  - Environment variables: `SONIC_TESTNET_PRIVATE_KEY`, `SONIC_MAINNET_PRIVATE_KEY` → `SAGA_TESTNET_PRIVATE_KEY`, `SAGA_MAINNET_PRIVATE_KEY`

### Chain Data & Explorers `#SONIC_CHAIN_DATA`

**Etherscan Configuration:**
- **File:** `hardhat.config.ts:202-210`
  - API key: `4EJCRRD3JKIE6TKF6ME7AKVYWFEJI79A26` → `PLACEHOLDER_SAGA_API_KEY_UNIQUE_001` (remove and leave placeholder)
  - Chain ID: `146` → `5464`
  - API URL: `https://api.sonicscan.org/api` → `PLACEHOLDER_SAGA_EXPLORER_API_UNIQUE_002`
  - Browser URL: `https://sonicscan.org` → `PLACEHOLDER_SAGA_EXPLORER_URL_UNIQUE_003`

**Makefile Explorer URLs:**
- **File:** `Makefile:135-141`
  - Testnet API: `https://api-testnet.sonicscan.org` → `PLACEHOLDER_SAGA_TESTNET_EXPLORER_API_UNIQUE_004`
  - Mainnet API: `https://api.sonicscan.org` → `PLACEHOLDER_SAGA_MAINNET_EXPLORER_API_UNIQUE_005`

### Network-Specific Configuration Files `#SONIC_NETWORK_CONFIG`

**🚨 ENTIRE FILES TO REPLACE:**
- `config/networks/sonic_mainnet.ts` → `config/networks/saga_mainnet.ts`
- `config/networks/sonic_testnet.ts` → `config/networks/saga_testnet.ts`
- `bot/dlend-liquidator/config/networks/sonic_mainnet.ts` → `bot/dlend-liquidator/config/networks/saga_mainnet.ts`

**Key values within these files:**
- Token addresses (all Sonic-specific addresses)
- Oracle feed addresses  
- Governance multisig addresses
- Subgraph URL: `https://graph-node-sonic.dtrinity.org/subgraphs/name/dtrinity-aave-sonic` → `PLACEHOLDER_SAGA_SUBGRAPH_URL_UNIQUE_006`
- Special token name: `"Wrapped Staked Sonic USD"` → `"Wrapped Staked Saga Dollar"`

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
  - `"dTRINITY USD"` → `"Saga Dollar"`

**Staking Token Names:**
- **Files:** Multiple config files (sonic_mainnet.ts:391, sonic_testnet.ts:429, localhost.ts:475)
  - `"Staked dUSD"` → `"Staked Saga Dollar"`

**Vault Names:**
- **Files:** Multiple config files
  - `"Leveraged sFRAX-dUSD Vault"` → `"Leveraged sFRAX-D Vault"`
  - `"FRAX-dUSD-3x"` → `"FRAX-D-3x"`

**Boost/Vesting Names:**
- **Files:** Multiple config files (sonic_mainnet.ts:427, localhost.ts:549, sonic_testnet.ts:467)
  - `"dBOOST sdUSD Season 1"` → **REMOVE** (dBOOST system will be deleted entirely)
  - `"sdUSD-S1"` → **REMOVE** (vesting system will be deleted entirely)

**Documentation:**
- **File:** `contracts/dlend/README.md:1`
  - `"# dTrinity Lend core smart contracts"` → `"# Colt Lend core smart contracts"`

**Test Assertions:**
- **File:** `test/dstable/Stablecoin.ts:36`
  - `assert.equal(name, "dTRINITY USD");` → `assert.equal(name, "Saga Dollar");`

### 🟡 REPLACE - Token Symbols `#DTRINITY_SYMBOL_REPLACEMENTS`

**⚠️ IMPORTANT: Token symbols WILL be changed (not kept for compatibility as originally planned)**

**Primary Token Symbols:**
- **File:** `deploy/02_dusd_ecosystem/01_dusd_token.ts:17`
  - `"dUSD"` → `"D"`

**Staking Token Symbols:**
- **Files:** Multiple config files (sonic_mainnet.ts:391, sonic_testnet.ts:429, localhost.ts:475)
  - `"sdUSD"` → `"sD"`

**Vesting Token Symbols:**
- **Files:** Multiple config files (sonic_mainnet.ts:427, localhost.ts:549, sonic_testnet.ts:467)
  - `"sdUSD-S1"` → **REMOVE** (entire vesting system will be deleted)

**Static AToken Wrapper Symbols:**
- **File:** `deploy/07_dlend_static_wrappers/02_dstable_atoken_wrappers.ts:91-92`
  - Generated symbols: `"Static [aTokenSymbol]"`, `"stk[aTokenSymbol]"` (will update automatically when dUSD symbol changes)

**TypeScript Constants:**
- **File:** `typescript/token/utils.ts:9`
  - `DSTABLE_SYMBOLS = ["dUSD", "dS"]` → `DSTABLE_SYMBOLS = ["D"]` (also removing dS)

**Test Fixture Symbols:**
- **Files:** `test/dstable/fixtures.ts:20,89`, `test/dstake/fixture.ts:32,45,64`
  - Various `"dUSD"`, `"sdUSD"` → `"D"`, `"sD"`

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

## 4. dLOOP, dPOOL, dBOOST REMOVAL `#VAULT_SYSTEMS_REMOVAL`

### 🗑️ dLOOP (Leveraged Vault System) - REMOVE ENTIRELY

**Complete Directories to Delete:**
- **Directory:** `contracts/vaults/dloop/` (26 Solidity contracts)
  - **Action:** Delete entire directory
  - **Reason:** Core contracts, periphery contracts, Odos integration, design docs

- **Directory:** `deploy/12_dloop/` (6 deployment scripts)
  - **Action:** Delete entire directory  
  - **Reason:** Complete dLoop deployment infrastructure

- **Directory:** `test/dloop/` (25+ test files)
  - **Action:** Delete entire directory
  - **Reason:** Comprehensive test coverage for all dLoop functionality

- **Directory:** `scripts/dloop/` (5 shell scripts + README)
  - **Action:** Delete entire directory
  - **Reason:** Deployment automation scripts

**Configuration References to Remove:**
- **File:** `typescript/deploy-ids.ts:94-105`
  - **Remove:** All dLoop deployment ID constants (DLOOP_CORE_DLEND_ID, DLOOP_PERIPHERY_*, etc.)

- **File:** `config/types.ts:20-35`
  - **Remove:** Entire dLoop configuration interface

- **Files:** Network configs (sonic_mainnet.ts:169-210, sonic_testnet.ts:192-233, localhost.ts:427-470)
  - **Remove:** All dLoop configuration blocks including "3x_sFRAX_dUSD" vault configs

### 🗑️ dPOOL (Pool Vault System) - REMOVE ENTIRELY

**Complete Directories to Delete:**
- **Directory:** `contracts/vaults/dpool/` (4 contracts + docs)
  - **Action:** Delete entire directory
  - **Reason:** Core contracts, periphery, Curve integration

- **Directory:** `deploy/11_dpool/` (3 deployment scripts)
  - **Action:** Delete entire directory
  - **Reason:** Complete dPool deployment infrastructure

- **Directory:** `test/dpool/` (4 test files)
  - **Action:** Delete entire directory
  - **Reason:** Curve integration tests, event testing

**Individual Files to Delete:**
- **File:** `contracts/testing/DPoolVaultLPMock.sol`
  - **Action:** Delete file
  - **Reason:** dPool-specific mock contract

**Configuration References to Remove:**
- **File:** `config/types.ts:40-42,254-265`
  - **Remove:** dPool interface properties and DPoolInstanceConfig interface

- **Files:** Network configs (localhost.ts:556-578)
  - **Remove:** "dPOOL USDC/USDS" and "dPOOL frxUSD/USDC" vault configurations

### 🗑️ dBOOST (Vesting/Boost System) - REMOVE ENTIRELY

**Complete Directories to Delete:**
- **Directory:** `contracts/vaults/vesting/` (2 files)
  - **Action:** Delete entire directory
  - **Reason:** ERC20VestingNFT.sol contract and design documentation

- **Directory:** `deploy/10_vesting_dstake/` (1 deployment script)
  - **Action:** Delete entire directory
  - **Reason:** Vesting NFT deployment infrastructure

- **Directory:** `test/vesting/` (2 test files)
  - **Action:** Delete entire directory
  - **Reason:** Vesting NFT tests and metadata tests

**Configuration References to Remove:**
- **File:** `typescript/deploy-ids.ts:139-142`
  - **Remove:** ERC20_VESTING_NFT_ID and DSTAKE_NFT_VESTING_DEPLOYMENT_TAG constants

- **File:** `config/types.ts:39,242-250`
  - **Remove:** vesting interface property and VestingConfig interface

- **Files:** Network configs (sonic_mainnet.ts:425-433, sonic_testnet.ts:465-473, localhost.ts:546-555)
  - **Remove:** All "dBOOST sdUSD Season 1" and "sdUSD-S1" configurations

---

## 5. REPLACEMENT CHECKLIST

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

### Phase 5: Vault Systems Removal (dLOOP, dPOOL, dBOOST)
- [ ] Delete contracts/vaults/dloop/ directory entirely (26 contracts)
- [ ] Delete deploy/12_dloop/ directory entirely (6 scripts)
- [ ] Delete test/dloop/ directory entirely (25+ test files)
- [ ] Delete scripts/dloop/ directory entirely (5 shell scripts)
- [ ] Delete contracts/vaults/dpool/ directory entirely (4 contracts)
- [ ] Delete deploy/11_dpool/ directory entirely (3 scripts)
- [ ] Delete test/dpool/ directory entirely (4 test files)
- [ ] Delete contracts/vaults/vesting/ directory entirely (2 files)
- [ ] Delete deploy/10_vesting_dstake/ directory entirely (1 script)
- [ ] Delete test/vesting/ directory entirely (2 test files)
- [ ] Delete contracts/testing/DPoolVaultLPMock.sol file
- [ ] Remove dLoop/dPool/dBOOST deployment ID constants from typescript/deploy-ids.ts
- [ ] Remove dLoop/dPool/vesting interfaces from config/types.ts
- [ ] Clean dLoop/dPool/dBOOST references from network configuration files

### Phase 6: Infrastructure & Deployment
- [ ] Rename deployment artifact directories
- [ ] Update Docker image names
- [ ] Replace Slack integration environment variables
- [ ] Update shell script names and content
- [ ] Replace documentation references

---

## 6. REFERENCE MAPPING TABLE

| Category | Current Value | Replacement Needed |
|----------|---------------|-------------------|
| **Network Names** | sonic_testnet, sonic_mainnet | saga_testnet, saga_mainnet |
| **Chain ID** | 146 | 5464 |
| **RPC URLs** | https://rpc.soniclabs.com | https://sagaevm.jsonrpc.sagarpc.io/ |
| **Explorer API** | https://api.sonicscan.org | PLACEHOLDER_SAGA_EXPLORER_API_UNIQUE_002 |
| **Explorer URL** | https://sonicscan.org | PLACEHOLDER_SAGA_EXPLORER_URL_UNIQUE_003 |
| **USD Token Name** | "dTRINITY USD" | "Saga Dollar" |
| **USD Token Symbol** | "dUSD" | "D" |
| **Staked USD Symbol** | "sdUSD" | "sD" |
| **Boost Name** | "dBOOST" | **REMOVE ENTIRELY** |
| **Project Name** | "dTrinity" | "Colt" |
| **Subgraph URL** | graph-node-sonic.dtrinity.org | PLACEHOLDER_SAGA_SUBGRAPH_URL_UNIQUE_006 |

---

**⚠️ IMPORTANT NOTES:**
1. **Token symbols WILL be changed:** dUSD → D, sdUSD → sD
2. **Complete removal of:** dS stablecoin, dLOOP vaults, dPOOL vaults, dBOOST vesting
3. **Same RPC for both networks:** Saga has no testnet - staging uses mainnet with isolation
4. **dSTABLE infrastructure preserved** for future stablecoins (dEUR, dJPY, etc.)
5. **Unique placeholders created** for unknown values (easily searchable for later replacement)
6. Internal attribution comments should be kept for proper credit
7. Test localhost network behavior to ensure nothing breaks between changes

**📋 UNIQUE PLACEHOLDERS FOR UNKNOWN VALUES:**
- `PLACEHOLDER_SAGA_API_KEY_UNIQUE_001` - Explorer API key
- `PLACEHOLDER_SAGA_EXPLORER_API_UNIQUE_002` - Explorer API URL
- `PLACEHOLDER_SAGA_EXPLORER_URL_UNIQUE_003` - Explorer browser URL
- `PLACEHOLDER_SAGA_TESTNET_EXPLORER_API_UNIQUE_004` - Testnet explorer API  
- `PLACEHOLDER_SAGA_MAINNET_EXPLORER_API_UNIQUE_005` - Mainnet explorer API
- `PLACEHOLDER_SAGA_SUBGRAPH_URL_UNIQUE_006` - Subgraph URL

**🚀 Ready to execute replacements with provided values!**