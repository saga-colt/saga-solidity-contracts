import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { D_TOKEN_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT, ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { fetchTokenInfo } from "../../typescript/token/utils";
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

  const governanceSafeMultisig = "0xf19cf8881237CA819Fd50C9C22cb258e9DB8644e"; // Safe on Saga

  // TODO: will be deployed in a later PR
  // // Fetch deployed dLend StaticATokenLM wrapper, aToken and RewardsController (may be undefined prior to deployment)
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
    },
    walletAddresses: {
      governanceMultisig: governanceSafeMultisig, // Created via Safe
      incentivesVault: "0x9CD17eA5Cf04BEEAa2C65d58F4478c7A230eD816", // Safe on Saga
    },
    dStables: {
      D: {
        collaterals: [usdcAddress, usdtAddress],
        initialFeeReceiver: governanceSafeMultisig, // governanceMultisig
        initialRedemptionFeeBps: 0.4 * ONE_PERCENT_BPS, // Default for stablecoins
        collateralRedemptionFees: {
          // Stablecoins by default already: 0.4%
          // Future yield bearing stablecoins should be 0.5%
        },
      },
    },
    oracleAggregators: {
      USD: {
        baseCurrency: ZeroAddress, // Note that USD is represented by the zero address, per Aave's convention
        hardDStablePeg: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
        priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
        tellorOracleAssets: {
          plainTellorOracleWrappers: {},
          tellorOracleWrappersWithThresholding: {
            [usdcAddress]: {
              feed: "0x6c85266a8D3Ce564058667dc5c7E9d58da454ecc", // USDC/USD Tellor price feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
            [usdtAddress]: {
              feed: "0x62E537964E2452aD6F08976dA251C4B33c04B96C", // USDT/USD Tellor price feed
              lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
              fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
            },
          },
        },
      },
    },
    // TODO: will be deployed in a later PR
    // dLend: {
    // providerID: 1, // Arbitrary as long as we don't repeat
    // flashLoanPremium: {
    //   total: 0.0005e4, // 0.05%
    //   protocol: 0.0004e4, // 0.04%
    // },
    // rateStrategies: [
    //   rateStrategyHighLiquidityVolatile,
    //   rateStrategyMediumLiquidityVolatile,
    //   rateStrategyHighLiquidityStable,
    //   rateStrategyMediumLiquidityStable,
    // ],
    // reservesConfig: {
    //   D: strategyD,
    // },
    // },
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
