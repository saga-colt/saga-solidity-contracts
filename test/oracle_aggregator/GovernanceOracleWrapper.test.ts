import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { GovernanceOracleWrapper, OracleAggregator } from "../../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("GovernanceOracleWrapper", () => {
  let wrapper: GovernanceOracleWrapper;
  let deployer: SignerWithAddress;
  let oracleManager: SignerWithAddress;
  let guardian: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  const INITIAL_PRICE = ethers.parseUnits("0.995", 18);
  const BASE_CURRENCY = ethers.ZeroAddress;
  const BASE_CURRENCY_UNIT = ethers.parseUnits("1", 18);

  beforeEach(async () => {
    [deployer, oracleManager, guardian, unauthorized] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("GovernanceOracleWrapper");
    wrapper = await Factory.deploy(BASE_CURRENCY, BASE_CURRENCY_UNIT, INITIAL_PRICE);

    await wrapper.grantRole(await wrapper.ORACLE_MANAGER_ROLE(), oracleManager.address);
    await wrapper.grantRole(await wrapper.GUARDIAN_ROLE(), guardian.address);
  });

  describe("Deployment", () => {
    it("should set initial price correctly", async () => {
      expect(await wrapper.price()).to.equal(INITIAL_PRICE);
    });

    it("should set BASE_CURRENCY correctly", async () => {
      expect(await wrapper.BASE_CURRENCY()).to.equal(BASE_CURRENCY);
    });

    it("should set BASE_CURRENCY_UNIT correctly", async () => {
      expect(await wrapper.BASE_CURRENCY_UNIT()).to.equal(BASE_CURRENCY_UNIT);
    });

    it("should grant DEFAULT_ADMIN_ROLE to deployer", async () => {
      const adminRole = await wrapper.DEFAULT_ADMIN_ROLE();
      expect(await wrapper.hasRole(adminRole, deployer.address)).to.be.true;
    });

    it("should grant ORACLE_MANAGER_ROLE to deployer", async () => {
      const managerRole = await wrapper.ORACLE_MANAGER_ROLE();
      expect(await wrapper.hasRole(managerRole, deployer.address)).to.be.true;
    });

    it("should grant GUARDIAN_ROLE to deployer", async () => {
      const guardianRole = await wrapper.GUARDIAN_ROLE();
      expect(await wrapper.hasRole(guardianRole, deployer.address)).to.be.true;
    });

    it("should set initial lastUpdateTimestamp", async () => {
      const timestamp = await wrapper.lastUpdateTimestamp();
      expect(timestamp).to.be.gt(0);
    });

    it("should set default maxStaleness to 90 days", async () => {
      const expectedStaleness = 90n * 24n * 60n * 60n; // 90 days in seconds
      expect(await wrapper.maxStaleness()).to.equal(expectedStaleness);
    });

    it("should set default bpsTolerance to 5", async () => {
      expect(await wrapper.bpsTolerance()).to.equal(5);
    });

    it("should emit PriceUpdated event on deployment", async () => {
      const Factory = await ethers.getContractFactory("GovernanceOracleWrapper");
      const newWrapper = await Factory.deploy(BASE_CURRENCY, BASE_CURRENCY_UNIT, INITIAL_PRICE);
      await expect(newWrapper.deploymentTransaction())
        .to.emit(newWrapper, "PriceUpdated")
        .withArgs(0, INITIAL_PRICE, deployer.address, 0, anyValue);
    });

    it("should revert on zero initial price", async () => {
      const Factory = await ethers.getContractFactory("GovernanceOracleWrapper");
      await expect(Factory.deploy(BASE_CURRENCY, BASE_CURRENCY_UNIT, 0)).to.be.revertedWithCustomError(wrapper, "InvalidPrice");
    });
  });

  describe("IOracleWrapper Interface", () => {
    it("should return correct price via getAssetPrice()", async () => {
      const price = await wrapper.getAssetPrice(ethers.ZeroAddress);
      expect(price).to.equal(INITIAL_PRICE);
    });

    it("should return correct price via getPriceInfo()", async () => {
      const [price, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
      expect(price).to.equal(INITIAL_PRICE);
      expect(isAlive).to.be.true;
    });

    it("should return isAlive = true when fresh", async () => {
      const [, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
      expect(isAlive).to.be.true;
    });

    it("should return isAlive = false when stale", async () => {
      const maxStaleness = await wrapper.maxStaleness();
      await time.increase(maxStaleness + 1n);
      const [, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
      expect(isAlive).to.be.false;
    });

    it("should ignore asset address parameter", async () => {
      const randomAddress = "0x1234567890123456789012345678901234567890";
      const price1 = await wrapper.getAssetPrice(ethers.ZeroAddress);
      const price2 = await wrapper.getAssetPrice(randomAddress);
      expect(price1).to.equal(price2);
    });
  });

  describe("Dual Role Price Updates", () => {
    const oldPrice = ethers.parseUnits("0.995", 18);
    const newPrice = ethers.parseUnits("1.00", 18);
    const changeBps = 50; // ~0.5% increase

    it("should allow ORACLE_MANAGER_ROLE to update price", async () => {
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, changeBps);
      expect(await wrapper.price()).to.equal(newPrice);
    });

    it("should allow GUARDIAN_ROLE to update price", async () => {
      await wrapper.connect(guardian).setPrice(oldPrice, newPrice, changeBps);
      expect(await wrapper.price()).to.equal(newPrice);
    });

    it("should prevent unauthorized users from updating price", async () => {
      await expect(wrapper.connect(unauthorized).setPrice(oldPrice, newPrice, changeBps)).to.be.revertedWithCustomError(
        wrapper,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should emit PriceUpdated with correct updater", async () => {
      await expect(wrapper.connect(guardian).setPrice(oldPrice, newPrice, changeBps)).to.emit(wrapper, "PriceUpdated");
    });

    it("should update lastUpdateTimestamp", async () => {
      const timestampBefore = await wrapper.lastUpdateTimestamp();
      await time.increase(100);
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, changeBps);
      const timestampAfter = await wrapper.lastUpdateTimestamp();
      expect(timestampAfter).to.be.gt(timestampBefore);
    });
  });

  describe("Double Verification", () => {
    it("should reject if expectedOldPrice doesn't match", async () => {
      const wrongOldPrice = ethers.parseUnits("1.00", 18);
      const newPrice = ethers.parseUnits("1.05", 18);
      await expect(wrapper.connect(oracleManager).setPrice(wrongOldPrice, newPrice, 500)).to.be.revertedWithCustomError(
        wrapper,
        "OldPriceMismatch",
      );
    });

    it("should reject zero new price", async () => {
      const oldPrice = await wrapper.price();
      await expect(wrapper.connect(oracleManager).setPrice(oldPrice, 0, -10000)).to.be.revertedWithCustomError(wrapper, "InvalidPrice");
    });

    it("should accept exact change percent match", async () => {
      const oldPrice = ethers.parseUnits("1.00", 18);
      const newPrice = ethers.parseUnits("1.10", 18);
      // Update to 1.00 first
      await wrapper.connect(oracleManager).setPrice(INITIAL_PRICE, oldPrice, 50);
      // Then update to 1.10 (exactly 1000 bps)
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, 1000);
      expect(await wrapper.price()).to.equal(newPrice);
    });

    it("should accept change within tolerance (5 bps)", async () => {
      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("1.00", 18);
      // Actual change is ~50 bps, user enters 51 bps (1 bps diff)
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, 51);
      expect(await wrapper.price()).to.equal(newPrice);
    });

    it("should reject change outside tolerance", async () => {
      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("1.00", 18);
      // Actual: ~50 bps, User enters: 44 bps (6 bps diff > 5 tolerance)
      await expect(wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, 44)).to.be.revertedWithCustomError(
        wrapper,
        "ChangePercentMismatch",
      );
    });

    it("should detect wrong direction (negative vs positive)", async () => {
      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("1.00", 18);
      // Actual: +50 bps, User enters: -50 bps
      await expect(wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, -50)).to.be.revertedWithCustomError(
        wrapper,
        "ChangePercentMismatch",
      );
    });

    it("should catch fat-finger errors", async () => {
      const oldPrice = await wrapper.price();
      const wrongPrice = ethers.parseUnits("10.00", 18); // Meant 1.00, typed 10.00
      // Actual: ~900%, User enters: 0.5%
      await expect(wrapper.connect(oracleManager).setPrice(oldPrice, wrongPrice, 50)).to.be.revertedWithCustomError(
        wrapper,
        "ChangePercentMismatch",
      );
    });
  });

  describe("Tolerance Management", () => {
    it("should have initial tolerance of 5 bps", async () => {
      expect(await wrapper.bpsTolerance()).to.equal(5);
    });

    it("should allow ORACLE_MANAGER_ROLE to update tolerance", async () => {
      await wrapper.connect(oracleManager).setBpsTolerance(10);
      expect(await wrapper.bpsTolerance()).to.equal(10);
    });

    it("should emit BpsToleranceUpdated event", async () => {
      await expect(wrapper.connect(oracleManager).setBpsTolerance(10)).to.emit(wrapper, "BpsToleranceUpdated").withArgs(5, 10);
    });

    it("should reject tolerance > 100 bps", async () => {
      await expect(wrapper.connect(oracleManager).setBpsTolerance(101)).to.be.revertedWithCustomError(wrapper, "InvalidTolerance");
    });

    it("should prevent GUARDIAN_ROLE from updating tolerance", async () => {
      await expect(wrapper.connect(guardian).setBpsTolerance(10)).to.be.revertedWithCustomError(
        wrapper,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should prevent unauthorized from updating tolerance", async () => {
      await expect(wrapper.connect(unauthorized).setBpsTolerance(10)).to.be.revertedWithCustomError(
        wrapper,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should use updated tolerance in price verification", async () => {
      // Increase tolerance to 15 bps
      await wrapper.connect(oracleManager).setBpsTolerance(15);

      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("1.00", 18);

      // Now 60 bps should be accepted (10 bps diff < 15 tolerance)
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, 60);
      expect(await wrapper.price()).to.equal(newPrice);
    });
  });

  describe("Staleness", () => {
    it("should return isAlive=true when freshly updated", async () => {
      const [, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
      expect(isAlive).to.be.true;
    });

    it("should return isAlive=false when exceeds maxStaleness", async () => {
      const maxStaleness = await wrapper.maxStaleness();
      await time.increase(maxStaleness + 1n);
      const [, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
      expect(isAlive).to.be.false;
    });

    it("should treat maxStaleness = 0 as never stale", async () => {
      await wrapper.connect(oracleManager).setMaxStaleness(0);
      await time.increase(365n * 24n * 60n * 60n); // 1 year
      const [, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
      expect(isAlive).to.be.true;
    });

    it("should refresh timestamp on price update", async () => {
      const maxStaleness = await wrapper.maxStaleness();
      // Move time close to staleness
      await time.increase(maxStaleness - 100n);

      // Price update should refresh timestamp
      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("1.00", 18);
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, 50);

      // Should still be alive after the update
      const [, isAlive] = await wrapper.getPriceInfo(ethers.ZeroAddress);
      expect(isAlive).to.be.true;
    });

    it("should allow ORACLE_MANAGER_ROLE to update maxStaleness", async () => {
      const newStaleness = 30n * 24n * 60n * 60n; // 30 days
      await wrapper.connect(oracleManager).setMaxStaleness(newStaleness);
      expect(await wrapper.maxStaleness()).to.equal(newStaleness);
    });

    it("should emit MaxStalenessUpdated event", async () => {
      const oldStaleness = await wrapper.maxStaleness();
      const newStaleness = 30n * 24n * 60n * 60n;
      await expect(wrapper.connect(oracleManager).setMaxStaleness(newStaleness))
        .to.emit(wrapper, "MaxStalenessUpdated")
        .withArgs(oldStaleness, newStaleness);
    });

    it("should prevent GUARDIAN_ROLE from updating maxStaleness", async () => {
      const newStaleness = 30n * 24n * 60n * 60n;
      await expect(wrapper.connect(guardian).setMaxStaleness(newStaleness)).to.be.revertedWithCustomError(
        wrapper,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("Access Control", () => {
    it("should allow admin to grant ORACLE_MANAGER_ROLE", async () => {
      const newManager = unauthorized.address;
      const managerRole = await wrapper.ORACLE_MANAGER_ROLE();
      await wrapper.connect(deployer).grantRole(managerRole, newManager);
      expect(await wrapper.hasRole(managerRole, newManager)).to.be.true;
    });

    it("should allow admin to grant GUARDIAN_ROLE", async () => {
      const newGuardian = unauthorized.address;
      const guardianRole = await wrapper.GUARDIAN_ROLE();
      await wrapper.connect(deployer).grantRole(guardianRole, newGuardian);
      expect(await wrapper.hasRole(guardianRole, newGuardian)).to.be.true;
    });

    it("should allow admin to revoke roles", async () => {
      const managerRole = await wrapper.ORACLE_MANAGER_ROLE();
      await wrapper.connect(deployer).revokeRole(managerRole, oracleManager.address);
      expect(await wrapper.hasRole(managerRole, oracleManager.address)).to.be.false;
    });

    it("should prevent non-admin from granting roles", async () => {
      const managerRole = await wrapper.ORACLE_MANAGER_ROLE();
      await expect(wrapper.connect(unauthorized).grantRole(managerRole, unauthorized.address)).to.be.revertedWithCustomError(
        wrapper,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should allow role transfer to multisig", async () => {
      const multisig = unauthorized; // Use signer instead of address
      const adminRole = await wrapper.DEFAULT_ADMIN_ROLE();
      const managerRole = await wrapper.ORACLE_MANAGER_ROLE();

      // Grant roles to multisig
      await wrapper.connect(deployer).grantRole(adminRole, multisig.address);
      await wrapper.connect(deployer).grantRole(managerRole, multisig.address);

      // Verify
      expect(await wrapper.hasRole(adminRole, multisig.address)).to.be.true;
      expect(await wrapper.hasRole(managerRole, multisig.address)).to.be.true;

      // Revoke from deployer - must use multisig after transferring admin role
      await wrapper.connect(multisig).revokeRole(managerRole, deployer.address);
      await wrapper.connect(multisig).revokeRole(adminRole, deployer.address);

      expect(await wrapper.hasRole(adminRole, deployer.address)).to.be.false;
      expect(await wrapper.hasRole(managerRole, deployer.address)).to.be.false;
    });
  });

  describe("Integration with OracleAggregator", () => {
    let oracleAggregator: OracleAggregator;
    const testAsset = "0x1234567890123456789012345678901234567890";

    beforeEach(async () => {
      const OracleAggregatorFactory = await ethers.getContractFactory("OracleAggregator");
      oracleAggregator = await OracleAggregatorFactory.deploy(BASE_CURRENCY, BASE_CURRENCY_UNIT);

      // Grant oracle manager role
      const managerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
      await oracleAggregator.grantRole(managerRole, deployer.address);

      // Set wrapper as oracle for test asset
      await oracleAggregator.setOracle(testAsset, await wrapper.getAddress());
    });

    it("should work correctly when set as oracle in OracleAggregator", async () => {
      const price = await oracleAggregator.getAssetPrice(testAsset);
      expect(price).to.equal(INITIAL_PRICE);
    });

    it("should reflect price changes in OracleAggregator.getAssetPrice()", async () => {
      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("1.00", 18);
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, 50);

      const aggregatorPrice = await oracleAggregator.getAssetPrice(testAsset);
      expect(aggregatorPrice).to.equal(newPrice);
    });

    it("should return correct staleness in OracleAggregator", async () => {
      // Fresh price
      let [, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
      expect(isAlive).to.be.true;

      // Make stale
      const maxStaleness = await wrapper.maxStaleness();
      await time.increase(maxStaleness + 1n);

      [, isAlive] = await oracleAggregator.getPriceInfo(testAsset);
      expect(isAlive).to.be.false;
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple consecutive price updates", async () => {
      let currentPrice = await wrapper.price();

      for (let i = 0; i < 5; i++) {
        const newPrice = currentPrice + ethers.parseUnits("0.01", 18);
        const changeBps = 100; // ~1%
        await wrapper.connect(oracleManager).setPrice(currentPrice, newPrice, changeBps);
        currentPrice = newPrice;
      }

      const finalPrice = ethers.parseUnits("1.045", 18);
      expect(await wrapper.price()).to.equal(finalPrice);
    });

    it("should handle price increase", async () => {
      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("1.50", 18);
      const changeBps = 5075; // Actual: (1.50 - 0.995) / 0.995 * 10000 = 5075.37
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, changeBps);
      expect(await wrapper.price()).to.equal(newPrice);
    });

    it("should handle price decrease", async () => {
      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("0.90", 18);
      const changeBps = -954; // ~-9.54%
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, changeBps);
      expect(await wrapper.price()).to.equal(newPrice);
    });

    it("should handle same price update (0% change)", async () => {
      const currentPrice = await wrapper.price();
      await wrapper.connect(oracleManager).setPrice(currentPrice, currentPrice, 0);
      expect(await wrapper.price()).to.equal(currentPrice);
    });

    it("should handle very small changes", async () => {
      const oldPrice = ethers.parseUnits("1.00", 18);
      // Update to 1.00 first
      await wrapper.connect(oracleManager).setPrice(INITIAL_PRICE, oldPrice, 50);

      const newPrice = oldPrice + 1n; // Tiny change
      const changeBps = 0; // Rounds to 0
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, changeBps);
      expect(await wrapper.price()).to.equal(newPrice);
    });

    it("should handle large changes", async () => {
      const oldPrice = await wrapper.price();
      const newPrice = ethers.parseUnits("5.00", 18);
      const changeBps = 40251; // Actual: (5.00 - 0.995) / 0.995 * 10000 = 40251.25
      await wrapper.connect(oracleManager).setPrice(oldPrice, newPrice, changeBps);
      expect(await wrapper.price()).to.equal(newPrice);
    });
  });
});
