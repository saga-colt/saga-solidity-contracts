import { ZeroAddress } from "ethers";

/**
 * Performs sanity checks on oracle wrapper feeds by verifying normalized prices are within a reasonable range.
 *
 * @param wrapper The oracle wrapper contract instance.
 * @param feeds A record mapping asset addresses to feed configurations.
 * @param baseCurrencyUnit The base currency unit for price calculations.
 * @param wrapperName The name of the wrapper for logging purposes.
 * @param minPrice The minimum acceptable price for sanity checks.
 * @param maxPrice The maximum acceptable price for sanity checks.
 */
export async function performOracleSanityChecks(
  wrapper: any,
  feeds: Record<string, any>,
  baseCurrencyUnit: bigint,
  wrapperName: string,
  minPrice: number,
  maxPrice: number,
): Promise<void> {
  for (const [assetAddress] of Object.entries(feeds)) {
    try {
      const price = await wrapper.getAssetPrice(assetAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < minPrice || normalizedPrice > maxPrice) {
        console.error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [${minPrice}, ${maxPrice}]`,
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [${minPrice}, ${maxPrice}]`,
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

/**
 * Setup Tellor feeds with thresholding for a list of asset addresses
 *
 * @param assetAddresses Array of asset addresses to setup Tellor feeds for
 * @param config Network configuration
 * @param tellorWrapper The Tellor wrapper contract
 * @param baseCurrencyUnit The base currency unit for calculations
 * @param minPrice The minimum acceptable price for sanity checks
 * @param maxPrice The maximum acceptable price for sanity checks
 * @param deployerAddress The deployer address for permission checks
 */
export async function setupTellorSimpleFeedsForAssets(
  assetAddresses: string[],
  config: any,
  tellorWrapper: any,
  baseCurrencyUnit: bigint,
  minPrice: number,
  maxPrice: number,
  deployerAddress: string,
): Promise<void> {
  const allTellorFeeds = config.oracleAggregators.USD.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {};

  for (const assetAddress of assetAddresses) {
    const feedConfig = allTellorFeeds[assetAddress];

    if (!feedConfig) {
      console.log(`⚠️  No Tellor feed configuration found for asset ${assetAddress}. Skipping.`);
      continue;
    }

    // Check if feed already exists
    const existingFeed = await tellorWrapper.assetToFeed(assetAddress);

    if (existingFeed !== ZeroAddress) {
      console.log(`- Tellor feed for asset ${assetAddress} already configured. Skipping setup.`);
      continue;
    }

    console.log(`- Tellor feed for asset ${assetAddress} not found. Proceeding with setup...`);

    // Check permissions before attempting to add feed
    try {
      const oracleManagerRole = await tellorWrapper.ORACLE_MANAGER_ROLE();
      const hasRole = await tellorWrapper.hasRole(oracleManagerRole, deployerAddress);
      console.log(`  - Deployer has ORACLE_MANAGER_ROLE: ${hasRole}`);

      if (!hasRole) {
        const errorMessage = `❌ Deployer (${deployerAddress}) lacks ORACLE_MANAGER_ROLE on TellorWrapperWithThresholding (${tellorWrapper.target}). Please grant this role before running the deployment.`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("lacks ORACLE_MANAGER_ROLE")) {
        throw error; // Re-throw our custom error
      }
      console.warn(`  - Could not check ORACLE_MANAGER_ROLE:`, error);
    }

    console.log(`- Adding Tellor feed for asset ${assetAddress}...`);
    console.log(`  - feed: ${feedConfig.feed}`);
    console.log(`  - lowerThreshold: ${feedConfig.lowerThreshold}`);
    console.log(`  - fixedPrice: ${feedConfig.fixedPrice}`);

    try {
      // Set the feed
      await tellorWrapper.setFeed(assetAddress, feedConfig.feed);
      console.log(`✅ Set Tellor feed for asset ${assetAddress}`);
    } catch (error) {
      console.error(`❌ Error adding Tellor feed for ${assetAddress}:`, error);
      throw new Error(`Failed to add Tellor feed for ${assetAddress}: ${error}`);
    }

    try {
      // Set threshold configuration if thresholds are specified
      if (feedConfig.lowerThreshold !== undefined && feedConfig.fixedPrice !== undefined) {
        await tellorWrapper.setThresholdConfig(assetAddress, feedConfig.lowerThreshold, feedConfig.fixedPrice);
        console.log(`✅ Set threshold config for asset ${assetAddress}`);
      }
    } catch (error) {
      console.error(`❌ Error setting threshold for ${assetAddress}:`, error);
      throw new Error(`Failed to set threshold for ${assetAddress}: ${error}`);
    }

    // Note: Oracle aggregator wiring is handled by a separate deployment script

    // Perform sanity check AFTER the feed is set up
    console.log(`- Performing sanity check for asset ${assetAddress}...`);
    await performOracleSanityChecks(
      tellorWrapper,
      { [assetAddress]: feedConfig },
      baseCurrencyUnit,
      `${assetAddress} Tellor feed`,
      minPrice,
      maxPrice,
    );
  }
}
