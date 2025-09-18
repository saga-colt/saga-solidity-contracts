import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (hre.network.name !== "saga_mainnet") {
    console.log(
      `[oracle-setup] Skipping Saga oracle aggregator wiring on network ${hre.network.name}`,
    );
    return false;
  }

  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Get SAGA address from config - skip if not configured
  const sagaAddress = config.tokenAddresses.SAGA;

  if (!sagaAddress) {
    console.log(
      "SAGA token address not configured in network config. Skipping SAGA oracle aggregator wiring.",
    );
    return true;
  }

  // Get USD OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );
  const deployerSigner = await hre.ethers.getSigner(deployer);
  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorDeployment.address,
    deployerSigner,
  );

  // Get USD TellorWrapperWithThresholding for SAGA feed
  const tellorWrapperWithThresholdingDeployment = await hre.deployments.get(
    USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
  );
  const tellorWrapperWithThresholdingAddress =
    tellorWrapperWithThresholdingDeployment.address;

  // Check if SAGA feed is configured in the oracle assets
  const thresholdFeeds =
    config.oracleAggregators.USD.tellorOracleAssets
      ?.tellorOracleWrappersWithThresholding || {};

  if (!thresholdFeeds[sagaAddress]) {
    console.log(
      `SAGA feed configuration not found for address ${sagaAddress}. Skipping oracle aggregator wiring.`,
    );
    return true;
  }

  // Set Tellor wrapper with thresholding for SAGA
  console.log(
    `Setting oracle for SAGA token (${sagaAddress}) to TellorWrapperWithThresholding (${tellorWrapperWithThresholdingAddress})...`,
  );

  await oracleAggregator.setOracle(
    sagaAddress,
    tellorWrapperWithThresholdingAddress,
  );

  console.log(
    `✅ Set Tellor wrapper with thresholding for SAGA asset ${sagaAddress} to ${tellorWrapperWithThresholdingAddress}`,
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = [
  "saga",
  "saga-oracle",
  "usd-oracle",
  "oracle-aggregator",
  "saga-oracle-wiring",
];
func.dependencies = [
  "setup-saga-usd-tellor-oracle-feeds",
  USD_ORACLE_AGGREGATOR_ID,
];
func.id = "point-saga-feed-to-oracle-aggregator";

export default func;
