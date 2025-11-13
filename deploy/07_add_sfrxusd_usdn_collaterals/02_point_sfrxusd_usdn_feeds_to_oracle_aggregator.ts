import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID, USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload to set an oracle in the OracleAggregator
 *
 * @param oracleAggregatorAddress - Oracle aggregator contract whose mapping is updated
 * @param assetAddress - Asset whose price feed is being set
 * @param oracleAddress - Address of the Tellor wrapper feed to wire in
 * @param oracleAggregatorInterface - Interface used to encode the Safe transaction data
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const deployerSigner = await hre.ethers.getSigner(deployer);

  // Initialize Saga governance executor
  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  // Get sfrxUSD and USDN addresses from config - skip if not configured
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;
  const usdnAddress = config.tokenAddresses.USDN;

  if (!sfrxUSDAddress || !usdnAddress) {
    console.log("sfrxUSD or USDN token address not configured in network config. Skipping oracle aggregator wiring.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (tokens not configured)`);
    return true;
  }

  // Get USD OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  // Get USD TellorWrapperWithThresholding for sfrxUSD and USDN feeds
  const tellorWrapperWithThresholdingDeployment = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);
  const tellorWrapperWithThresholdingAddress = tellorWrapperWithThresholdingDeployment.address;

  console.log(`\n🔗 Oracle Aggregator: ${oracleAggregatorDeployment.address}`);
  console.log(`🔗 Tellor Wrapper: ${tellorWrapperWithThresholdingAddress}`);

  // Check if feeds are configured in the oracle assets
  const thresholdFeeds = config.oracleAggregators.USD.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {};

  const assetsToWire = [
    { name: "sfrxUSD", address: sfrxUSDAddress },
    { name: "USDN", address: usdnAddress },
  ];

  let allOperationsComplete = true;

  for (const asset of assetsToWire) {
    console.log(`\n📝 Processing ${asset.name} (${asset.address})...`);

    if (!thresholdFeeds[asset.address]) {
      console.log(`  ⚠️  ${asset.name} feed configuration not found. Skipping oracle aggregator wiring.`);
      continue;
    }

    // Check if already wired
    const currentOracle = await oracleAggregator.assetOracles(asset.address);

    if (currentOracle === tellorWrapperWithThresholdingAddress) {
      console.log(`  ✅ ${asset.name} is already wired to TellorWrapperWithThresholding. Skipping.`);
      continue;
    }

    // Set Tellor wrapper with thresholding for the asset
    console.log(`\n  🔧 Setting oracle for ${asset.name} token to TellorWrapperWithThresholding...`);

    const opComplete = await executor.tryOrQueue(
      async () => {
        await oracleAggregator.setOracle(asset.address, tellorWrapperWithThresholdingAddress);
        console.log(`    ✅ Set Tellor wrapper with thresholding for ${asset.name} asset ${asset.address}`);
      },
      () =>
        createSetOracleTransaction(
          oracleAggregatorDeployment.address,
          asset.address,
          tellorWrapperWithThresholdingAddress,
          oracleAggregator.interface,
        ),
    );

    if (!opComplete) {
      allOperationsComplete = false;
    }
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Point sfrxUSD and USDN feeds to OracleAggregator: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Oracle aggregator wiring requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["sfrxusd-usdn", "sfrxusd-usdn-oracle", "usd-oracle", "oracle-aggregator", "sfrxusd-usdn-oracle-wiring"];
func.dependencies = ["setup-sfrxusd-usdn-usd-tellor-oracle-feeds", USD_ORACLE_AGGREGATOR_ID];
func.id = "point-sfrxusd-usdn-feeds-to-oracle-aggregator";

export default func;
