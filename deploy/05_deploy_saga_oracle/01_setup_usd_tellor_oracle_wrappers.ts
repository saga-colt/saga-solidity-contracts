import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { setupTellorSimpleFeedsForAssets } from "../../typescript/dlend/setup-tellor-oracle";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (hre.network.name !== "saga_mainnet") {
    console.log(`[oracle-setup] Skipping Saga USD Tellor wrapper deployment on network ${hre.network.name}`);
    return false;
  }

  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Define the assets to setup - categorized by feed type
  // Note: This script only deploys oracle feeds for new assets (currently SAGA/USD).
  // USDC/USD and USDT/USD feeds were deployed in previous deployments.
  const sagaAddress = config.tokenAddresses.SAGA;

  if (!sagaAddress) {
    console.log("SAGA token address not configured in network config. Skipping SAGA oracle feed setup.");
    return true;
  }

  const tellorSimpleFeedAssets = [sagaAddress].filter(Boolean);

  if (tellorSimpleFeedAssets.length === 0) {
    console.log("No SAGA assets configured for Tellor feed setup. Exiting.");
    return true;
  }

  const deployerSigner = await hre.ethers.getSigner(deployer);

  const baseCurrencyUnit = BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);

  // SAGA price range for sanity checks (SAGA token typically trades in $0.1 - $1 range)
  const SAGA_MIN_PRICE = 0.1;
  const SAGA_MAX_PRICE = 1;

  // Setup Tellor simple feeds
  if (tellorSimpleFeedAssets.length > 0) {
    const { address: tellorWrapperAddress } = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);

    if (!tellorWrapperAddress) {
      throw new Error("TellorWrapperWithThresholding artifact not found");
    }

    const tellorWrapper = await hre.ethers.getContractAt("TellorWrapperWithThresholding", tellorWrapperAddress, deployerSigner);

    console.log(`🔮 Setting up Tellor feeds for ${tellorSimpleFeedAssets.length} SAGA assets...`);

    await setupTellorSimpleFeedsForAssets(
      tellorSimpleFeedAssets,
      config,
      tellorWrapper,
      baseCurrencyUnit,
      SAGA_MIN_PRICE,
      SAGA_MAX_PRICE,
      deployer,
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["saga", "saga-oracle", "usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-tellor-oracle-wrapper", "saga-tellor-feeds"];
func.dependencies = [USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID];
func.id = "setup-saga-usd-tellor-oracle-feeds";

export default func;
