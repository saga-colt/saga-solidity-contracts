import { expect } from "chai";
import { ZeroAddress } from "ethers";
import hre from "hardhat";

import {
  BasketRecoveryRedeemer,
  CollateralHolderVault,
  MockOracleAggregator,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";

describe("BasketRecoveryRedeemer", () => {
  async function deployBaseFixture() {
    const [deployer, user1, user2, user3] = await hre.ethers.getSigners();

    const oracleFactory = await hre.ethers.getContractFactory("MockOracleAggregator", deployer);
    const oracle = (await oracleFactory.deploy(ZeroAddress, hre.ethers.parseUnits("1", 18))) as MockOracleAggregator;
    await oracle.waitForDeployment();

    const vaultFactory = await hre.ethers.getContractFactory("CollateralHolderVault", deployer);
    const vault = (await vaultFactory.deploy(await oracle.getAddress())) as CollateralHolderVault;
    await vault.waitForDeployment();

    const dFactory = await hre.ethers.getContractFactory("TestMintableERC20", deployer);
    const dstable = (await dFactory.deploy("Saga Dollar", "D", 18)) as TestMintableERC20;
    await dstable.waitForDeployment();

    const tokenFactory = await hre.ethers.getContractFactory("TestERC20", deployer);
    const must = (await tokenFactory.deploy("MUST", "MUST", 18)) as TestERC20;
    const yusd = (await tokenFactory.deploy("YieldFi USD", "yUSD", 18)) as TestERC20;
    const vyusd = (await tokenFactory.deploy("Vault YieldFi USD", "vyUSD", 18)) as TestERC20;
    await Promise.all([must.waitForDeployment(), yusd.waitForDeployment(), vyusd.waitForDeployment()]);

    for (const token of [must, yusd, vyusd]) {
      await oracle.setAssetPrice(await token.getAddress(), hre.ethers.parseUnits("1", 18));
      await vault.allowCollateral(await token.getAddress());
    }

    return { deployer, user1, user2, user3, vault, dstable, must, yusd, vyusd };
  }

  it("starts paused and distributes a fixed basket pro-rata", async () => {
    const { deployer, user1, user2, vault, dstable, must, yusd, vyusd } = await deployBaseFixture();

    const claimBaseD = hre.ethers.parseUnits("100", 18);
    const mustBudget = hre.ethers.parseUnits("50", 18);
    const yusdBudget = hre.ethers.parseUnits("25", 18);
    const vyusdBudget = hre.ethers.parseUnits("10", 18);

    for (const [token, amount] of [
      [must, mustBudget],
      [yusd, yusdBudget],
      [vyusd, vyusdBudget],
    ] as const) {
      await token.approve(await vault.getAddress(), amount);
      await vault.deposit(amount, await token.getAddress());
    }

    const unit = hre.ethers.parseUnits("1", 18);
    const payoutPerD = [
      (mustBudget * unit) / claimBaseD,
      (yusdBudget * unit) / claimBaseD,
      (vyusdBudget * unit) / claimBaseD,
    ];

    const redeemerFactory = await hre.ethers.getContractFactory("BasketRecoveryRedeemer", deployer);
    const redeemer = (await redeemerFactory.deploy(
      await dstable.getAddress(),
      await vault.getAddress(),
      claimBaseD,
      [await must.getAddress(), await yusd.getAddress(), await vyusd.getAddress()],
      payoutPerD,
    )) as BasketRecoveryRedeemer;
    await redeemer.waitForDeployment();

    const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
    await vault.grantRole(withdrawerRole, await redeemer.getAddress());

    const fortyD = hre.ethers.parseUnits("40", 18);
    const sixtyD = hre.ethers.parseUnits("60", 18);
    await dstable.mint(await user1.getAddress(), fortyD);
    await dstable.mint(await user2.getAddress(), sixtyD);

    await dstable.connect(user1).approve(await redeemer.getAddress(), fortyD);
    await dstable.connect(user2).approve(await redeemer.getAddress(), sixtyD);

    await expect(redeemer.connect(user1).redeem(fortyD)).to.be.revertedWithCustomError(redeemer, "EnforcedPause");

    await redeemer.unpause();

    await expect(redeemer.connect(user1).redeem(fortyD))
      .to.emit(redeemer, "BasketRedemption")
      .withArgs(await user1.getAddress(), fortyD);

    expect(await must.balanceOf(await user1.getAddress())).to.equal(hre.ethers.parseUnits("20", 18));
    expect(await yusd.balanceOf(await user1.getAddress())).to.equal(hre.ethers.parseUnits("10", 18));
    expect(await vyusd.balanceOf(await user1.getAddress())).to.equal(hre.ethers.parseUnits("4", 18));
    expect(await redeemer.totalRedeemedD()).to.equal(fortyD);

    await redeemer.connect(user2).redeem(sixtyD);

    expect(await must.balanceOf(await user2.getAddress())).to.equal(hre.ethers.parseUnits("30", 18));
    expect(await yusd.balanceOf(await user2.getAddress())).to.equal(hre.ethers.parseUnits("15", 18));
    expect(await vyusd.balanceOf(await user2.getAddress())).to.equal(hre.ethers.parseUnits("6", 18));
    expect(await redeemer.totalRedeemedD()).to.equal(claimBaseD);

    expect(await must.balanceOf(await vault.getAddress())).to.equal(0n);
    expect(await yusd.balanceOf(await vault.getAddress())).to.equal(0n);
    expect(await vyusd.balanceOf(await vault.getAddress())).to.equal(0n);
    expect(await dstable.totalSupply()).to.equal(0n);
  });

  it("caps redemption at claimBaseD even if extra D exists elsewhere", async () => {
    const { deployer, user1, user2, user3, vault, dstable, must } = await deployBaseFixture();

    const claimBaseD = hre.ethers.parseUnits("100", 18);
    const recoveryBudget = hre.ethers.parseUnits("100", 18);

    await must.approve(await vault.getAddress(), recoveryBudget);
    await vault.deposit(recoveryBudget, await must.getAddress());

    const redeemerFactory = await hre.ethers.getContractFactory("BasketRecoveryRedeemer", deployer);
    const redeemer = (await redeemerFactory.deploy(
      await dstable.getAddress(),
      await vault.getAddress(),
      claimBaseD,
      [await must.getAddress()],
      [hre.ethers.parseUnits("1", 18)],
    )) as BasketRecoveryRedeemer;
    await redeemer.waitForDeployment();

    const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
    await vault.grantRole(withdrawerRole, await redeemer.getAddress());

    await redeemer.unpause();

    await dstable.mint(await user1.getAddress(), hre.ethers.parseUnits("40", 18));
    await dstable.mint(await user2.getAddress(), hre.ethers.parseUnits("60", 18));
    await dstable.mint("0x000000000000000000000000000000000000dEaD", hre.ethers.parseUnits("10", 18));

    await dstable.connect(user1).approve(await redeemer.getAddress(), hre.ethers.MaxUint256);
    await dstable.connect(user2).approve(await redeemer.getAddress(), hre.ethers.MaxUint256);

    await redeemer.connect(user1).redeem(hre.ethers.parseUnits("40", 18));
    await redeemer.connect(user2).redeem(hre.ethers.parseUnits("60", 18));

    await dstable.mint(await user3.getAddress(), hre.ethers.parseUnits("1", 18));
    await dstable.connect(user3).approve(await redeemer.getAddress(), hre.ethers.MaxUint256);

    await expect(redeemer.connect(user3).redeem(hre.ethers.parseUnits("1", 18)))
      .to.be.revertedWithCustomError(redeemer, "ClaimBaseExceeded")
      .withArgs(hre.ethers.parseUnits("101", 18), claimBaseD);
  });

  it("uses cumulative accounting so splitting redemptions does not leak rounding dust", async () => {
    const [deployer, user1] = await hre.ethers.getSigners();

    const oracleFactory = await hre.ethers.getContractFactory("MockOracleAggregator", deployer);
    const oracle = (await oracleFactory.deploy(ZeroAddress, hre.ethers.parseUnits("1", 18))) as MockOracleAggregator;
    await oracle.waitForDeployment();

    const vaultFactory = await hre.ethers.getContractFactory("CollateralHolderVault", deployer);
    const vault = (await vaultFactory.deploy(await oracle.getAddress())) as CollateralHolderVault;
    await vault.waitForDeployment();

    const dFactory = await hre.ethers.getContractFactory("TestMintableERC20", deployer);
    const dstable = (await dFactory.deploy("Saga Dollar", "D", 18)) as TestMintableERC20;
    await dstable.waitForDeployment();

    const tokenFactory = await hre.ethers.getContractFactory("TestERC20", deployer);
    const dustToken = (await tokenFactory.deploy("Dust", "DUST", 0)) as TestERC20;
    await dustToken.waitForDeployment();

    await oracle.setAssetPrice(await dustToken.getAddress(), hre.ethers.parseUnits("1", 18));
    await vault.allowCollateral(await dustToken.getAddress());

    await dustToken.approve(await vault.getAddress(), 10n);
    await vault.deposit(10n, await dustToken.getAddress());

    const claimBaseD = hre.ethers.parseUnits("3", 18);
    const payoutPerD = [(10n * hre.ethers.parseUnits("1", 18)) / claimBaseD];

    const redeemerFactory = await hre.ethers.getContractFactory("BasketRecoveryRedeemer", deployer);
    const redeemer = (await redeemerFactory.deploy(
      await dstable.getAddress(),
      await vault.getAddress(),
      claimBaseD,
      [await dustToken.getAddress()],
      payoutPerD,
    )) as BasketRecoveryRedeemer;
    await redeemer.waitForDeployment();

    const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
    await vault.grantRole(withdrawerRole, await redeemer.getAddress());
    await redeemer.unpause();

    const oneD = hre.ethers.parseUnits("1", 18);
    const halfD = hre.ethers.parseUnits("0.5", 18);
    await dstable.mint(await user1.getAddress(), oneD);
    await dstable.connect(user1).approve(await redeemer.getAddress(), oneD);

    const [, payoutsBefore] = await redeemer.previewRedeem(halfD);
    expect(payoutsBefore[0]).to.equal(1n);

    await redeemer.connect(user1).redeem(halfD);
    expect(await dustToken.balanceOf(await user1.getAddress())).to.equal(1n);

    await redeemer.connect(user1).redeem(halfD);
    expect(await dustToken.balanceOf(await user1.getAddress())).to.equal(3n);
  });

  it("reverts if duplicate recovery assets are configured", async () => {
    const { deployer, vault, dstable, must } = await deployBaseFixture();

    const redeemerFactory = await hre.ethers.getContractFactory("BasketRecoveryRedeemer", deployer);
    await expect(
      redeemerFactory.deploy(
        await dstable.getAddress(),
        await vault.getAddress(),
        hre.ethers.parseUnits("100", 18),
        [await must.getAddress(), await must.getAddress()],
        [hre.ethers.parseUnits("1", 18), hre.ethers.parseUnits("1", 18)],
      ),
    ).to.be.revertedWithCustomError(redeemerFactory, "DuplicateRecoveryAsset");
  });

  it("reverts when a redemption is too small to earn any asset units", async () => {
    const [deployer, user1] = await hre.ethers.getSigners();

    const oracleFactory = await hre.ethers.getContractFactory("MockOracleAggregator", deployer);
    const oracle = (await oracleFactory.deploy(ZeroAddress, hre.ethers.parseUnits("1", 18))) as MockOracleAggregator;
    await oracle.waitForDeployment();

    const vaultFactory = await hre.ethers.getContractFactory("CollateralHolderVault", deployer);
    const vault = (await vaultFactory.deploy(await oracle.getAddress())) as CollateralHolderVault;
    await vault.waitForDeployment();

    const dFactory = await hre.ethers.getContractFactory("TestMintableERC20", deployer);
    const dstable = (await dFactory.deploy("Saga Dollar", "D", 18)) as TestMintableERC20;
    await dstable.waitForDeployment();

    const tokenFactory = await hre.ethers.getContractFactory("TestERC20", deployer);
    const dustToken = (await tokenFactory.deploy("Dust", "DUST", 0)) as TestERC20;
    await dustToken.waitForDeployment();

    await oracle.setAssetPrice(await dustToken.getAddress(), hre.ethers.parseUnits("1", 18));
    await vault.allowCollateral(await dustToken.getAddress());

    await dustToken.approve(await vault.getAddress(), 10n);
    await vault.deposit(10n, await dustToken.getAddress());

    const claimBaseD = hre.ethers.parseUnits("3", 18);
    const payoutPerD = [(10n * hre.ethers.parseUnits("1", 18)) / claimBaseD];

    const redeemerFactory = await hre.ethers.getContractFactory("BasketRecoveryRedeemer", deployer);
    const redeemer = (await redeemerFactory.deploy(
      await dstable.getAddress(),
      await vault.getAddress(),
      claimBaseD,
      [await dustToken.getAddress()],
      payoutPerD,
    )) as BasketRecoveryRedeemer;
    await redeemer.waitForDeployment();

    const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
    await vault.grantRole(withdrawerRole, await redeemer.getAddress());
    await redeemer.unpause();

    const tinyAmount = hre.ethers.parseUnits("0.1", 18);
    await dstable.mint(await user1.getAddress(), tinyAmount);
    await dstable.connect(user1).approve(await redeemer.getAddress(), tinyAmount);

    await expect(redeemer.connect(user1).redeem(tinyAmount))
      .to.be.revertedWithCustomError(redeemer, "RedemptionAmountTooSmall")
      .withArgs(tinyAmount);
  });

  it("reverts if the vault is later drained below the configured basket budget", async () => {
    const { deployer, user1, vault, dstable, must } = await deployBaseFixture();

    const claimBaseD = hre.ethers.parseUnits("100", 18);
    const recoveryBudget = hre.ethers.parseUnits("100", 18);

    await must.approve(await vault.getAddress(), recoveryBudget);
    await vault.deposit(recoveryBudget, await must.getAddress());

    const redeemerFactory = await hre.ethers.getContractFactory("BasketRecoveryRedeemer", deployer);
    const redeemer = (await redeemerFactory.deploy(
      await dstable.getAddress(),
      await vault.getAddress(),
      claimBaseD,
      [await must.getAddress()],
      [hre.ethers.parseUnits("1", 18)],
    )) as BasketRecoveryRedeemer;
    await redeemer.waitForDeployment();

    const withdrawerRole = await vault.COLLATERAL_WITHDRAWER_ROLE();
    await vault.grantRole(withdrawerRole, await redeemer.getAddress());
    await redeemer.unpause();

    // Simulate an unexpected external drain after the basket has been frozen.
    await vault.withdraw(hre.ethers.parseUnits("10", 18), await must.getAddress());

    await dstable.mint(await user1.getAddress(), claimBaseD);
    await dstable.connect(user1).approve(await redeemer.getAddress(), claimBaseD);

    await expect(redeemer.connect(user1).redeem(claimBaseD))
      .to.be.revertedWithCustomError(redeemer, "InsufficientVaultBalance")
      .withArgs(await must.getAddress(), claimBaseD, hre.ethers.parseUnits("90", 18));
  });
});
