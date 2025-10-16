import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Get the CollateralVault contract
  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const collateralVault = await hre.ethers.getContractAt(
    "CollateralHolderVault",
    collateralVaultAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Get the OracleAggregator contract
  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Get sfrxUSD and USDN addresses from config
  const sfrxUSDAddress = config.tokenAddresses.sfrxUSD;
  const usdnAddress = config.tokenAddresses.USDN;

  // Array of tokens to whitelist with defined addresses
  interface TokenInfo {
    name: string;
    address: string;
  }

  const tokensToWhitelist: TokenInfo[] = [];

  // Filter out zero addresses
  if (sfrxUSDAddress && sfrxUSDAddress !== ZeroAddress) {
    tokensToWhitelist.push({ name: "sfrxUSD", address: sfrxUSDAddress });
  }

  if (usdnAddress && usdnAddress !== ZeroAddress) {
    tokensToWhitelist.push({ name: "USDN", address: usdnAddress });
  }

  if (tokensToWhitelist.length === 0) {
    console.log("No sfrxUSD or USDN tokens configured. Skipping whitelist.");
    return true;
  }

  // Sanity check: Verify that the oracle can provide a price for each asset

  for (const token of tokensToWhitelist) {
    const price = await oracleAggregator.getAssetPrice(token.address);

    if (price.toString() === "0") {
      throw new Error(`Aborting: Oracle price for ${token.name} (${token.address}) is zero.`);
    }

    console.log(`Oracle price for ${token.name} (${token.address}): ${price.toString()}`);
  }

  // Whitelist each valid token
  for (const token of tokensToWhitelist) {
    try {
      // Check if the token is already whitelisted
      const isAlreadyWhitelisted = await collateralVault.isCollateralSupported(token.address);

      if (isAlreadyWhitelisted) {
        console.log(`ℹ️ ${token.name} (${token.address}) is already whitelisted as collateral. Skipping.`);
        continue;
      }

      // Whitelist the token
      await collateralVault.allowCollateral(token.address);
      console.log(`✅ ${token.name} (${token.address}) whitelisted as collateral`);
    } catch (error) {
      throw new Error(`Error whitelisting ${token.name} (${token.address}): ${error}`);
    }
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["sfrxusd-usdn", "sfrxusd-usdn-collateral", "d"];
func.dependencies = ["d-collateral-vault", "point-sfrxusd-usdn-feeds-to-oracle-aggregator"];
func.id = "d-whitelist-sfrxusd-usdn-collateral";

export default func;
