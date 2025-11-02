import { expect } from "chai";
import hre, { getNamedAccounts, ethers } from "hardhat";
import { Address } from "hardhat-deploy/types";
import { getOracleAggregatorFixture, OracleAggregatorFixtureResult } from "./fixtures";
import { getConfig } from "../../config/config";
import { OracleAggregator, TellorWrapper } from "../../typechain-types";
import { createMockTellorFeed, createMockTellorFeedWithAge, createMockTellorFeedFresh } from "./oracle-expiration.fixtures";
import { advanceTime, getCurrentTime } from "./oracle-expiration.helpers";

describe("OracleAggregator + TellorWrapper Integration", () => {
  let deployer: Address;
  let guardian: Address;

  before(async () => {
    ({ deployer } = await getNamedAccounts());
    guardian = deployer; // Use deployer as guardian for tests
  });

  // Run tests for each oracle aggregator configuration
  it("should run tests for each oracle aggregator", async () => {
    const config = await getConfig(hre);
    const currencies = Object.keys(config.oracleAggregators);

    // Run tests for each currency sequentially
    for (const currency of currencies) {
      await runTestsForCurrency(currency, { deployer, guardian });
    }
  });
});

async function runTestsForCurrency(currency: string, { deployer, guardian }: { deployer: Address; guardian: Address }) {
  describe(`OracleAggregator + TellorWrapper Integration for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let oracleAggregator: OracleAggregator;
    let tellorWrapper: TellorWrapper;
    let testAsset: string;
    const basePrice = ethers.parseEther("1000"); // 1000 USD per asset

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      oracleAggregator = fixtureResult.contracts.oracleAggregator;
      tellorWrapper = fixtureResult.contracts.tellorWrapper;

      // Use first available asset or create a test asset address
      testAsset = fixtureResult.assets.allAssets[0] || ethers.Wallet.createRandom().address;

      // Grant roles
      const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
      await oracleAggregator.grantRole(oracleManagerRole, deployer);

      const tellorManagerRole = await tellorWrapper.ORACLE_MANAGER_ROLE();
      await tellorWrapper.grantRole(tellorManagerRole, deployer);

      const guardianRole = await oracleAggregator.GUARDIAN_ROLE();
      await oracleAggregator.grantRole(guardianRole, guardian);
    });

    describe("Task 5.1: Fresh Price Flow", () => {
      it("should return fresh price from TellorWrapper through OracleAggregator", async function () {
        // Create fresh mock feed
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());

        // Set TellorWrapper as oracle for the asset
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Get price through OracleAggregator
        const [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);

        // Should return fresh price with isAlive = true
        expect(price).to.equal(basePrice);
        expect(isAlive).to.be.true;
      });

      it("should return fresh price from getAssetPrice", async function () {
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // getAssetPrice should work with fresh prices
        const price = await oracleAggregator.getAssetPrice(testAsset);
        expect(price).to.equal(basePrice);
      });

      it("should handle multiple assets with fresh prices", async function () {
        const asset1 = fixtureResult.assets.allAssets[0] || ethers.Wallet.createRandom().address;
        const asset2 = fixtureResult.assets.allAssets[1] || ethers.Wallet.createRandom().address;

        const price1 = ethers.parseEther("1500");
        const price2 = ethers.parseEther("2000");

        // Set up first asset
        const mockFeed1 = await createMockTellorFeedFresh(price1);
        await tellorWrapper.setFeed(asset1, await mockFeed1.getAddress());
        await oracleAggregator.setOracle(asset1, await tellorWrapper.getAddress());

        // Set up second asset
        const mockFeed2 = await createMockTellorFeedFresh(price2);
        await tellorWrapper.setFeed(asset2, await mockFeed2.getAddress());
        await oracleAggregator.setOracle(asset2, await tellorWrapper.getAddress());

        // Verify both assets return correct prices
        const [p1, alive1] = await oracleAggregator.getPriceInfo(asset1);
        const [p2, alive2] = await oracleAggregator.getPriceInfo(asset2);

        expect(p1).to.equal(price1);
        expect(p2).to.equal(price2);
        expect(alive1).to.be.true;
        expect(alive2).to.be.true;
      });
    });

    describe("Task 5.2: Stale Price Flow", () => {
      it("should propagate stale price from TellorWrapper through OracleAggregator", async function () {
        // Get heartbeat and stale limit
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        // Create stale mock feed
        const mockFeed = await createMockTellorFeedWithAge(basePrice, threshold + 1n);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Get price through OracleAggregator
        const [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);

        // Should return stale price with isAlive = false
        expect(price).to.equal(basePrice);
        expect(isAlive).to.be.false;
      });

      it("should revert getAssetPrice when TellorWrapper price is stale", async function () {
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        const mockFeed = await createMockTellorFeedWithAge(basePrice, threshold + 1n);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // getAssetPrice should revert with PriceNotAlive
        await expect(oracleAggregator.getAssetPrice(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "PriceNotAlive")
          .withArgs(testAsset);
      });

      it("should handle transition from fresh to stale", async function () {
        // Start with fresh price
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        let [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(isAlive).to.be.true;

        // Make price stale by advancing time
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        // Update feed to be stale
        const currentTime = await getCurrentTime();
        const staleUpdatedAt = currentTime - threshold - 1n;
        await mockFeed.setMockWithTimestamp(basePrice, staleUpdatedAt);

        // Should now be stale
        [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(basePrice);
        expect(isAlive).to.be.false;
      });
    });

    describe("Task 5.3: Frozen Asset with TellorWrapper", () => {
      it("should return override price when asset is frozen, ignoring TellorWrapper", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Set up TellorWrapper with fresh price
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Verify normal lookup works
        let [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(basePrice);
        expect(isAlive).to.be.true;

        // Freeze asset
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        // Set override price
        const overridePrice = ethers.parseEther("1500");
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        // Should return override price, not TellorWrapper price
        [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);
        expect(isAlive).to.be.false; // Overrides always return isAlive = false
      });

      it("should ignore TellorWrapper staleness when override is active", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Set up TellorWrapper with stale price
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        const mockFeed = await createMockTellorFeedWithAge(basePrice, threshold + 1n);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Freeze and set override
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const overridePrice = ethers.parseEther("2000");
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        // Override should work even though TellorWrapper is stale
        const [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);
        expect(isAlive).to.be.false;
      });

      it("should resume TellorWrapper lookup after unfreeze", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Set up TellorWrapper
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Freeze and set override
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const overridePrice = ethers.parseEther("1500");
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        // Verify override works
        let [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);

        // Unfreeze
        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);

        // Should resume TellorWrapper lookup
        [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(basePrice); // Back to TellorWrapper price
      });

      it("should revert when frozen without override, even if TellorWrapper is fresh", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Set up TellorWrapper with fresh price
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Freeze without setting override
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        // Should revert even though TellorWrapper is fresh
        await expect(oracleAggregator.getPriceInfo(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride")
          .withArgs(testAsset);
      });
    });

    describe("Task 5.4: Override Expiration with TellorWrapper", () => {
      it("should revert when override expires, even if TellorWrapper is fresh", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Set up TellorWrapper with fresh price
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Freeze and set override with short expiration
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const overridePrice = ethers.parseEther("1500");
        const currentTime = await getCurrentTime();
        const shortExpiration = currentTime + 60n; // 1 minute

        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, shortExpiration);

        // Override should work initially
        let [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);

        // Advance time past expiration
        await advanceTime(61n);

        // Should revert even though TellorWrapper is fresh (asset is still frozen)
        await expect(oracleAggregator.getPriceInfo(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride")
          .withArgs(testAsset);
      });

      it("should revert when override expires, even if TellorWrapper is stale", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Set up TellorWrapper with stale price
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;

        const mockFeed = await createMockTellorFeedWithAge(basePrice, threshold + 1n);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Freeze and set override
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const overridePrice = ethers.parseEther("1500");
        const currentTime = await getCurrentTime();
        const shortExpiration = currentTime + 60n;

        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, shortExpiration);

        // Override should work initially
        let [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);

        // Advance time past expiration
        await advanceTime(61n);

        // Should revert (asset still frozen, override expired)
        await expect(oracleAggregator.getPriceInfo(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride")
          .withArgs(testAsset);
      });

      it("should allow new override after expiration", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Set up TellorWrapper
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Freeze and set override with short expiration
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const firstOverride = ethers.parseEther("1500");
        const currentTime = await getCurrentTime();
        const shortExpiration = currentTime + 60n;

        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, firstOverride, shortExpiration);

        // Let it expire
        await advanceTime(61n);

        // Set new override
        const secondOverride = ethers.parseEther("2000");
        const newExpiration = (await getCurrentTime()) + 3600n; // 1 hour
        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, secondOverride, newExpiration);

        // New override should work
        const [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(secondOverride);
      });
    });

    describe("Task 5.5: Complete Workflow", () => {
      /**
       * Complete end-to-end workflow test covering all state transitions:
       * 1. Normal operation with fresh TellorWrapper price
       * 2. Freeze asset (blocks normal oracle lookup)
       * 3. Set price override (allows frozen asset to return price)
       * 4. Override expiration (frozen asset without valid override reverts)
       * 5. Unfreeze asset (resumes normal oracle lookup)
       * 6. Verify normal operation restored
       */
      it("should handle complete workflow: fresh → freeze → override → expire → unfreeze → fresh", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Step 1: Initial state - TellorWrapper fresh
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        let [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(basePrice);
        expect(isAlive).to.be.true;

        // Step 2: Freeze asset (blocks normal oracle lookup)
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        // Should revert without override (frozen assets require override)
        await expect(oracleAggregator.getPriceInfo(testAsset)).to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride");

        // Step 3: Set override (allows frozen asset to return price)
        const overridePrice = ethers.parseEther("1500");
        const currentTime = await getCurrentTime();
        const expiration = currentTime + 60n; // 1 minute

        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, expiration);

        [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);
        expect(isAlive).to.be.false; // Overrides always return isAlive = false

        // Step 4: Override expires (frozen asset without valid override reverts)
        await advanceTime(61n);

        await expect(oracleAggregator.getPriceInfo(testAsset)).to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride");

        // Step 5: Unfreeze (resumes normal oracle lookup)
        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);

        // Step 6: Resume TellorWrapper lookup (normal operation restored)
        [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(basePrice);
        expect(isAlive).to.be.true;
      });

      it("should handle workflow with TellorWrapper becoming stale during freeze", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Start with fresh TellorWrapper
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // Freeze and set override
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const overridePrice = ethers.parseEther("1500");
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        // Make TellorWrapper stale (shouldn't affect override)
        const heartbeat = await tellorWrapper.feedHeartbeat();
        const staleLimit = await tellorWrapper.heartbeatStaleTimeLimit();
        const threshold = heartbeat + staleLimit;
        const currentTime = await getCurrentTime();
        const staleUpdatedAt = currentTime - threshold - 1n;
        await mockFeed.setMockWithTimestamp(basePrice, staleUpdatedAt);

        // Override should still work
        let [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);

        // Unfreeze - now TellorWrapper is stale
        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);

        // Should propagate staleness
        const [finalPrice, finalIsAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(finalPrice).to.equal(basePrice);
        expect(finalIsAlive).to.be.false;
      });

      it("should handle multiple freeze/unfreeze cycles with TellorWrapper", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Set up TellorWrapper
        const mockFeed = await createMockTellorFeedFresh(basePrice);
        await tellorWrapper.setFeed(testAsset, await mockFeed.getAddress());
        await oracleAggregator.setOracle(testAsset, await tellorWrapper.getAddress());

        // First cycle
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const override1 = ethers.parseEther("1500");
        await oracleAggregator.setPriceOverride(testAsset, override1);

        let [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(override1);

        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);
        [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(basePrice);

        // Second cycle
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const override2 = ethers.parseEther("2000");
        await oracleAggregator.setPriceOverride(testAsset, override2);

        [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(override2);

        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);
        [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(basePrice);
      });
    });
  });
}
