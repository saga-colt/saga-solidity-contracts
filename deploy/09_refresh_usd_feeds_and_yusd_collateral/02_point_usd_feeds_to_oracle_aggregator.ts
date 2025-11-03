import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_TELLOR_ORACLE_WRAPPER_ID,
  USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to wire an asset to an oracle.
 *
 * @param oracleAggregatorAddress - OracleAggregator contract address
 * @param assetAddress - Asset to configure
 * @param oracleAddress - Oracle contract that should serve the asset
 * @param oracleAggregatorInterface - OracleAggregator interface encoder
 */
function createSetOracleTransaction(
  oracleAggregatorAddress: string,
  assetAddress: string,
  oracleAddress: string,
  oracleAggregatorInterface: any,
): SafeTransactionData {
  return {
    to: oracleAggregatorAddress,
    value: "0",
    data: oracleAggregatorInterface.encodeFunctionData("setOracle", [assetAddress, oracleAddress]),
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const usdConfig = config.oracleAggregators.USD;
  const thresholdFeeds = usdConfig.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {};
  const plainFeeds = usdConfig.tellorOracleAssets?.plainTellorOracleWrappers || {};

  const usdcAddress = config.tokenAddresses.USDC;
  const usdtAddress = config.tokenAddresses.USDT;
  const yUSDAddress = config.tokenAddresses.yUSD;

  if (!usdcAddress || !usdtAddress || !yUSDAddress) {
    console.log("❌ Missing one or more USD token addresses in config. Aborting.");
    return false;
  }

  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  const thresholdWrapperDeployment = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);
  const plainWrapperDeployment = await hre.deployments.get(USD_TELLOR_ORACLE_WRAPPER_ID);

  const assetsToWire = [
    {
      name: "USDC",
      address: usdcAddress,
      expectedOracle: thresholdWrapperDeployment.address,
      hasConfig: Boolean(thresholdFeeds[usdcAddress]),
    },
    {
      name: "USDT",
      address: usdtAddress,
      expectedOracle: thresholdWrapperDeployment.address,
      hasConfig: Boolean(thresholdFeeds[usdtAddress]),
    },
    {
      name: "yUSD",
      address: yUSDAddress,
      expectedOracle: plainWrapperDeployment.address,
      hasConfig: Boolean(plainFeeds[yUSDAddress]),
    },
  ];

  let allOperationsComplete = true;

  for (const asset of assetsToWire) {
    if (!asset.hasConfig) {
      console.log(`\n⚠️  No feed configuration found for ${asset.name} (${asset.address}). Skipping.`);
      continue;
    }

    console.log(`\n📝 Processing ${asset.name} (${asset.address})...`);

    const currentOracle = await oracleAggregator.assetOracles(asset.address);

    if (currentOracle.toLowerCase() === asset.expectedOracle.toLowerCase()) {
      console.log(`  ✅ ${asset.name} already routed to ${asset.expectedOracle}`);
      continue;
    }

    console.log(`  🔧 Wiring ${asset.name} oracle to ${asset.expectedOracle} (current ${currentOracle})`);

    const opComplete = await executor.tryOrQueue(
      async () => {
        await oracleAggregator.setOracle(asset.address, asset.expectedOracle);
        console.log(`    ✅ Oracle updated for ${asset.name}`);
      },
      () => createSetOracleTransaction(oracleAggregatorDeployment.address, asset.address, asset.expectedOracle, oracleAggregator.interface),
    );

    if (!opComplete) {
      allOperationsComplete = false;
    }
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush("Point USDC/USDT/yUSD oracles to wrappers");

    if (executor.useSafe) {
      if (!flushed) {
        console.log("\n❌ Failed to prepare Safe transactions for oracle wiring.");
      }
      console.log("\n⏳ Oracle wiring pending governance Safe execution.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }
  }

  console.log("\n✅ All oracle wiring completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "usd-feed-updates", "yusd"];
func.dependencies = [
  "update-usdc-usdt-yusd-tellor-feeds",
  USD_ORACLE_AGGREGATOR_ID,
  USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
  USD_TELLOR_ORACLE_WRAPPER_ID,
];
func.id = "point-usdc-usdt-yusd-oracles";

export default func;
