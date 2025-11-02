import { expect } from "chai";
import hre, { getNamedAccounts, ethers } from "hardhat";
import { Address } from "hardhat-deploy/types";
import { getOracleAggregatorFixture, OracleAggregatorFixtureResult } from "./fixtures";
import { getConfig } from "../../config/config";
import { OracleAggregator, MockOracleAggregator } from "../../typechain-types";
import { advanceTime, getCurrentTime, getFutureTime } from "./oracle-expiration.helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("OracleAggregator Price Override Expiration", () => {
  let deployer: Address;
  let guardian: Address;
  let user1: Address;

  before(async () => {
    ({ deployer, user1 } = await getNamedAccounts());
    guardian = deployer; // Use deployer as guardian for tests
  });

  // Run tests for each oracle aggregator configuration
  it("should run tests for each oracle aggregator", async () => {
    const config = await getConfig(hre);
    const currencies = Object.keys(config.oracleAggregators);

    // Run tests for each currency sequentially
    for (const currency of currencies) {
      await runTestsForCurrency(currency, { deployer, guardian, user1 });
    }
  });
});

async function runTestsForCurrency(
  currency: string,
  { deployer, guardian, user1 }: { deployer: Address; guardian: Address; user1: Address },
) {
  describe(`OracleAggregator Expiration Tests for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let oracleAggregator: OracleAggregator;
    let mockOracle: MockOracleAggregator;
    let testAsset: string;
    const overridePrice = ethers.parseEther("1500"); // 1500 USD per asset

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      oracleAggregator = fixtureResult.contracts.oracleAggregator;

      // Use first available asset or create a test asset address
      testAsset = fixtureResult.assets.allAssets[0] || ethers.Wallet.createRandom().address;

      // Deploy a mock oracle for testing
      const MockOracleAggregatorFactory = await ethers.getContractFactory("MockOracleAggregator");
      mockOracle = await MockOracleAggregatorFactory.deploy(
        fixtureResult.config.baseCurrency,
        BigInt(10) ** BigInt(fixtureResult.config.priceDecimals),
      );

      // Set a normal price for the test asset
      const normalPrice = ethers.parseEther("1000");
      await mockOracle.setAssetPrice(testAsset, normalPrice);

      // Set the oracle for the test asset
      const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
      await oracleAggregator.grantRole(oracleManagerRole, deployer);
      await oracleAggregator.setOracle(testAsset, await mockOracle.getAddress());

      // Grant GUARDIAN_ROLE to guardian
      const guardianRole = await oracleAggregator.GUARDIAN_ROLE();
      await oracleAggregator.grantRole(guardianRole, guardian);
    });

    describe("Freeze/Unfreeze Workflows", () => {
      it("should freeze asset and emit AssetFrozen event", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        await expect(oracleAggregator.connect(guardianSigner).freezeAsset(testAsset))
          .to.emit(oracleAggregator, "AssetFrozen")
          .withArgs(testAsset);

        expect(await oracleAggregator.isFrozen(testAsset)).to.be.true;
      });

      it("should unfreeze asset and emit AssetUnfrozen event", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Freeze first
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        // Then unfreeze
        await expect(oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset))
          .to.emit(oracleAggregator, "AssetUnfrozen")
          .withArgs(testAsset);

        expect(await oracleAggregator.isFrozen(testAsset)).to.be.false;
      });

      it("should revert getPriceInfo when asset is frozen without override", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        await expect(oracleAggregator.getPriceInfo(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride")
          .withArgs(testAsset);
      });

      it("should resume normal oracle lookup after unfreeze", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Freeze and set override
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        // Unfreeze
        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);

        // Should use normal oracle
        const [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        const normalPrice = await mockOracle.getAssetPrice(testAsset);
        expect(price).to.equal(normalPrice);
        expect(isAlive).to.be.true;
      });

      it("should revert when freezing already frozen asset", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        await expect(oracleAggregator.connect(guardianSigner).freezeAsset(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "AssetAlreadyFrozen")
          .withArgs(testAsset);
      });

      it("should revert when unfreezing non-frozen asset", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        await expect(oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "AssetNotFrozen")
          .withArgs(testAsset);
      });

      it("should only allow GUARDIAN_ROLE to freeze/unfreeze", async function () {
        const unauthorizedSigner = await ethers.getSigner(user1);

        await expect(oracleAggregator.connect(unauthorizedSigner).freezeAsset(testAsset)).to.be.revertedWithCustomError(
          oracleAggregator,
          "AccessControlUnauthorizedAccount",
        );

        // Freeze with guardian first
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        // Try to unfreeze without role
        await expect(oracleAggregator.connect(unauthorizedSigner).unfreezeAsset(testAsset)).to.be.revertedWithCustomError(
          oracleAggregator,
          "AccessControlUnauthorizedAccount",
        );
      });
    });

    describe("Price Override with Default Expiration", () => {
      it("should set override with default expiration (24 hours)", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const currentTime = await getCurrentTime();
        const defaultExpiration = await oracleAggregator.overrideExpirationTime();
        const expectedExpiresAt = currentTime + defaultExpiration;

        await expect(oracleAggregator.setPriceOverride(testAsset, overridePrice))
          .to.emit(oracleAggregator, "PriceOverrideSet")
          .withArgs(testAsset, overridePrice, (expiresAt: bigint) => {
            // Allow 1 second tolerance for block time advancement
            return expiresAt >= expectedExpiresAt && expiresAt <= expectedExpiresAt + 1n;
          });

        const override = await oracleAggregator.priceOverrides(testAsset);
        expect(override.price).to.equal(overridePrice);
        expect(override.expiresAt).to.be.gte(expectedExpiresAt);
      });

      it("should return override price with isAlive = false", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        const [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);
        expect(isAlive).to.be.false; // Overrides always return isAlive = false
      });

      it("should revert getAssetPrice for frozen asset (override has isAlive = false)", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        await expect(oracleAggregator.getAssetPrice(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "PriceNotAlive")
          .withArgs(testAsset);
      });

      it("should only allow setting override when asset is frozen", async function () {
        // Asset is not frozen
        await expect(oracleAggregator.setPriceOverride(testAsset, overridePrice))
          .to.be.revertedWithCustomError(oracleAggregator, "AssetNotFrozen")
          .withArgs(testAsset);
      });
    });

    describe("Price Override with Custom Expiration", () => {
      it("should set override with custom expiration time", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const currentTime = await getCurrentTime();
        const customExpiration = currentTime + 3600n; // 1 hour from now

        await expect(oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, customExpiration))
          .to.emit(oracleAggregator, "PriceOverrideSet")
          .withArgs(testAsset, overridePrice, customExpiration);

        const override = await oracleAggregator.priceOverrides(testAsset);
        expect(override.price).to.equal(overridePrice);
        expect(override.expiresAt).to.equal(customExpiration);
      });

      it("should revert when expiration is in the past", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const pastExpiration = (await getCurrentTime()) - 3600n; // 1 hour ago

        await expect(
          oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, pastExpiration),
        ).to.be.revertedWithCustomError(oracleAggregator, "InvalidExpirationTime");
      });

      it("should revert when expiration equals current time", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const currentTime = await getCurrentTime();

        await expect(
          oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, currentTime),
        ).to.be.revertedWithCustomError(oracleAggregator, "InvalidExpirationTime");
      });
    });

    describe("Expired Override Scenarios", () => {
      it("should revert getPriceInfo when override expires", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const currentTime = await getCurrentTime();
        const shortExpiration = currentTime + 60n; // 1 minute from now

        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, shortExpiration);

        // Override should be valid initially
        const [price, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);
        expect(isAlive).to.be.false;

        // Advance time past expiration
        await advanceTime(61n); // 1 minute + 1 second

        // Should revert with NoPriceOverride
        await expect(oracleAggregator.getPriceInfo(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride")
          .withArgs(testAsset);
      });

      it("should handle override expiring exactly at block.timestamp", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const currentTime = await getCurrentTime();
        const exactExpiration = currentTime + 60n; // 1 minute from now

        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, exactExpiration);

        // Verify override is valid initially
        let [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);

        // Advance time past expiration (the check is expiresAt > block.timestamp)
        // So when block.timestamp >= expiresAt, it's expired
        await advanceTime(61n); // Advance by 61 seconds to pass the 60-second expiration

        // Should revert (expiresAt > block.timestamp is false when block.timestamp >= expiresAt)
        await expect(oracleAggregator.getPriceInfo(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride")
          .withArgs(testAsset);
      });
    });

    describe("Override Update Scenarios", () => {
      it("should replace existing override with new override", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const firstPrice = overridePrice;
        const secondPrice = ethers.parseEther("2000");

        // Set first override
        await oracleAggregator.setPriceOverride(testAsset, firstPrice);

        // Set second override (should replace first)
        await oracleAggregator.setPriceOverride(testAsset, secondPrice);

        const [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(secondPrice);
      });

      it("should update expiration time when setting new override", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const currentTime = await getCurrentTime();
        const firstExpiration = currentTime + 3600n; // 1 hour
        const secondExpiration = currentTime + 7200n; // 2 hours

        // Set first override
        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, firstExpiration);

        // Set second override with different expiration
        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, secondExpiration);

        const override = await oracleAggregator.priceOverrides(testAsset);
        expect(override.expiresAt).to.equal(secondExpiration);
      });
    });

    describe("clearPriceOverride", () => {
      it("should clear override and emit PriceOverrideCleared event", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        await expect(oracleAggregator.clearPriceOverride(testAsset)).to.emit(oracleAggregator, "PriceOverrideCleared").withArgs(testAsset);

        // Should revert when trying to get price (no override)
        await expect(oracleAggregator.getPriceInfo(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride")
          .withArgs(testAsset);
      });

      it("should allow ORACLE_MANAGER_ROLE or GUARDIAN_ROLE to clear override", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        // Guardian can clear
        await oracleAggregator.connect(guardianSigner).clearPriceOverride(testAsset);

        // Set override again
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        // Oracle manager can also clear
        await oracleAggregator.clearPriceOverride(testAsset);

        await expect(oracleAggregator.getPriceInfo(testAsset)).to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride");
      });
    });

    describe("setOverrideExpirationTime", () => {
      it("should update default expiration time", async function () {
        const newExpirationTime = 3600n; // 1 hour

        await expect(oracleAggregator.setOverrideExpirationTime(newExpirationTime))
          .to.emit(oracleAggregator, "OverrideExpirationTimeUpdated")
          .withArgs(newExpirationTime);

        expect(await oracleAggregator.overrideExpirationTime()).to.equal(newExpirationTime);
      });

      it("should use new expiration time for new overrides", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const newExpirationTime = 3600n; // 1 hour
        await oracleAggregator.setOverrideExpirationTime(newExpirationTime);

        const currentTime = await getCurrentTime();
        const expectedExpiresAt = currentTime + newExpirationTime;

        await oracleAggregator.setPriceOverride(testAsset, overridePrice);

        const override = await oracleAggregator.priceOverrides(testAsset);
        expect(override.expiresAt).to.be.gte(expectedExpiresAt);
        expect(override.expiresAt).to.be.lte(expectedExpiresAt + 1n); // Allow 1 second tolerance
      });

      it("should not affect existing overrides when expiration time changes", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const currentTime = await getCurrentTime();
        const originalExpiration = currentTime + 7200n; // 2 hours

        // Set override with original expiration
        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, originalExpiration);

        // Change default expiration time
        await oracleAggregator.setOverrideExpirationTime(3600n); // 1 hour

        // Existing override should keep original expiration
        const override = await oracleAggregator.priceOverrides(testAsset);
        expect(override.expiresAt).to.equal(originalExpiration);
      });

      it("should only allow ORACLE_MANAGER_ROLE to change expiration time", async function () {
        const unauthorizedSigner = await ethers.getSigner(user1);

        await expect(oracleAggregator.connect(unauthorizedSigner).setOverrideExpirationTime(3600n)).to.be.revertedWithCustomError(
          oracleAggregator,
          "AccessControlUnauthorizedAccount",
        );
      });
    });

    describe("Boundary Conditions", () => {
      it("should handle override expiring 1 second in the future", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const currentTime = await getCurrentTime();
        // Need at least 1 second in the future (strictly greater check)
        const oneSecondFuture = currentTime + 2n; // 2 seconds to account for block time advancement

        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, oneSecondFuture);

        // Should be valid
        const [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);

        // Advance 1 second
        await advanceTime(1n);

        // Should be expired
        await expect(oracleAggregator.getPriceInfo(testAsset)).to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride");
      });

      it("should handle override with price = 0 (should be invalid)", async function () {
        const guardianSigner = await ethers.getSigner(guardian);
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        const zeroPrice = 0n;
        const currentTime = await getCurrentTime();
        const expiration = currentTime + 3600n;

        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, zeroPrice, expiration);

        // Should revert (price > 0 check in contract)
        await expect(oracleAggregator.getPriceInfo(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride")
          .withArgs(testAsset);
      });
    });

    describe("Complex Workflows", () => {
      it("should handle freeze → override → expire → unfreeze workflow", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // Freeze
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);

        // Set override with short expiration
        const currentTime = await getCurrentTime();
        const shortExpiration = currentTime + 60n; // 1 minute
        await oracleAggregator["setPriceOverride(address,uint256,uint256)"](testAsset, overridePrice, shortExpiration);

        // Verify override works
        let [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(overridePrice);

        // Advance time to expire
        await advanceTime(61n);

        // Should revert (expired)
        await expect(oracleAggregator.getPriceInfo(testAsset)).to.be.revertedWithCustomError(oracleAggregator, "NoPriceOverride");

        // Unfreeze
        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);

        // Should resume normal oracle lookup
        const [normalPrice, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
        const expectedPrice = await mockOracle.getAssetPrice(testAsset);
        expect(normalPrice).to.equal(expectedPrice);
        expect(isAlive).to.be.true;
      });

      it("should handle multiple freeze/unfreeze cycles", async function () {
        const guardianSigner = await ethers.getSigner(guardian);

        // First cycle
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        await oracleAggregator.setPriceOverride(testAsset, overridePrice);
        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);

        // Verify normal lookup works
        let [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.not.equal(overridePrice);

        // Second cycle
        await oracleAggregator.connect(guardianSigner).freezeAsset(testAsset);
        const newOverridePrice = ethers.parseEther("2500");
        await oracleAggregator.setPriceOverride(testAsset, newOverridePrice);

        [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.equal(newOverridePrice);

        await oracleAggregator.connect(guardianSigner).unfreezeAsset(testAsset);

        // Normal lookup should work again
        [price] = await oracleAggregator.getPriceInfo(testAsset);
        expect(price).to.not.equal(newOverridePrice);
      });
    });
  });
}
