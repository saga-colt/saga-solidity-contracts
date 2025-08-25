import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_TELLOR_ORACLE_WRAPPER_ID,
  USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);

  // Get USD OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );
  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorDeployment.address,
  );

  // Get USD TellorWrapper for plain feeds
  const tellorWrapperDeployment = await hre.deployments.get(
    USD_TELLOR_ORACLE_WRAPPER_ID,
  );
  const tellorWrapperAddress = tellorWrapperDeployment.address;

  // Get USD TellorWrapperWithThresholding for feeds with thresholding
  const tellorWrapperWithThresholdingDeployment = await hre.deployments.get(
    USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
  );
  const tellorWrapperWithThresholdingAddress =
    tellorWrapperWithThresholdingDeployment.address;

  // Set plain Tellor oracle wrappers
  const plainFeeds =
    config.oracleAggregators.USD.tellorOracleAssets
      ?.plainTellorOracleWrappers || {};

  for (const [assetAddress, _feed] of Object.entries(plainFeeds)) {
    await oracleAggregator.setOracle(assetAddress, tellorWrapperAddress);
    console.log(
      `Set plain Tellor wrapper for asset ${assetAddress} to ${tellorWrapperAddress}`,
    );
  }

  // Set Tellor oracle wrappers with thresholding
  const thresholdFeeds =
    config.oracleAggregators.USD.tellorOracleAssets
      ?.tellorOracleWrappersWithThresholding || {};

  for (const [assetAddress, _config] of Object.entries(thresholdFeeds)) {
    await oracleAggregator.setOracle(
      assetAddress,
      tellorWrapperWithThresholdingAddress,
    );
    console.log(
      `Set Tellor wrapper with thresholding for asset ${assetAddress} to ${tellorWrapperWithThresholdingAddress}`,
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = [
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-tellor-wrapper",
];
func.dependencies = [
  USD_TELLOR_ORACLE_WRAPPER_ID,
  USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
];
func.id = "point-usd-aggregator-to-tellor-wrappers";

export default func;
