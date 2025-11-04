import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { D_A_TOKEN_WRAPPER_ID, D_TOKEN_ID, INCENTIVES_PROXY_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import { strategyD, strategySfrxUSD, strategyStS, strategyWstkscUSD } from "../dlend/reserves-params";
import { Config } from "../types";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(_hre: HardhatRuntimeEnvironment): Promise<Config> {
  // Token info will only be populated after their deployment
  const dDeployment = await _hre.deployments.getOrNull(D_TOKEN_ID);
  const USDCDeployment = await _hre.deployments.getOrNull("USDC");
  const USDSDeployment = await _hre.deployments.getOrNull("USDS");
  const sUSDSDeployment = await _hre.deployments.getOrNull("sUSDS");
  const frxUSDDeployment = await _hre.deployments.getOrNull("frxUSD");
  const sfrxUSDDeployment = await _hre.deployments.getOrNull("sfrxUSD");
  const WSAGADeployment = await _hre.deployments.getOrNull("WSAGA");

  // Fetch deployed dLend StaticATokenLM wrapper (optional, may be undefined on testnet)
  const dLendATokenWrapperDDeployment = await _hre.deployments.getOrNull(D_A_TOKEN_WRAPPER_ID);

  // Fetch deployed dLend RewardsController (optional)
  const rewardsControllerDeployment = await _hre.deployments.getOrNull(INCENTIVES_PROXY_ID);

  // Fetch deployed dLend aToken for dUSD (optional)
  const aTokenDUSDDeployment = await _hre.deployments.getOrNull("dLEND-D");

  // Get mock oracle deployments
  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleAddressesDeployment = await _hre.deployments.getOrNull("MockOracleNameToAddress");

  if (mockOracleAddressesDeployment?.linkedData) {
    Object.assign(mockOracleNameToAddress, mockOracleAddressesDeployment.linkedData);
  } else {
    console.warn("WARN: MockOracleNameToAddress deployment not found or has no linkedData. Oracle configuration might be incomplete.");
  }

  const { deployer } = await _hre.getNamedAccounts();

  return {
    MOCK_ONLY: {
      tokens: {
        WSAGA: {
          name: "Wrapped Saga",
          address: WSAGADeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        USDC: {
          name: "USD Coin",
          address: USDCDeployment?.address,
          decimals: 6,
          initialSupply: 1e6,
        },
        USDS: {
          name: "USDS Stablecoin",
          address: USDSDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        sUSDS: {
          name: "Savings USDS",
          address: sUSDSDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        frxUSD: {
          name: "Frax USD",
          address: frxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        sfrxUSD: {
          name: "Staked Frax USD",
          address: sfrxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
      },
    },
    tokenAddresses: {
      WSAGA: emptyStringIfUndefined(WSAGADeployment?.address), // Used by dLEND
      D: emptyStringIfUndefined(dDeployment?.address),
      sfrxUSD: emptyStringIfUndefined(sfrxUSDDeployment?.address), // Used by dLEND
      USDC: emptyStringIfUndefined(USDCDeployment?.address),
      USDS: emptyStringIfUndefined(USDSDeployment?.address),
      frxUSD: emptyStringIfUndefined(frxUSDDeployment?.address),
    },
    uniswapRouter: "0x346239972d1fa486FC4a521031BC81bFB7D6e8a4", // Uniswap V3 SwapRouter (same on testnet)
    walletAddresses: {
      governanceMultisig: "0xd2f775Ff2cD41bfe43C7A8c016eD10393553fe44", // Actually just the testnet deployer address
      incentivesVault: "0xd2f775Ff2cD41bfe43C7A8c016eD10393553fe44", // Actually just the testnet deployer address
    },
    dStables: {
      D: {
        collaterals: [
          USDCDeployment?.address || ZeroAddress,
          USDSDeployment?.address || ZeroAddress,
          sUSDSDeployment?.address || ZeroAddress,
          frxUSDDeployment?.address || ZeroAddress,
          sfrxUSDDeployment?.address || ZeroAddress,
        ],
        initialFeeReceiver: deployer,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins: 0.4%
          [USDCDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          [USDSDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          [frxUSDDeployment?.address || ZeroAddress]: 0.4 * ONE_PERCENT_BPS,
          // Yield bearing stablecoins: 0.5%
          [sUSDSDeployment?.address || ZeroAddress]: 0.5 * ONE_PERCENT_BPS,
          [sfrxUSDDeployment?.address || ZeroAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
    },
    oracleAggregators: {
      USD: {
        hardDStablePeg: 1n * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        baseCurrency: ZeroAddress, // Note that USD is represented by the zero address, per Aave's convention
        tellorOracleAssets: {
          plainTellorOracleWrappers: {},
          tellorOracleWrappersWithThresholding: {},
        },
        redstoneOracleAssets: {
          // Moved from API3
          plainRedstoneOracleWrappers: {
            [WSAGADeployment?.address || ""]: mockOracleNameToAddress["WSAGA_USD"],
          },
          // Moved from API3
          redstoneOracleWrappersWithThresholding: {
            ...(USDCDeployment?.address && mockOracleNameToAddress["USDC_USD"]
              ? {
                [USDCDeployment.address]: {
                  feed: mockOracleNameToAddress["USDC_USD"], // Changed from proxy
                  lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                },
              }
              : {}),
            ...(USDSDeployment?.address && mockOracleNameToAddress["USDS_USD"]
              ? {
                [USDSDeployment.address]: {
                  feed: mockOracleNameToAddress["USDS_USD"], // Changed from proxy
                  lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                },
              }
              : {}),
            ...(frxUSDDeployment?.address && mockOracleNameToAddress["frxUSD_USD"]
              ? {
                [frxUSDDeployment.address]: {
                  feed: mockOracleNameToAddress["frxUSD_USD"], // Changed from proxy
                  lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                },
              }
              : {}),
          },
          // Moved from API3
          compositeRedstoneOracleWrappersWithThresholding: {
            // sUSDS composite feed (sUSDS/USDS * USDS/USD)
            ...(sUSDSDeployment?.address && mockOracleNameToAddress["sUSDS_USDS"] && mockOracleNameToAddress["USDS_USD"]
              ? {
                [sUSDSDeployment.address]: {
                  feedAsset: sUSDSDeployment.address,
                  feed1: mockOracleNameToAddress["sUSDS_USDS"], // Changed from proxy1
                  feed2: mockOracleNameToAddress["USDS_USD"], // Changed from proxy2
                  lowerThresholdInBase1: 0n, // No threshold for sUSDS/USDS
                  fixedPriceInBase1: 0n,
                  lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Threshold for USDS/USD
                  fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                },
              }
              : {}),
            // sfrxUSD composite feed (sfrxUSD/frxUSD * frxUSD/USD)
            ...(sfrxUSDDeployment?.address && mockOracleNameToAddress["sfrxUSD_frxUSD"] && mockOracleNameToAddress["frxUSD_USD"]
              ? {
                [sfrxUSDDeployment.address]: {
                  feedAsset: sfrxUSDDeployment.address,
                  feed1: mockOracleNameToAddress["sfrxUSD_frxUSD"], // Changed from proxy1
                  feed2: mockOracleNameToAddress["frxUSD_USD"], // Changed from proxy2
                  lowerThresholdInBase1: 0n, // No threshold for sfrxUSD/frxUSD
                  fixedPriceInBase1: 0n,
                  lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, // Threshold for frxUSD/USD
                  fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                },
              }
              : {}),
          },
        },
      },
    },
    dLend: {
      providerID: 1, // Arbitrary as long as we don't repeat
      flashLoanPremium: {
        total: 0.0005e4, // 0.05%
        protocol: 0.0004e4, // 0.04%
      },
      rateStrategies: [
        rateStrategyHighLiquidityVolatile,
        rateStrategyMediumLiquidityVolatile,
        rateStrategyHighLiquidityStable,
        rateStrategyMediumLiquidityStable,
      ],
      reservesConfig: {
        D: strategyD,
        stS: strategyStS,
        sfrxUSD: strategySfrxUSD,
        wstkscUSD: strategyWstkscUSD,
      },
    },
    dStake: {
      stkD: {
        dStable: emptyStringIfUndefined(dDeployment?.address),
        name: "Staked Saga Dollar",
        symbol: "stkD",
        initialAdmin: deployer,
        initialFeeManager: deployer,
        initialWithdrawalFeeBps: 0.1 * ONE_PERCENT_BPS, // 0.1%
        adapters: [
          {
            vaultAsset: emptyStringIfUndefined(dLendATokenWrapperDDeployment?.address),
            adapterContract: "WrappedDLendConversionAdapter",
          },
        ],
        defaultDepositVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDDeployment?.address),
        collateralVault: "DStakeCollateralVault_sdUSD",
        collateralExchangers: [deployer],
        dLendRewardManager: {
          managedVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDDeployment?.address), // This should be the deployed StaticATokenLM address for dUSD
          dLendAssetToClaimFor: emptyStringIfUndefined(aTokenDUSDDeployment?.address), // Use the deployed dLEND-D aToken address
          dLendRewardsController: emptyStringIfUndefined(rewardsControllerDeployment?.address), // This will be fetched after dLend incentives deployment
          treasury: deployer, // Or a dedicated treasury address
          maxTreasuryFeeBps: 5 * ONE_PERCENT_BPS, // Example: 5%
          initialTreasuryFeeBps: 1 * ONE_PERCENT_BPS, // Example: 1%
          initialExchangeThreshold: 1000n * 10n ** 18n, // 1000 dStable
          initialAdmin: deployer, // Optional: specific admin for this reward manager
          initialRewardsManager: deployer, // Optional: specific rewards manager role holder
        },
      },
    },
  };
}

/**
 * Return an empty string if the value is undefined
 *
 * @param value - The value to check
 * @returns An empty string if the value is undefined, otherwise the value itself
 */
function emptyStringIfUndefined(value: string | undefined): string {
  return value || "";
}
