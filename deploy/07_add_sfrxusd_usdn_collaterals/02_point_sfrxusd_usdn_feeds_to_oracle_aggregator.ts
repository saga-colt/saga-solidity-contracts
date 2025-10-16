import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID, USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Get sfrxUSD and USDN addresses from config - skip if not configured
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;
  const usdnAddress = config.tokenAddresses.USDN;

  if (!sfrxUSDAddress || !usdnAddress) {
    console.log("sfrxUSD or USDN token address not configured in network config. Skipping oracle aggregator wiring.");
    return true;
  }

  // Get USD OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const deployerSigner = await hre.ethers.getSigner(deployer);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  // Get USD TellorWrapperWithThresholding for sfrxUSD and USDN feeds
  const tellorWrapperWithThresholdingDeployment = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);
  const tellorWrapperWithThresholdingAddress = tellorWrapperWithThresholdingDeployment.address;

  // Check if feeds are configured in the oracle assets
  const thresholdFeeds = config.oracleAggregators.USD.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {};

  const assetsToWire = [
    { name: "sfrxUSD", address: sfrxUSDAddress },
    { name: "USDN", address: usdnAddress },
  ];

  for (const asset of assetsToWire) {
    if (!thresholdFeeds[asset.address]) {
      console.log(`${asset.name} feed configuration not found for address ${asset.address}. Skipping oracle aggregator wiring.`);
      continue;
    }

    // Check if already wired
    const currentOracle = await oracleAggregator.assetOracles(asset.address);

    if (currentOracle === tellorWrapperWithThresholdingAddress) {
      console.log(`ℹ️ ${asset.name} (${asset.address}) is already wired to TellorWrapperWithThresholding. Skipping.`);
      continue;
    }

    // Set Tellor wrapper with thresholding for the asset
    console.log(
      `Setting oracle for ${asset.name} token (${asset.address}) to TellorWrapperWithThresholding (${tellorWrapperWithThresholdingAddress})...`,
    );

    await oracleAggregator.setOracle(asset.address, tellorWrapperWithThresholdingAddress);

    console.log(
      `✅ Set Tellor wrapper with thresholding for ${asset.name} asset ${asset.address} to ${tellorWrapperWithThresholdingAddress}`,
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["sfrxusd-usdn", "sfrxusd-usdn-oracle", "usd-oracle", "oracle-aggregator", "sfrxusd-usdn-oracle-wiring"];
func.dependencies = ["setup-sfrxusd-usdn-usd-tellor-oracle-feeds", USD_ORACLE_AGGREGATOR_ID];
func.id = "point-sfrxusd-usdn-feeds-to-oracle-aggregator";

export default func;
