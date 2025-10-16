import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { setupTellorSimpleFeedsForAssets } from "../../typescript/dlend/setup-tellor-oracle";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (hre.network.name !== "saga_mainnet") {
    console.log(`[oracle-setup] Skipping sfrxUSD/USDN Tellor wrapper deployment on network ${hre.network.name}`);
    return false;
  }

  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Define the assets to setup - sfrxUSD and USDN
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;
  const usdnAddress = config.tokenAddresses.USDN;

  if (!sfrxUSDAddress || !usdnAddress) {
    console.log("sfrxUSD or USDN token address not configured in network config. Skipping oracle feed setup.");
    return true;
  }

  const tellorSimpleFeedAssets = [sfrxUSDAddress, usdnAddress].filter(Boolean);

  if (tellorSimpleFeedAssets.length === 0) {
    console.log("No sfrxUSD/USDN assets configured for Tellor feed setup. Exiting.");
    return true;
  }

  const deployerSigner = await hre.ethers.getSigner(deployer);

  const baseCurrencyUnit = BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);

  // Price range for sanity checks (stablecoins typically trade in $0.95 - $1.05 range)
  const STABLECOIN_MIN_PRICE = 0.95;
  const STABLECOIN_MAX_PRICE = 1.05;

  // Setup Tellor simple feeds
  if (tellorSimpleFeedAssets.length > 0) {
    const { address: tellorWrapperAddress } = await hre.deployments.get(USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID);

    if (!tellorWrapperAddress) {
      throw new Error("TellorWrapperWithThresholding artifact not found");
    }

    const tellorWrapper = await hre.ethers.getContractAt("TellorWrapperWithThresholding", tellorWrapperAddress, deployerSigner);

    console.log(`🔮 Setting up Tellor feeds for ${tellorSimpleFeedAssets.length} stablecoin assets (sfrxUSD, USDN)...`);

    await setupTellorSimpleFeedsForAssets(
      tellorSimpleFeedAssets,
      config,
      tellorWrapper,
      baseCurrencyUnit,
      STABLECOIN_MIN_PRICE,
      STABLECOIN_MAX_PRICE,
      deployer,
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = [
  "sfrxusd-usdn",
  "sfrxusd-usdn-oracle",
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-tellor-oracle-wrapper",
  "sfrxusd-usdn-tellor-feeds",
];
func.dependencies = [USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID];
func.id = "setup-sfrxusd-usdn-usd-tellor-oracle-feeds";

export default func;
