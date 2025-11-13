import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { isMainnet, isSagaTestnet } from "../typescript/hardhat/deploy";
import { getTokenContractForSymbol } from "../typescript/token/utils";

// Define the oracle feed structure
export interface OracleFeedConfig {
  name: string; // Name of the oracle feed (e.g., "USDC/USD")
  symbol: string; // Token symbol
  price: string; // Default price
}

// Define oracle providers
export type OracleProvider = "TELLOR"; // Using Tellor for local testing

// Export the feeds array
// Using Tellor-compatible feeds for local testing
export const tellorFeeds: OracleFeedConfig[] = [
  // Legacy feeds (kept for localhost/backwards compatibility)
  { name: "WSAGA_USD", symbol: "WSAGA", price: "0.30" },
  { name: "frxUSD_USD", symbol: "frxUSD", price: "1" },
  { name: "USDS_USD", symbol: "USDS", price: "1" },
  { name: "sfrxUSD_frxUSD", symbol: "sfrxUSD", price: "1.1" },
  { name: "sUSDS_USDS", symbol: "sUSDS", price: "1.1" },

  // Mainnet-aligned feeds
  { name: "USDC_USD", symbol: "USDC", price: "1" },
  { name: "USDT_USD", symbol: "USDT", price: "1" },
  { name: "USDN_USD", symbol: "USDN", price: "1" },
  { name: "SAGA_USD", symbol: "SAGA", price: "0.30" },
  { name: "yUSD_USD", symbol: "yUSD", price: "1.02" },
  { name: "vyUSD_USD", symbol: "vyUSD", price: "1.02" },
  { name: "sfrxUSD_USD", symbol: "sfrxUSD", price: "1.1" },
];

// Tellor oracle feeds for local testing

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  if (isMainnet(hre.network.name)) {
    throw new Error("WARNING - should not deploy mock oracles on mainnet");
  }

  // Track deployed mock oracles
  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleNameToProvider: Record<string, OracleProvider> = {};

  // Deploy individual MockChainlinkAggregatorV3 instances for each feed with 18 decimals (Tellor-compatible)
  for (const feed of tellorFeeds) {
    const mockOracleName = `MockTellorOracle_${feed.name}`;
    const mockOracle = await hre.deployments.deploy(mockOracleName, {
      from: deployer,
      args: [18, `${feed.name} Mock Oracle`], // 18 decimals for Tellor compatibility
      contract: "MockChainlinkAggregatorV3",
      autoMine: true,
      log: false,
    });

    // Get the deployed mock oracle contract
    const mockOracleContract = await hre.ethers.getContractAt("MockChainlinkAggregatorV3", mockOracle.address, signer);

    // Convert price to int256 format expected by Tellor (18 decimals)
    const priceInWei = hre.ethers.parseUnits(feed.price, 18); // Tellor uses 18 decimals
    console.log(`Setting mock price for ${feed.name} to ${priceInWei.toString()}`);
    await (await mockOracleContract.setMock(priceInWei, { gasLimit: 200_000 })).wait(); // wait so downstream sanity checks see the price

    // Store the deployment for config
    mockOracleNameToAddress[feed.name] = mockOracle.address;
    mockOracleNameToProvider[feed.name] = "TELLOR"; // Now using Tellor

    console.log(`Deployed ${mockOracleName} at ${mockOracle.address} with price ${feed.price}`);
  }

  // Store the mock oracle deployments in JSON files for the config to use
  await hre.deployments.save("MockOracleNameToAddress", {
    address: ZeroAddress,
    abi: [],
    linkedData: mockOracleNameToAddress,
  });

  await hre.deployments.save("MockOracleNameToProvider", {
    address: ZeroAddress,
    abi: [],
    linkedData: mockOracleNameToProvider,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "oracle"];
func.dependencies = ["tokens"];
func.id = "local_oracle_setup";

export default func;
