import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { D_TOKEN_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { fetchTokenInfo } from "../../typescript/token/utils";
import {
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "../dlend/interest-rate-strategies";
import { strategyD, strategySAGA } from "../dlend/reserves-params";
import { Config } from "../types";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(_hre: HardhatRuntimeEnvironment): Promise<Config> {
  const dDeployment = await _hre.deployments.getOrNull(D_TOKEN_ID);
  const USDCDeployment = await _hre.deployments.getOrNull("USDC");
  const USDTDeployment = await _hre.deployments.getOrNull("USDT");
  const SAGADeployment = await _hre.deployments.getOrNull("SAGA");
  const sfrxUSDDeployment = await _hre.deployments.getOrNull("sfrxUSD");
  const USDNDeployment = await _hre.deployments.getOrNull("USDN");
  const yUSDDeployment = await _hre.deployments.getOrNull("yUSD");
  const vyUSDDeployment = await _hre.deployments.getOrNull("vyUSD");

  const governanceSafeMultisig = "0xd2f775Ff2cD41bfe43C7A8c016eD10393553fe44"; // Testnet deployer
  const incentivesVault = "0xd2f775Ff2cD41bfe43C7A8c016eD10393553fe44"; // Testnet deployer
  const uniswapRouter = "0x346239972d1fa486FC4a521031BC81bFB7D6e8a4"; // Uniswap V3 SwapRouter (same as mainnet)

  // TODO: wire up once staking is redeployed on testnet
  // const dLendATokenWrapperDDeployment = await _hre.deployments.getOrNull(
  //   "dLend_ATokenWrapper_D",
  // );
  // const rewardsControllerDeployment =
  //   await _hre.deployments.getOrNull("IncentivesProxy");
  // const aTokenDDeployment = await _hre.deployments.getOrNull("dLEND-D");

  // Get mock oracle deployments so we can plug them into Tellor-style config
  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleAddressesDeployment = await _hre.deployments.getOrNull("MockOracleNameToAddress");

  if (mockOracleAddressesDeployment?.linkedData) {
    Object.assign(mockOracleNameToAddress, mockOracleAddressesDeployment.linkedData);
  } else {
    console.warn("WARN: MockOracleNameToAddress deployment not found or has no linkedData. Oracle configuration might be incomplete.");
  }

  // Fetch d token decimals from the contract when deployed so we can reuse them for future staking config
  let dDecimals = 0;

  if (dDeployment?.address) {
    const dTokenInfo = await fetchTokenInfo(_hre, dDeployment.address);
    dDecimals = dTokenInfo.decimals;

    if (dDecimals < 1) {
      throw Error("D token decimals must be greater than 0");
    }
  }

  const usdcAddress = USDCDeployment?.address || ZeroAddress;
  const usdtAddress = USDTDeployment?.address || ZeroAddress;
  const sagaAddress = SAGADeployment?.address || ZeroAddress;
  const sfrxUSDAddress = sfrxUSDDeployment?.address || ZeroAddress;
  const usdnAddress = USDNDeployment?.address || ZeroAddress;
  const yUSDAddress = yUSDDeployment?.address || ZeroAddress;
  const vyUSDAddress = vyUSDDeployment?.address || ZeroAddress;

  return {
    MOCK_ONLY: {
      tokens: {
        USDC: {
          name: "USD Coin",
          address: USDCDeployment?.address,
          decimals: 6,
          initialSupply: 1e6,
        },
        USDT: {
          name: "Tether USD",
          address: USDTDeployment?.address,
          decimals: 6,
          initialSupply: 1e6,
        },
        USDN: {
          name: "USD Note",
          address: USDNDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        yUSD: {
          name: "Yield USD",
          address: yUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        vyUSD: {
          name: "Vaulted Yield USD",
          address: vyUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        SAGA: {
          name: "Saga Token",
          address: SAGADeployment?.address,
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
      D: emptyStringIfUndefined(dDeployment?.address),
      USDC: emptyStringIfUndefined(usdcAddress),
      USDT: emptyStringIfUndefined(usdtAddress),
      SAGA: emptyStringIfUndefined(sagaAddress),
      sfrxUSD: emptyStringIfUndefined(sfrxUSDAddress),
      USDN: emptyStringIfUndefined(usdnAddress),
      yUSD: emptyStringIfUndefined(yUSDAddress),
      vyUSD: emptyStringIfUndefined(vyUSDAddress),
    },
    uniswapRouter,
    walletAddresses: {
      governanceMultisig: governanceSafeMultisig,
      incentivesVault,
    },
    safeConfig: {
      safeAddress: governanceSafeMultisig,
      chainId: 5464, // Update when a dedicated Saga testnet Safe service is available
      txServiceUrl: "https://transaction.safe.saga.xyz/api",
    },
    dStables: {
      D: {
        collaterals: [usdcAddress, usdtAddress, usdnAddress, yUSDAddress, vyUSDAddress],
        initialFeeReceiver: governanceSafeMultisig,
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS,
        collateralRedemptionFees: {
          [yUSDAddress]: 0.5 * ONE_PERCENT_BPS,
          [vyUSDAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
    },
    oracleAggregators: {
      USD: {
        baseCurrency: ZeroAddress, // USD is represented by the zero address per Aave's convention
        hardDStablePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        tellorOracleAssets: {
          plainTellorOracleWrappers: {
            ...(yUSDDeployment?.address && mockOracleNameToAddress["yUSD_USD"]
              ? {
                [yUSDDeployment.address]: mockOracleNameToAddress["yUSD_USD"],
              }
              : {}),
            ...(vyUSDDeployment?.address && mockOracleNameToAddress["vyUSD_USD"]
              ? {
                [vyUSDDeployment.address]: mockOracleNameToAddress["vyUSD_USD"],
              }
              : {}),
            ...(sfrxUSDDeployment?.address && mockOracleNameToAddress["sfrxUSD_USD"]
              ? {
                [sfrxUSDDeployment.address]: mockOracleNameToAddress["sfrxUSD_USD"],
              }
              : {}),
          },
          tellorOracleWrappersWithThresholding: {
            ...(USDCDeployment?.address && mockOracleNameToAddress["USDC_USD"]
              ? {
                [USDCDeployment.address]: {
                  feed: mockOracleNameToAddress["USDC_USD"],
                  lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                },
              }
              : {}),
            ...(USDTDeployment?.address && mockOracleNameToAddress["USDT_USD"]
              ? {
                [USDTDeployment.address]: {
                  feed: mockOracleNameToAddress["USDT_USD"],
                  lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                },
              }
              : {}),
            ...(SAGADeployment?.address && mockOracleNameToAddress["SAGA_USD"]
              ? {
                [SAGADeployment.address]: {
                  feed: mockOracleNameToAddress["SAGA_USD"],
                  lowerThreshold: 0n,
                  fixedPrice: 0n,
                },
              }
              : {}),
            ...(USDNDeployment?.address && mockOracleNameToAddress["USDN_USD"]
              ? {
                [USDNDeployment.address]: {
                  feed: mockOracleNameToAddress["USDN_USD"],
                  lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                  fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
                },
              }
              : {}),
          },
        },
      },
    },
    dLend: {
      providerID: 1,
      flashLoanPremium: {
        total: 0.0005e4,
        protocol: 0.0004e4,
      },
      rateStrategies: [
        rateStrategyHighLiquidityVolatile,
        rateStrategyMediumLiquidityVolatile,
        rateStrategyHighLiquidityStable,
        rateStrategyMediumLiquidityStable,
      ],
      reservesConfig: {
        D: strategyD,
        SAGA: strategySAGA,
      },
    },
    dStake: {
      // TODO: Enable once the staking stack is redeployed on testnet
      // stkD: {
      //   dStable: emptyStringIfUndefined(dDeployment?.address),
      //   name: "Staked Saga Dollar",
      //   symbol: "stkD",
      //   initialAdmin: governanceSafeMultisig,
      //   initialFeeManager: governanceSafeMultisig,
      //   initialWithdrawalFeeBps: 0.1 * ONE_PERCENT_BPS,
      //   adapters: [
      //     {
      //       vaultAsset: emptyStringIfUndefined(dLendATokenWrapperDDeployment?.address),
      //       adapterContract: "WrappedDLendConversionAdapter",
      //     },
      //   ],
      //   defaultDepositVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDDeployment?.address),
      //   collateralVault: "DStakeCollateralVault_stkD",
      //   collateralExchangers: [governanceSafeMultisig],
      //   dLendRewardManager: {
      //     managedVaultAsset: emptyStringIfUndefined(dLendATokenWrapperDDeployment?.address),
      //     dLendAssetToClaimFor: emptyStringIfUndefined(aTokenDDeployment?.address),
      //     dLendRewardsController: emptyStringIfUndefined(rewardsControllerDeployment?.address),
      //     treasury: governanceSafeMultisig,
      //     maxTreasuryFeeBps: 5 * ONE_PERCENT_BPS,
      //     initialTreasuryFeeBps: 1 * ONE_PERCENT_BPS,
      //     initialExchangeThreshold: 1n * 10n ** BigInt(dDecimals),
      //   },
      // },
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
