import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_TELLOR_ORACLE_WRAPPER_ID,
  USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

// Helper function to perform sanity checks on oracle wrappers
/**
 * Performs sanity checks on oracle wrapper feeds by verifying normalized prices are within a reasonable range.
 *
 * @param wrapper The oracle wrapper contract instance.
 * @param feeds A record mapping asset addresses to feed configurations.
 * @param baseCurrencyUnit The base currency unit for price calculations.
 * @param wrapperName The name of the wrapper for logging purposes.
 */
async function performOracleSanityChecks(
  wrapper: any,
  feeds: Record<string, any>,
  baseCurrencyUnit: bigint,
  wrapperName: string,
): Promise<void> {
  for (const [assetAddress] of Object.entries(feeds)) {
    try {
      const price = await wrapper.getAssetPrice(assetAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < 0.01 || normalizedPrice > 1e6) {
        console.error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.9, 2]`,
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.9, 2]`,
        );
      } else {
        console.log(
          `Sanity check passed for asset ${assetAddress} in ${wrapperName}: Normalized price is ${normalizedPrice}`,
        );
      }
    } catch (error) {
      console.error(
        `Error performing sanity check for asset ${assetAddress} in ${wrapperName}:`,
        error,
      );
      throw new Error(
        `Error performing sanity check for asset ${assetAddress} in ${wrapperName}: ${error}`,
      );
    }
  }
}

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);
  const baseCurrencyUnit =
    BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);
  const baseCurrency = config.oracleAggregators.USD.baseCurrency;

  // Deploy TellorWrapper for plain oracle feeds
  const tellorWrapperDeployment = await hre.deployments.deploy(
    USD_TELLOR_ORACLE_WRAPPER_ID,
    {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "TellorWrapper",
      autoMine: true,
      log: false,
    },
  );

  const tellorWrapper = await hre.ethers.getContractAt(
    "TellorWrapper",
    tellorWrapperDeployment.address,
  );

  // Set feeds for plain oracle feeds
  const plainFeeds =
    config.oracleAggregators.USD.tellorOracleAssets
      ?.plainTellorOracleWrappers || {};

  for (const [assetAddress, feed] of Object.entries(plainFeeds)) {
    if (!assetAddress || !/^0x[0-9a-fA-F]{40}$/.test(assetAddress)) {
      console.error(
        `[oracle-setup] Invalid or missing assetAddress in plainFeeds: '${assetAddress}'`,
      );
      throw new Error(
        `[oracle-setup] Invalid or missing assetAddress in plainFeeds: '${assetAddress}'`,
      );
    }

    if (!feed || !/^0x[0-9a-fA-F]{40}$/.test(feed)) {
      console.error(
        `[oracle-setup] Invalid or missing feed address in plainFeeds for asset ${assetAddress}: '${feed}'`,
      );
      throw new Error(
        `[oracle-setup] Invalid or missing feed address in plainFeeds for asset ${assetAddress}: '${feed}'`,
      );
    }
    await tellorWrapper.setFeed(assetAddress, feed);
    console.log(`Set plain Tellor feed for asset ${assetAddress} to ${feed}`);
  }

  // Sanity check for plain Tellor feeds
  await performOracleSanityChecks(
    tellorWrapper,
    plainFeeds,
    baseCurrencyUnit,
    "plain Tellor feeds",
  );

  // Deploy TellorWrapperWithThresholding for feeds with thresholding
  const thresholdFeeds =
    config.oracleAggregators.USD.tellorOracleAssets
      ?.tellorOracleWrappersWithThresholding || {};

  const tellorWrapperWithThresholdingDeployment = await hre.deployments.deploy(
    USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
    {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "TellorWrapperWithThresholding",
      autoMine: true,
      log: false,
    },
  );

  const tellorWrapperWithThresholding = await hre.ethers.getContractAt(
    "TellorWrapperWithThresholding",
    tellorWrapperWithThresholdingDeployment.address,
  );

  // Set feeds and thresholds for feeds with thresholding
  for (const [assetAddress, feedConfig] of Object.entries(thresholdFeeds)) {
    if (!assetAddress || !/^0x[0-9a-fA-F]{40}$/.test(assetAddress)) {
      console.error(
        `[oracle-setup] Invalid or missing assetAddress in thresholdFeeds: '${assetAddress}'`,
      );
      throw new Error(
        `[oracle-setup] Invalid or missing assetAddress in thresholdFeeds: '${assetAddress}'`,
      );
    }

    if (!feedConfig.feed || !/^0x[0-9a-fA-F]{40}$/.test(feedConfig.feed)) {
      console.error(
        `[oracle-setup] Invalid or missing feed address in thresholdFeeds for asset ${assetAddress}: '${feedConfig.feed}'`,
      );
      throw new Error(
        `[oracle-setup] Invalid or missing feed address in thresholdFeeds for asset ${assetAddress}: '${feedConfig.feed}'`,
      );
    }
    await tellorWrapperWithThresholding.setFeed(assetAddress, feedConfig.feed);
    await tellorWrapperWithThresholding.setThresholdConfig(
      assetAddress,
      feedConfig.lowerThreshold,
      feedConfig.fixedPrice,
    );
    console.log(`Set Tellor feed with thresholding for asset ${assetAddress}`);
  }

  // Sanity check for Tellor feeds with thresholding
  await performOracleSanityChecks(
    tellorWrapperWithThresholding,
    thresholdFeeds,
    baseCurrencyUnit,
    "Tellor feeds with thresholding",
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = [
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-tellor-oracle-wrapper",
];
func.dependencies = [];
func.id = "setup-usd-tellor-oracle-wrappers";

export default func;
