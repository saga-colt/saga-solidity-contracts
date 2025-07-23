import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  S_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  S_API3_ORACLE_WRAPPER_ID,
  S_API3_WRAPPER_WITH_THRESHOLDING_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);

  // Get S OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID,
  );
  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorDeployment.address,
  );

  // Get S API3Wrapper for plain feeds
  const api3WrapperDeployment = await hre.deployments.get(
    S_API3_ORACLE_WRAPPER_ID,
  );
  const api3WrapperAddress = api3WrapperDeployment.address;

  // Get S API3WrapperWithThresholding for feeds with thresholding
  const api3WrapperWithThresholdingDeployment = await hre.deployments.get(
    "S_API3WrapperWithThresholding",
  );
  const api3WrapperWithThresholdingAddress =
    api3WrapperWithThresholdingDeployment.address;

  // Get S API3CompositeWrapperWithThresholding for composite feeds
  const api3CompositeWrapperDeployment = await hre.deployments.get(
    "S_API3CompositeWrapperWithThresholding",
  );
  const api3CompositeWrapperAddress = api3CompositeWrapperDeployment.address;

  // Set plain API3 oracle wrappers
  const plainFeeds =
    config.oracleAggregators.S.api3OracleAssets.plainApi3OracleWrappers || {};

  for (const [assetAddress, _source] of Object.entries(plainFeeds)) {
    await oracleAggregator.setOracle(assetAddress, api3WrapperAddress);
    console.log(
      `Set plain API3 wrapper for asset ${assetAddress} to ${api3WrapperAddress}`,
    );
  }

  // Set API3 oracle wrappers with thresholding
  const thresholdFeeds =
    config.oracleAggregators.S.api3OracleAssets
      .api3OracleWrappersWithThresholding || {};

  for (const [assetAddress, _config] of Object.entries(thresholdFeeds)) {
    await oracleAggregator.setOracle(
      assetAddress,
      api3WrapperWithThresholdingAddress,
    );
    console.log(
      `Set API3 wrapper with thresholding for asset ${assetAddress} to ${api3WrapperWithThresholdingAddress}`,
    );
  }

  // Set composite API3 wrapper for assets
  const compositeFeeds =
    config.oracleAggregators.S.api3OracleAssets
      .compositeApi3OracleWrappersWithThresholding || {};

  for (const [_assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    const typedFeedConfig = feedConfig as {
      feedAsset: string;
      proxy1: string;
      proxy2: string;
      lowerThresholdInBase1: bigint;
      fixedPriceInBase1: bigint;
      lowerThresholdInBase2: bigint;
      fixedPriceInBase2: bigint;
    };

    await oracleAggregator.setOracle(
      typedFeedConfig.feedAsset,
      api3CompositeWrapperAddress,
    );
    console.log(
      `Set composite API3 wrapper for asset ${typedFeedConfig.feedAsset} to ${api3CompositeWrapperAddress}`,
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = [
  "s-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "s-oracle-wrapper",
];
func.dependencies = [
  S_API3_ORACLE_WRAPPER_ID,
  S_API3_WRAPPER_WITH_THRESHOLDING_ID,
  S_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  S_ORACLE_AGGREGATOR_ID,
];
func.id = "point-s-aggregator-to-api3-wrappers";

export default func;
