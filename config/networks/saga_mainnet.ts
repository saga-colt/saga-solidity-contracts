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
  const usdtAddress = "0xC8fe3C1de344854f4429bB333AFFAeF97eF88CEa";
  const usdcAddress = "0xfc960C233B8E98e0Cf282e29BDE8d3f105fc24d5";
  const sagaAddress = "0xa19377761fed745723b90993988e04d641c2cffe";
  const sfrxUSDAddress = "0x1E81CF7FDD4c9149024454fCEc34a1A5D5431230";
  const usdnAddress = "0xE9A5C89eCff4323344cFaA4c659EFa42C80FE6cc";
  const yUSDAddress = "0x839e7e610108Cf3DCc9b40329db33b6E6bc9baCE";
  const vyUSDAddress = "0x704a58f888f18506C9Fc199e53AE220B5fdCaEd8";

  const governanceSafeMultisig = "0xf19cf8881237CA819Fd50C9C22cb258e9DB8644e"; // Safe on Saga

  // TODO: will be deployed in a later PR
  // Fetch deployed dLend StaticATokenLM wrapper, aToken and RewardsController (may be undefined prior to deployment)
  // const dLendATokenWrapperDDeployment = await _hre.deployments.getOrNull(
  //   "dLend_ATokenWrapper_D",
  // );
  // const rewardsControllerDeployment =
  //   await _hre.deployments.getOrNull(INCENTIVES_PROXY_ID);
  // const aTokenDDeployment = await _hre.deployments.getOrNull("dLEND-D");

  // Fetch d token decimals from the contract if deployed
  let dDecimals = 0;

  if (dDeployment?.address) {
    const dTokenInfo = await fetchTokenInfo(_hre, dDeployment.address);
    dDecimals = dTokenInfo.decimals;

    if (dDecimals < 1) {
      throw Error("D token decimals must be greater than 0");
    }
  }

  return {
    tokenAddresses: {
      D: emptyStringIfUndefined(dDeployment?.address),
      USDT: usdtAddress,
      USDC: usdcAddress,
      SAGA: sagaAddress,
      sfrxUSD: sfrxUSDAddress,
      USDN: usdnAddress,
      yUSD: yUSDAddress,
      vyUSD: vyUSDAddress,
    },
    uniswapRouter: "0x346239972d1fa486FC4a521031BC81bFB7D6e8a4", // Uniswap V3 SwapRouter
    walletAddresses: {
      governanceMultisig: governanceSafeMultisig, // Created via Safe
      incentivesVault: "0x9CD17eA5Cf04BEEAa2C65d58F4478c7A230eD816", // Safe on Saga
    },
    safeConfig: {
      safeAddress: governanceSafeMultisig,
      chainId: 5464, // Saga mainnet chain ID
      txServiceUrl: "https://transaction.safe.saga.xyz/api", // Saga Safe transaction service
    },
    dStables: {
      D: {
        collaterals: [usdcAddress, usdtAddress, usdnAddress, yUSDAddress, vyUSDAddress],
        initialFeeReceiver: governanceSafeMultisig, // governanceMultisig
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins by default already: 0.4%
          // Future yield bearing stablecoins should be 0.5%
          [yUSDAddress]: 0.5 * ONE_PERCENT_BPS,
          [vyUSDAddress]: 0.5 * ONE_PERCENT_BPS,
        },
      },
    },
    oracleAggregators: {
      USD: {
        baseCurrency: ZeroAddress, // Note that USD is represented by the zero address, per Aave's convention
        hardDStablePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        tellorOracleAssets: {
          plainTellorOracleWrappers: {
            [yUSDAddress]: "0xc6a0F156f1c6905661d69F437e1ba753C4145528", // yUSD/USD Tellor price feed (plain wrapper)
            [vyUSDAddress]: "0x6926a216A7C284c87f56423E776CF8ea51625811", // vyUSD/USD Tellor price feed (plain wrapper)
          },
          tellorOracleWrappersWithThresholding: {
            [usdcAddress]: {
              feed: "0x4bAF1D89679A31DE142D4855BE01cb9c9D1158A4", // USDC/USD Tellor price feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [usdtAddress]: {
              feed: "0x5bca2d1C43328568169258D608e66D2A9bF0BB1D", // USDT/USD Tellor price feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [sagaAddress]: {
              feed: "0x96e6662856D9B6cdaAd4876f39989CC538Faa0B1", // Saga/USD Tellor price feed
              lowerThreshold: 0n,
              fixedPrice: 0n,
            },
            // [sfrxUSDAddress]: {
            //   feed: "0x40EA5EE6f4acB6DccDC940E2835a50C8E57574e2", // sfrxUSD/USD Tellor price feed
            //   lowerThreshold: 0n,
            //   fixedPrice: 0n,
            // }, // Currently delisted, still keeping in config since we will re-add it later
            [usdnAddress]: {
              feed: "0xF1518c56916EAFc80FDe8CB142eA785B7850e580", // USDN/USD Tellor price feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
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
        SAGA: strategySAGA,
      },
    },
    dStake: {
      // TODO: will be deployed in a later PR
      // stkD: {
      //   dStable: emptyStringIfUndefined(dDeployment?.address),
      //   name: "Staked Saga Dollar",
      //   symbol: "stkD",
      //   initialAdmin: governanceSafeMultisig,
      //   initialFeeManager: governanceSafeMultisig,
      //   initialWithdrawalFeeBps: 0.1 * ONE_PERCENT_BPS, // 0.1%
      //   adapters: [
      //     {
      //       vaultAsset: emptyStringIfUndefined(
      //         dLendATokenWrapperDDeployment?.address,
      //       ),
      //       adapterContract: "WrappedDLendConversionAdapter",
      //     },
      //   ],
      //   defaultDepositVaultAsset: emptyStringIfUndefined(
      //     dLendATokenWrapperDDeployment?.address,
      //   ),
      //   collateralVault: "DStakeCollateralVault_stkD", // Keep in sync with deploy ID constants
      //   collateralExchangers: [governanceSafeMultisig],
      //   dLendRewardManager: {
      //     managedVaultAsset: emptyStringIfUndefined(
      //       dLendATokenWrapperDDeployment?.address,
      //     ), // StaticATokenLM wrapper
      //     dLendAssetToClaimFor: emptyStringIfUndefined(
      //       aTokenDDeployment?.address,
      //     ), // dLEND aToken for D
      //     dLendRewardsController: emptyStringIfUndefined(
      //       rewardsControllerDeployment?.address,
      //     ), // RewardsController proxy
      //     treasury: governanceSafeMultisig,
      //     maxTreasuryFeeBps: 5 * ONE_PERCENT_BPS, // 5%
      //     initialTreasuryFeeBps: 1 * ONE_PERCENT_BPS, // 1%
      //     initialExchangeThreshold: 1n * 10n ** BigInt(dDecimals), // TODO: 1 dStable token (fetched from contract decimals), for QA ONLY
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
