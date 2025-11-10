import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_TELLOR_COMPOSITE_WRAPPER_ID,
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
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.01, 1e6]`,
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.01, 1e6]`,
        );
      } else {
        console.log(`Sanity check passed for asset ${assetAddress} in ${wrapperName}: Normalized price is ${normalizedPrice}`);
      }
    } catch (error) {
      console.error(`Error performing sanity check for asset ${assetAddress} in ${wrapperName}:`, error);
      throw new Error(`Error performing sanity check for asset ${assetAddress} in ${wrapperName}: ${error}`);
    }
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const baseCurrencyUnit = BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);
  const baseCurrency = config.oracleAggregators.USD.baseCurrency;

  console.log(`\n🚀 Deploying TellorWrapper v1.1 to ${hre.network.name}...`);

  // Deploy TellorWrapper v1.1 for plain oracle feeds
  // Note: Using same deployment ID - will update to point to v1.1 address
  const tellorWrapperDeployment = await hre.deployments.deploy(USD_TELLOR_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "TellorWrapper",
    autoMine: true,
    log: true,
  });

  console.log(`✅ TellorWrapper v1.1 deployed at: ${tellorWrapperDeployment.address}`);

  const tellorWrapper = await hre.ethers.getContractAt("TellorWrapper", tellorWrapperDeployment.address);

  // Set feeds for plain oracle feeds
  const plainFeeds = config.oracleAggregators.USD.tellorOracleAssets?.plainTellorOracleWrappers || {};

  console.log(`\n📝 Configuring ${Object.keys(plainFeeds).length} plain Tellor feeds...`);

  for (const [assetAddress, feed] of Object.entries(plainFeeds)) {
    if (!assetAddress || !/^0x[0-9a-fA-F]{40}$/.test(assetAddress)) {
      console.error(`[oracle-setup] Invalid or missing assetAddress in plainFeeds: '${assetAddress}'`);
      throw new Error(`[oracle-setup] Invalid or missing assetAddress in plainFeeds: '${assetAddress}'`);
    }

    if (!feed || !/^0x[0-9a-fA-F]{40}$/.test(feed)) {
      console.error(`[oracle-setup] Invalid or missing feed address in plainFeeds for asset ${assetAddress}: '${feed}'`);
      throw new Error(`[oracle-setup] Invalid or missing feed address in plainFeeds for asset ${assetAddress}: '${feed}'`);
    }

    // STRICT: If setFeed fails, error propagates and stops deployment
    await tellorWrapper.setFeed(assetAddress, feed);
    console.log(`  ✅ Set plain Tellor feed for asset ${assetAddress} to ${feed}`);
  }

  // Sanity check for plain Tellor feeds - STRICT: throws error if any check fails
  console.log(`\n🔍 Performing sanity checks on plain Tellor feeds...`);
  await performOracleSanityChecks(tellorWrapper, plainFeeds, baseCurrencyUnit, "plain Tellor feeds");
  console.log(`✅ All plain Tellor feed sanity checks passed`);

  // Deploy TellorWrapperWithThresholding v1.1 for feeds with thresholding
  // Note: Using same deployment ID - will update to point to v1.1 address
  const tellorWrapperWithThresholdingDeployment = await hre.deployments.deploy(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "TellorWrapperWithThresholding",
    autoMine: true,
    log: true,
  });

  console.log(`✅ TellorWrapperWithThresholding v1.1 deployed at: ${tellorWrapperWithThresholdingDeployment.address}`);

  const tellorWrapperWithThresholding = await hre.ethers.getContractAt(
    "TellorWrapperWithThresholding",
    tellorWrapperWithThresholdingDeployment.address,
  );

  // Set feeds and thresholds for feeds with thresholding
  const thresholdFeeds = config.oracleAggregators.USD.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {};

  console.log(`\n📝 Configuring ${Object.keys(thresholdFeeds).length} thresholded Tellor feeds...`);

  for (const [assetAddress, feedConfig] of Object.entries(thresholdFeeds)) {
    if (!assetAddress || !/^0x[0-9a-fA-F]{40}$/.test(assetAddress)) {
      console.error(`[oracle-setup] Invalid or missing assetAddress in thresholdFeeds: '${assetAddress}'`);
      throw new Error(`[oracle-setup] Invalid or missing assetAddress in thresholdFeeds: '${assetAddress}'`);
    }

    if (!feedConfig.feed || !/^0x[0-9a-fA-F]{40}$/.test(feedConfig.feed)) {
      console.error(`[oracle-setup] Invalid or missing feed address in thresholdFeeds for asset ${assetAddress}: '${feedConfig.feed}'`);
      throw new Error(`[oracle-setup] Invalid or missing feed address in thresholdFeeds for asset ${assetAddress}: '${feedConfig.feed}'`);
    }

    // STRICT: If setFeed or setThresholdConfig fails, error propagates and stops deployment
    await tellorWrapperWithThresholding.setFeed(assetAddress, feedConfig.feed);
    await tellorWrapperWithThresholding.setThresholdConfig(assetAddress, feedConfig.lowerThreshold, feedConfig.fixedPrice);
    console.log(`  ✅ Set Tellor feed with thresholding for asset ${assetAddress}`);
  }

  // Sanity check for Tellor feeds with thresholding - STRICT: throws error if any check fails
  console.log(`\n🔍 Performing sanity checks on thresholded Tellor feeds...`);
  await performOracleSanityChecks(tellorWrapperWithThresholding, thresholdFeeds, baseCurrencyUnit, "Tellor feeds with thresholding");
  console.log(`✅ All thresholded Tellor feed sanity checks passed`);

  // Deploy TellorCompositeWrapper v1.1 for composite feeds
  const tellorCompositeWrapperDeployment = await hre.deployments.deploy(USD_TELLOR_COMPOSITE_WRAPPER_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "TellorCompositeWrapper",
    autoMine: true,
    log: true,
  });

  console.log(`✅ TellorCompositeWrapper v1.1 deployed at: ${tellorCompositeWrapperDeployment.address}`);

  const tellorCompositeWrapper = await hre.ethers.getContractAt("TellorCompositeWrapper", tellorCompositeWrapperDeployment.address);

  // Set composite feeds (e.g., yUSD/USDC * USDC/USD = yUSD/USD)
  const compositeFeeds = config.oracleAggregators.USD.tellorOracleAssets?.compositeTellorOracleWrappers || {};

  console.log(`\n📝 Configuring ${Object.keys(compositeFeeds).length} composite Tellor feeds...`);

  for (const [assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    if (!assetAddress || !/^0x[0-9a-fA-F]{40}$/.test(assetAddress)) {
      console.error(`[oracle-setup] Invalid or missing assetAddress in compositeFeeds: '${assetAddress}'`);
      throw new Error(`[oracle-setup] Invalid or missing assetAddress in compositeFeeds: '${assetAddress}'`);
    }

    if (!feedConfig.feed1 || !/^0x[0-9a-fA-F]{40}$/.test(feedConfig.feed1)) {
      console.error(`[oracle-setup] Invalid or missing feed1 address in compositeFeeds for asset ${assetAddress}: '${feedConfig.feed1}'`);
      throw new Error(`[oracle-setup] Invalid or missing feed1 address in compositeFeeds for asset ${assetAddress}: '${feedConfig.feed1}'`);
    }

    if (!feedConfig.feed2 || !/^0x[0-9a-fA-F]{40}$/.test(feedConfig.feed2)) {
      console.error(`[oracle-setup] Invalid or missing feed2 address in compositeFeeds for asset ${assetAddress}: '${feedConfig.feed2}'`);
      throw new Error(`[oracle-setup] Invalid or missing feed2 address in compositeFeeds for asset ${assetAddress}: '${feedConfig.feed2}'`);
    }

    // STRICT: If addCompositeFeed fails, error propagates and stops deployment
    await tellorCompositeWrapper.addCompositeFeed(
      assetAddress,
      feedConfig.feed1,
      feedConfig.feed2,
      feedConfig.lowerThresholdInBase1,
      feedConfig.fixedPriceInBase1,
      feedConfig.lowerThresholdInBase2,
      feedConfig.fixedPriceInBase2,
    );
    console.log(`  ✅ Set composite Tellor feed for asset ${assetAddress}`);
    console.log(`     Feed1: ${feedConfig.feed1}`);
    console.log(`     Feed2: ${feedConfig.feed2}`);
  }

  // Sanity check for composite Tellor feeds - STRICT: throws error if any check fails
  console.log(`\n🔍 Performing sanity checks on composite Tellor feeds...`);
  await performOracleSanityChecks(tellorCompositeWrapper, compositeFeeds, baseCurrencyUnit, "composite Tellor feeds");
  console.log(`✅ All composite Tellor feed sanity checks passed`);

  console.log(`\n🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  console.log(`\n📋 Deployment Summary:`);
  console.log(`   - TellorWrapper v1.1: ${tellorWrapperDeployment.address}`);
  console.log(`   - TellorWrapperWithThresholding v1.1: ${tellorWrapperWithThresholdingDeployment.address}`);
  console.log(`   - TellorCompositeWrapper v1.1: ${tellorCompositeWrapperDeployment.address}`);
  console.log(`   - Plain feeds configured: ${Object.keys(plainFeeds).length}`);
  console.log(`   - Thresholded feeds configured: ${Object.keys(thresholdFeeds).length}`);
  console.log(`   - Composite feeds configured: ${Object.keys(compositeFeeds).length}`);
  console.log(`   - All sanity checks passed ✅\n`);

  // Return true to indicate deployment success
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-tellor-oracle-wrapper", "tellor-wrapper-v1.1"];
func.dependencies = [];
func.id = "deploy-tellor-wrapper-v1.1";

export default func;
