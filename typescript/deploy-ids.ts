// USD Oracles
export const USD_ORACLE_AGGREGATOR_ID = "USD_OracleAggregator";
export const USD_TELLOR_ORACLE_WRAPPER_ID = "USD_TellorWrapper";
export const USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID = "USD_TellorWrapperWithThresholding";

// Legacy Redstone IDs (deprecated, use Tellor instead)
export const USD_REDSTONE_ORACLE_WRAPPER_ID = "USD_RedstoneChainlinkWrapper";
export const USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID = "USD_RedstoneChainlinkWrapperWithThresholding";
export const USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID = "USD_RedstoneChainlinkCompositeWrapperWithThresholding";

// D
export const D_TOKEN_ID = "D";
export const D_ISSUER_CONTRACT_ID = "D_Issuer";
export const D_REDEEMER_CONTRACT_ID = "D_Redeemer";
export const D_COLLATERAL_VAULT_CONTRACT_ID = "D_CollateralHolderVault";
export const D_AMO_MANAGER_ID = "D_AmoManager";
export const D_HARD_PEG_ORACLE_WRAPPER_ID = "D_HardPegOracleWrapper";

// dLEND
export const TREASURY_PROXY_ID = "TreasuryProxy";
export const TREASURY_CONTROLLER_ID = "TreasuryController";
export const TREASURY_IMPL_ID = "TreasuryImpl";
export const POOL_ADDRESSES_PROVIDER_ID = "PoolAddressesProvider";
export const POOL_DATA_PROVIDER_ID = "PoolDataProvider";
export const POOL_IMPL_ID = "PoolImpl";
export const POOL_CONFIGURATOR_ID = "PoolConfigurator";
export const ACL_MANAGER_ID = "ACLManager";
export const PRICE_ORACLE_ID = "PriceOracle";
export const PRICE_ORACLE_SENTINEL_ID = "PriceOracleSentinel";
export const ATOKEN_IMPL_ID = "ATokenImpl";
export const VARIABLE_DEBT_TOKEN_IMPL_ID = "VariableDebtTokenImpl";
export const STABLE_DEBT_TOKEN_IMPL_ID = "StableDebtTokenImpl";
export const RATE_STRATEGY_ID = "RateStrategy";
export const POOL_PROXY_ID = "PoolProxy";
export const POOL_CONFIGURATOR_PROXY_ID = "PoolConfiguratorProxy";
export const POOL_ADDRESS_PROVIDER_REGISTRY_ID = "PoolAddressesProviderRegistry";
export const SUPPLY_LOGIC_ID = "SupplyLogic";
export const BORROW_LOGIC_ID = "BorrowLogic";
export const LIQUIDATION_LOGIC_ID = "LiquidationLogic";
export const EMODE_LOGIC_ID = "EModeLogic";
export const BRIDGE_LOGIC_ID = "BridgeLogic";
export const CONFIGURATOR_LOGIC_ID = "ConfiguratorLogic";
export const FLASH_LOAN_LOGIC_ID = "FlashLoanLogic";
export const POOL_LOGIC_ID = "PoolLogic";
export const CALLDATA_LOGIC_ID = "CalldataLogic";
export const RESERVES_SETUP_HELPER_ID = "ReservesSetupHelper";
export const WALLET_BALANCE_PROVIDER_ID = "WalletBalanceProvider";
export const UI_INCENTIVE_DATA_PROVIDER_ID = "UiIncentiveDataProviderV3";
export const UI_POOL_DATA_PROVIDER_ID = "UiPoolDataProviderV3";
export const EMISSION_MANAGER_ID = "EmissionManager";
export const INCENTIVES_IMPL_ID = "RewardsController";
export const INCENTIVES_PROXY_ID = "IncentivesProxy";
export const PULL_REWARDS_TRANSFER_STRATEGY_ID = "PullRewardsTransferStrategy";
export const ORACLE_AGGREGATOR_WRAPPER_BASE_ID = "oracle-aggregator-wrapper-base";

// Wrapped dLEND ATokens
export const DLEND_STATIC_A_TOKEN_FACTORY_ID = "Palomino_StaticATokenFactory";
export const DLEND_A_TOKEN_WRAPPER_PREFIX = "Palomino_ATokenWrapper";
export const D_A_TOKEN_WRAPPER_ID = `${DLEND_A_TOKEN_WRAPPER_PREFIX}_D`;

// dSTAKE deployment tag
export const DSTAKE_DEPLOYMENT_TAG = "dStake"; // Define the deployment tag

// dSTAKE deploy ID prefixes
export const DSTAKE_TOKEN_ID_PREFIX = "DStakeToken";
export const DSTAKE_COLLATERAL_VAULT_ID_PREFIX = "DStakeCollateralVault";
export const DSTAKE_ROUTER_ID_PREFIX = "DStakeRouter";

// dSTAKE specific instance IDs
export const STKD_DSTAKE_TOKEN_ID = `${DSTAKE_TOKEN_ID_PREFIX}_stkD`;
export const STKD_COLLATERAL_VAULT_ID = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_stkD`;
export const STKD_ROUTER_ID = `${DSTAKE_ROUTER_ID_PREFIX}_stkD`;

// RedeemerWithFees
export const D_REDEEMER_WITH_FEES_CONTRACT_ID = "D_RedeemerWithFees";

// SMO Helper
export const D_SMO_HELPER_ID = "D_SmoHelper";

// Uniswap V3 Swap Adapters
export const UNISWAP_V3_LIQUIDITY_SWAP_ADAPTER_ID = "UniswapV3LiquiditySwapAdapter";
export const UNISWAP_V3_DEBT_SWAP_ADAPTER_ID = "UniswapV3DebtSwapAdapter";
export const UNISWAP_V3_REPAY_ADAPTER_ID = "UniswapV3RepayAdapter";
export const UNISWAP_V3_WITHDRAW_SWAP_ADAPTER_ID = "UniswapV3WithdrawSwapAdapter";
