import { ethers } from "hardhat";
import { MockChainlinkAggregatorV3 } from "../../typechain-types";

/**
 * Creates a mock Tellor feed that implements LiquityV2OracleAggregatorV3Interface
 * @param price The price value (will be converted to int256)
 * @param updatedAt The timestamp when the price was last updated
 * @param decimals The number of decimals (default: 18 to match BASE_CURRENCY_DECIMALS)
 * @returns Deployed mock feed contract
 */
export async function createMockTellorFeed(price: bigint, updatedAt: bigint, decimals: number = 18): Promise<MockChainlinkAggregatorV3> {
  const MockFeedFactory = await ethers.getContractFactory("MockChainlinkAggregatorV3");
  const mockFeed = await MockFeedFactory.deploy(decimals, "Mock Tellor Feed");

  // Set the price with specific timestamp
  // The contract expects int256 for price and uint256 for timestamp
  // We can pass bigint directly - ethers will handle the conversion
  await mockFeed.setMockWithTimestamp(price, updatedAt);

  return mockFeed;
}

/**
 * Creates a mock feed with price updated at current block timestamp minus specified seconds
 * @param price The price value
 * @param secondsAgo How many seconds ago the price was updated
 * @param decimals The number of decimals (default: 18)
 * @returns Deployed mock feed contract
 */
export async function createMockTellorFeedWithAge(
  price: bigint,
  secondsAgo: bigint,
  decimals: number = 18,
): Promise<MockChainlinkAggregatorV3> {
  const currentTime = BigInt(await ethers.provider.getBlock("latest").then((b) => b!.timestamp));
  const updatedAt = currentTime - secondsAgo;
  return createMockTellorFeed(price, updatedAt, decimals);
}

/**
 * Creates a mock feed with fresh price (updated now)
 * @param price The price value
 * @param decimals The number of decimals (default: 18)
 * @returns Deployed mock feed contract
 */
export async function createMockTellorFeedFresh(price: bigint, decimals: number = 18): Promise<MockChainlinkAggregatorV3> {
  const currentTime = BigInt(await ethers.provider.getBlock("latest").then((b) => b!.timestamp));
  return createMockTellorFeed(price, currentTime, decimals);
}

/**
 * Updates an existing mock feed with new price and timestamp
 * @param mockFeed The mock feed contract
 * @param price The new price value
 * @param updatedAt The new timestamp
 */
export async function updateMockTellorFeed(mockFeed: MockChainlinkAggregatorV3, price: bigint, updatedAt: bigint): Promise<void> {
  // Pass bigint directly - ethers will handle the conversion
  await mockFeed.setMockWithTimestamp(price, updatedAt);
}
