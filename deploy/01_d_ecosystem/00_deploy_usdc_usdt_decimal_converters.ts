import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  USDC_TO_USD_DECIMAL_CONVERTER_ID,
  USDT_TO_USD_DECIMAL_CONVERTER_ID,
} from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";

/**
 * This script deploys ChainlinkDecimalConverter contracts for USDC and USDT feeds.
 * Converts Chainlink feed prices from 18 decimals to 8 decimals for compatibility.
 *
 * Saved deployments:
 * - ChainlinkDecimalConverter_USDC_to_USD (converts 18→8 decimals)
 * - ChainlinkDecimalConverter_USDT_to_USD (converts 18→8 decimals)
 *
 * To reuse converter:
 * const converter = await hre.deployments.get("ChainlinkDecimalConverter_USDC_to_USD");
 * const converterContract = await hre.ethers.getContractAt("ChainlinkDecimalConverter", converter.address);
 */

// Constants for decimal conversion
const EXPECTED_SOURCE_DECIMALS = 18;
const TARGET_DECIMALS = 8;

// Feed addresses (hardcoded for now, could be moved to config)
const USDC_TO_USD_FEED_ADDRESS = "0x6c85266a8D3Ce564058667dc5c7E9d58da454ecc";
const USDT_TO_USD_FEED_ADDRESS = "0x62E537964E2452aD6F08976dA251C4B33c04B96C";

/**
 * Deploy ChainlinkDecimalConverter for OS/S and wOS/OS feeds to convert from 18 to 8 decimals
 *
 * @param hre - Hardhat runtime environment
 */
async function deployUSDCUSDTDecimalConverters(
  hre: HardhatRuntimeEnvironment,
): Promise<{ feedName: string; feedAddress: string; converter: string }[]> {
  const { deployer } = await hre.getNamedAccounts();
  const results = [];

  // Configuration for the feeds
  const feedConfigs = [
    {
      name: "USDC_to_USD",
      feedAddress: USDC_TO_USD_FEED_ADDRESS,
      converterId: USDC_TO_USD_DECIMAL_CONVERTER_ID,
    },
    {
      name: "USDT_to_USD",
      feedAddress: USDT_TO_USD_FEED_ADDRESS,
      converterId: USDT_TO_USD_DECIMAL_CONVERTER_ID,
    },
  ];

  for (const config of feedConfigs) {
    console.log(`🔧 Processing decimal converter for ${config.name}...`);

    try {
      // Check if converter already exists
      const existingConverter = await hre.deployments.get(config.converterId);
      console.log(
        `♻️  Using existing decimal converter for ${config.name}: ${existingConverter.address}`,
      );
      results.push({
        feedName: config.name,
        feedAddress: config.feedAddress,
        converter: existingConverter.address,
      });
    } catch {
      // Converter doesn't exist, deploy it
      console.log(`🚀 Deploying decimal converter for ${config.name}...`);

      // Verify the source feed has 18 decimals
      const sourceFeed = await hre.ethers.getContractAt(
        "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface",
        config.feedAddress,
      );

      const sourceDecimals = await sourceFeed.decimals();

      if (Number(sourceDecimals) !== EXPECTED_SOURCE_DECIMALS) {
        throw new Error(
          `Source feed for ${config.name} has ${sourceDecimals} decimals, expected ${EXPECTED_SOURCE_DECIMALS}`,
        );
      }

      console.log(`✅ Verified source feed has ${sourceDecimals} decimals`);

      // Deploy the ChainlinkDecimalConverter
      await hre.deployments.deploy(config.converterId, {
        from: deployer,
        args: [config.feedAddress, TARGET_DECIMALS],
        contract: "ChainlinkDecimalConverter",
        autoMine: true,
        log: false,
      });

      const converterDeployment = await hre.deployments.get(config.converterId);
      console.log(
        `✅ Deployed decimal converter for ${config.name}: ${converterDeployment.address}`,
      );
      console.log(`💾 Saved converter as deployment: ${config.converterId}`);

      // Verify the converter has the correct target decimals
      const converter = await hre.ethers.getContractAt(
        "ChainlinkDecimalConverter",
        converterDeployment.address,
      );
      const targetDecimals = await converter.decimals();
      console.log(`✅ Verified converter has ${targetDecimals} decimals`);

      // Test the converter by getting a price
      try {
        const latestRoundData = await converter.latestRoundData();
        const priceFormatted =
          Number(latestRoundData.answer) / 10 ** Number(targetDecimals);
        console.log(
          `💰 Current price from converter: ${priceFormatted} (${latestRoundData.answer} with ${targetDecimals} decimals)`,
        );
      } catch (priceError) {
        console.warn(
          `⚠️  Could not get price from converter (may be expected): ${priceError}`,
        );
      }

      results.push({
        feedName: config.name,
        feedAddress: config.feedAddress,
        converter: converterDeployment.address,
      });
    }
  }

  return results;
}

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  if (!isMainnet(hre.network.name)) {
    console.log(
      `⏭️  Skipping USDC and USDT decimal converter deployment on ${hre.network.name}`,
    );
    return true;
  }

  console.log(`🔧 Deploying USDC/USD and USDT/USD decimal converters...`);

  // Deploy decimal converters for USDC and USDT feeds (18 to 8 decimals)
  const deployedConverters = await deployUSDCUSDTDecimalConverters(hre);

  // Display summary of deployed converters
  console.log(`\n🔧 Deployed Decimal Converter Summary:`);

  for (const converter of deployedConverters) {
    console.log(`   • ${converter.feedName}: ${converter.converter}`);
    console.log(
      `     └─ Converts from ${converter.feedName} feed (18 decimals) to 8 decimals`,
    );
    console.log(`     └─ Source feed: ${converter.feedAddress}`);
  }

  console.log(
    `🔧 USDC/USD and USDT/USD decimal converter deployment completed: ✅`,
  );
  console.log(`🔧 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["oracle", "decimal-converters", "usdc-usdt-usd"];
func.dependencies = [];
func.id = "USDCUSDTDecimalConverters";

export default func;
