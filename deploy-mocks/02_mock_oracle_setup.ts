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
export type OracleProvider = "REDSTONE"; // Only Redstone now

// Export the feeds array
// api3Feeds is removed as all feeds are now Redstone
export const redstoneFeeds: OracleFeedConfig[] = [
  // USD price feeds
  { name: "WSAGA_USD", symbol: "WSAGA", price: "0.30" },
  { name: "frxUSD_USD", symbol: "frxUSD", price: "1" },
  { name: "USDC_USD", symbol: "USDC", price: "1" },
  { name: "USDS_USD", symbol: "USDS", price: "1" },

  // Vault feeds
  { name: "sfrxUSD_frxUSD", symbol: "sfrxUSD", price: "1.1" },
  { name: "sUSDS_USDS", symbol: "sUSDS", price: "1.1" },
];

// Redstone oracle feeds - This array is now merged into redstoneFeeds above
// export const redstoneFeeds: OracleFeedConfig[] = [...]; // Removed

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  if (isMainnet(hre.network.name)) {
    throw new Error("WARNING - should not deploy mock oracles on mainnet");
  }

  // Deploy a mock API3 server V1 (this would be the actual API3 server on mainnet) - Removed
  // const mockAPI3ServerV1 = await hre.deployments.deploy("MockAPI3ServerV1", { ... }); // Removed

  // Track deployed mock oracles
  const mockOracleNameToAddress: Record<string, string> = {};
  const mockOracleNameToProvider: Record<string, OracleProvider> = {};

  // Deploy individual MockAPI3OracleAlwaysAlive instances for each feed - Removed
  // for (const feed of api3Feeds) { ... } // Removed loop

  // Deploy individual MockRedstoneChainlinkOracleAlwaysAlive instances for each Redstone feed
  for (const feed of redstoneFeeds) {
    const mockOracleName = `MockRedstoneChainlinkOracleAlwaysAlive_${feed.name}`;
    const mockOracle = await hre.deployments.deploy(mockOracleName, {
      from: deployer,
      args: [],
      contract: "MockRedstoneChainlinkOracleAlwaysAlive",
      autoMine: true,
      log: false,
    });

    // Get the deployed mock oracle contract
    const mockOracleContract = await hre.ethers.getContractAt(
      "MockRedstoneChainlinkOracleAlwaysAlive",
      mockOracle.address,
      signer
    );

    // Convert price to int256 format expected by Redstone (8 decimals)
    const priceInWei = hre.ethers.parseUnits(feed.price, 8); // Redstone uses 8 decimals
    await mockOracleContract.setMock(priceInWei);

    // Store the deployment for config
    mockOracleNameToAddress[feed.name] = mockOracle.address;
    mockOracleNameToProvider[feed.name] = "REDSTONE"; // All are Redstone now

    console.log(
      `Deployed ${mockOracleName} at ${mockOracle.address} with price ${feed.price}`
    );
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
