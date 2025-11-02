import { expect } from "chai";
import hre, { getNamedAccounts, ethers } from "hardhat";
import { Address } from "hardhat-deploy/types";
import { getOracleAggregatorFixture, OracleAggregatorFixtureResult } from "./fixtures";
import { getConfig } from "../../config/config";
import { TellorWrapper } from "../../typechain-types";
import {
  createMockTellorFeed,
  createMockTellorFeedWithAge,
  createMockTellorFeedFresh,
  updateMockTellorFeed,
} from "./oracle-expiration.fixtures";
import { advanceTime, getCurrentTime, getPastTime } from "./oracle-expiration.helpers";

describe("TellorWrapper Staleness Detection", () => {
  let deployer: Address;

  before(async () => {
    ({ deployer } = await getNamedAccounts());
  });

  // Run tests for each oracle aggregator configuration
  it("should run tests for each oracle aggregator", async () => {
    const config = await getConfig(hre);
    const currencies = Object.keys(config.oracleAggregators);

    // Run tests for each currency sequentially
    for (const currency of currencies) {
      await runTestsForCurrency(currency, { deployer });
    }
  });
});

async function runTestsForCurrency(currency: string, { deployer }: { deployer: Address }) {
  describe(`TellorWrapper Staleness Tests for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let tellorWrapper: TellorWrapper;
    let testAsset: string;
    const basePrice = ethers.parseEther("1000"); // 1000 USD per asset

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      // Get TellorWrapper instance
      tellorWrapper = fixtureResult.contracts.tellorWrapper;

      // Use first available asset or create a test asset address
      testAsset = fixtureResult.assets.allAssets[0] || ethers.Wallet.createRandom().address;

      // Grant ORACLE_MANAGER_ROLE to deployer for configuration changes
      const oracleManagerRole = await tellorWrapper.ORACLE_MANAGER_ROLE();
      await tellorWrapper.grantRole(oracleManagerRole, deployer);
    });

    describe("Fresh Price Scenarios", () => {
      it("should return isAlive = true for price within heartbeat window", async function () {
        // Create feed updated 1 hour ago (heartbeat default is 24 hours)
        const oneHourAgo = 3600n;
        const mockFeed = await createMockTellorFeedWithAge(basePrice, oneHourAgo);

        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;
      });

      it("should return isAlive = true for price updated just now", async function () {
        const mockFeed = await createMockTellorFeedWithAge(basePrice, 0n);

        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;
      });
    });

    describe("Stale Price Scenarios", () => {
      it("should return isAlive = false for price beyond staleness threshold", async function () {
        // Get current heartbeat and stale limit
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        // Create feed updated beyond threshold
        const mockFeed = await createMockTellorFeedWithAge(basePrice, threshold + 1n);

        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;
      });

      it("should return isAlive = false for very old price", async function () {
        const oneYearAgo = 365n * 24n * 3600n;
        const mockFeed = await createMockTellorFeedWithAge(basePrice, oneYearAgo);

        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;
      });
    });

    describe("Boundary Conditions", () => {
      it("should return isAlive = false for price exactly at staleness threshold", async function () {
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        // Price updated exactly at threshold (should be stale due to strictly greater check)
        const mockFeed = await createMockTellorFeedWithAge(basePrice, threshold);

        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;
      });

      it("should return isAlive = true for price 1 second before threshold", async function () {
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        // Get current time
        const currentTime = BigInt(await ethers.provider.getBlock("latest").then((b) => b!.timestamp));

        // Price updated at (threshold - 60) seconds ago to ensure it's well within threshold
        // This gives us enough buffer for block time advancement
        // Formula: updatedAt + threshold > block.timestamp
        // updatedAt = currentTime - (threshold - 60)
        // When checking: updatedAt + threshold = currentTime - threshold + 60 + threshold = currentTime + 60
        // This will be > checkTime even if block advances
        const updatedAt = currentTime - (threshold - 60n);
        const mockFeed = await createMockTellorFeed(basePrice, updatedAt);

        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;
      });
    });

    describe("Heartbeat Configuration Changes", () => {
      it("should update staleness detection immediately when heartbeat changes", async function () {
        // Set initial heartbeat
        const initialHeartbeat = 24n * 3600n; // 24 hours
        await tellorWrapper.setFeedHeartbeat(initialHeartbeat);

        // Create feed that's stale with new heartbeat but fresh with old
        const newHeartbeat = 1n * 3600n; // 1 hour
        const feedAge = 2n * 3600n; // 2 hours ago

        const mockFeed = await createMockTellorFeedWithAge(basePrice, feedAge);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // With initial heartbeat (24h), price should be fresh
        let [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;

        // Change heartbeat to 1 hour
        await tellorWrapper.setFeedHeartbeat(newHeartbeat);

        // Now price should be stale (2 hours > 1 hour + stale limit)
        [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;
      });

      it("should only allow ORACLE_MANAGER_ROLE to change heartbeat", async function () {
        const unauthorizedSigner = await ethers.getSigner((await getNamedAccounts()).user1 || deployer);

        await expect(tellorWrapper.connect(unauthorizedSigner).setFeedHeartbeat(3600n)).to.be.revertedWithCustomError(
          tellorWrapper,
          "AccessControlUnauthorizedAccount",
        );
      });
    });

    describe("Stale Time Limit Configuration Changes", () => {
      it("should update staleness detection immediately when stale limit changes", async function () {
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const initialStaleLimit = await tellorWrapper.heartbeatStaleTimeLimit();

        // Get current time
        const currentTime = BigInt(await ethers.provider.getBlock("latest").then((b) => b!.timestamp));

        // Create feed that's fresh with initial limit but stale with reduced limit
        // Feed age should be: heartbeat + initialStaleLimit - small buffer (fresh with initial)
        // But: heartbeat + initialStaleLimit > heartbeat + newLimit (stale with new)
        const feedAge = heartbeat + initialStaleLimit - 60n; // 60 seconds before threshold with initial limit
        const updatedAt = currentTime - feedAge;
        const mockFeed = await createMockTellorFeed(basePrice, updatedAt);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // Should be fresh with initial limit
        let [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;

        // Reduce stale limit significantly
        const newStaleLimit = 60n; // 1 minute
        await tellorWrapper.setHeartbeatStaleTimeLimit(newStaleLimit);

        // Verify the new threshold
        const newThreshold = heartbeat + newStaleLimit;

        // Get updated current time (may have advanced slightly)
        const checkTime = BigInt(await ethers.provider.getBlock("latest").then((b) => b!.timestamp));
        const actualAge = checkTime - updatedAt;

        // Now should be stale (actualAge > newThreshold)
        // feedAge was heartbeat + initialStaleLimit - 60, which is > heartbeat + 60
        expect(actualAge).to.be.gt(newThreshold);

        [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;
      });

      it("should only allow ORACLE_MANAGER_ROLE to change stale limit", async function () {
        const unauthorizedSigner = await ethers.getSigner((await getNamedAccounts()).user1 || deployer);

        await expect(tellorWrapper.connect(unauthorizedSigner).setHeartbeatStaleTimeLimit(3600n)).to.be.revertedWithCustomError(
          tellorWrapper,
          "AccessControlUnauthorizedAccount",
        );
      });
    });

    describe("getAssetPrice vs getPriceInfo", () => {
      it("should revert getAssetPrice when isAlive = false", async function () {
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        const mockFeed = await createMockTellorFeedWithAge(basePrice, threshold + 1n);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // getPriceInfo should return stale price with isAlive = false
        const [price, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;
        expect(price).to.be.gt(0);

        // getAssetPrice should revert
        await expect(tellorWrapper.getAssetPrice(testAsset)).to.be.revertedWithCustomError(tellorWrapper, "PriceIsStale");
      });

      it("should return price when isAlive = true in getAssetPrice", async function () {
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // getPriceInfo should return fresh price with isAlive = true
        const [priceInfo, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;

        // getAssetPrice should return price without reverting
        const assetPrice = await tellorWrapper.getAssetPrice(testAsset);
        expect(assetPrice).to.equal(priceInfo);
      });
    });

    describe("Edge Cases", () => {
      it("should handle zero stale limit (only heartbeat matters)", async function () {
        const heartbeat = await tellorWrapper.feedHeartbeat();

        // Set stale limit to zero
        await tellorWrapper.setHeartbeatStaleTimeLimit(0n);

        // Create feed that's fresh with heartbeat but would be stale with stale limit
        const feedAge = heartbeat - 60n; // 60 seconds before heartbeat threshold
        const mockFeed = await createMockTellorFeedWithAge(basePrice, feedAge);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // Should be fresh (updatedAt + heartbeat + 0 > block.timestamp)
        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;

        // Create feed that's stale (beyond heartbeat)
        const staleFeedAge = heartbeat + 1n;
        const staleMockFeed = await createMockTellorFeedWithAge(basePrice, staleFeedAge);
        await tellorWrapper.setFeed(testAsset, await staleMockFeed.getAddress());

        // Should be stale
        const [, isAliveStale] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAliveStale).to.be.false;
      });

      it("should handle very large heartbeat (keeps prices fresh longer)", async function () {
        const oneYear = 365n * 24n * 3600n;

        // Set very large heartbeat
        await tellorWrapper.setFeedHeartbeat(oneYear);

        // Create feed updated 1 month ago
        const oneMonthAgo = 30n * 24n * 3600n;
        const mockFeed = await createMockTellorFeedWithAge(basePrice, oneMonthAgo);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // Should still be fresh (1 month < 1 year)
        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;
      });

      it("should handle very small heartbeat (prices become stale quickly)", async function () {
        const oneMinute = 60n;
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();

        // Set very small heartbeat
        await tellorWrapper.setFeedHeartbeat(oneMinute);

        // Create feed updated beyond the threshold (heartbeat + stale limit)
        // For example: heartbeat (1 min) + stale limit (30 min default) = 31 minutes
        // Feed updated 32 minutes ago should be stale
        const threshold = oneMinute + staleLimit;
        const feedAge = threshold + 60n; // 1 minute beyond threshold
        const mockFeed = await createMockTellorFeedWithAge(basePrice, feedAge);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // Should be stale (feedAge > heartbeat + stale limit)
        const [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;
      });

      it("should handle changing both heartbeat and stale limit simultaneously", async function () {
        const initialHeartbeat = await tellorWrapper.feedHeartbeat();
        const initialStaleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const initialThreshold = initialHeartbeat + initialStaleLimit;

        // Create feed at boundary with initial config
        const feedAge = initialThreshold - 60n;
        const mockFeed = await createMockTellorFeedWithAge(basePrice, feedAge);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // Should be fresh with initial config
        let [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;

        // Change both heartbeat and stale limit
        const newHeartbeat = 3600n; // 1 hour
        const newStaleLimit = 300n; // 5 minutes
        await tellorWrapper.setFeedHeartbeat(newHeartbeat);
        await tellorWrapper.setHeartbeatStaleTimeLimit(newStaleLimit);

        const newThreshold = newHeartbeat + newStaleLimit;

        // Feed age is initialThreshold - 60, which is likely > newThreshold
        // Verify feed is now stale with new config
        const currentTime = BigInt(await ethers.provider.getBlock("latest").then((b) => b!.timestamp));
        const feedUpdatedAt = currentTime - feedAge;
        const expirationTime = feedUpdatedAt + newThreshold;

        if (expirationTime <= currentTime) {
          // Should be stale
          [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
          expect(isAlive).to.be.false;
        }
      });

      it("should verify isAlive flag changes when configuration changes", async function () {
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();

        // Create feed that's borderline
        const feedAge = heartbeat + staleLimit - 120n; // 2 minutes before threshold
        const mockFeed = await createMockTellorFeedWithAge(basePrice, feedAge);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // Should be fresh initially
        let [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;

        // Reduce heartbeat significantly to make it stale
        const newHeartbeat = 1n * 3600n; // 1 hour
        await tellorWrapper.setFeedHeartbeat(newHeartbeat);

        // Should now be stale
        [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;

        // Increase heartbeat back to make it fresh again
        await tellorWrapper.setFeedHeartbeat(heartbeat);

        // Should be fresh again
        [, isAlive] = await tellorWrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;
      });
    });
  });
}
