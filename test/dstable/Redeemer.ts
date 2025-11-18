import { assert, expect } from "chai";
import hre, { deployments, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";
import { ZeroAddress } from "ethers";

import { RedeemerV2, TestMintableERC20, CollateralVault, OracleAggregator, IssuerV2_2, TestERC20 } from "../../typechain-types";
import { getTokenContractForSymbol, TokenInfo } from "../../typescript/token/utils";
import { createDStableFixture, D_CONFIG, DStableFixtureConfig, ensureIssuerV2Deployment } from "./fixtures"; // Assuming fixtures.ts is in the same directory
import { D_REDEEMER_CONTRACT_ID } from "../../typescript/deploy-ids";
import { getConfig } from "../../config/config"; // To access deployment config for verification
import { ONE_HUNDRED_PERCENT_BPS } from "../../typescript/common/bps_constants";

// Create a new fixture factory for dstable with RedeemerV2
export const createDStableWithRedeemerV2Fixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    // First, run the base dStable fixture
    const baseFixture = createDStableFixture(config);
    await baseFixture();

    // Then, deploy the RedeemerV2 contracts
    // The deployment script uses the tag 'dusd'
    await deployments.fixture(["dusd"]);
    await ensureIssuerV2Deployment(config);
  });
};

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [D_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`RedeemerV2 for ${config.symbol}`, () => {
    let redeemerV2Contract: RedeemerV2;
    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let collateralVaultContract: CollateralVault;
    let oracleAggregatorContract: OracleAggregator;
    let deployer: Address;
    let user1: Address;
    let feeReceiverSigner: any; // To hold the signer for the configured fee receiver
    let issuerContract: IssuerV2_2;
    let collateralContracts: Map<string, TestERC20>;
    let collateralInfos: Map<string, TokenInfo>;

    // Set up fixture for this specific dStable configuration with RedeemerV2
    const fixture = createDStableWithRedeemerV2Fixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1 } = await getNamedAccounts());

      const appConfig = await getConfig(hre);
      let redeemerV2ContractId: string;
      let configuredFeeReceiver: string;
      let configuredDefaultFeeBps: number;

      if (config.symbol === "D") {
        if (appConfig.dStables.D?.initialFeeReceiver === undefined || appConfig.dStables.D?.initialRedemptionFeeBps === undefined) {
          throw new Error("D initialFeeReceiver or initialRedemptionFeeBps is undefined in config");
        }
        redeemerV2ContractId = D_REDEEMER_CONTRACT_ID;
        configuredFeeReceiver = appConfig.dStables.D.initialFeeReceiver;
        configuredDefaultFeeBps = appConfig.dStables.D.initialRedemptionFeeBps;
      } else {
        throw new Error(`Unsupported dStable symbol for RedeemerV2 tests: ${config.symbol}`);
      }

      const redeemerV2Address = (await hre.deployments.get(redeemerV2ContractId)).address;
      redeemerV2Contract = await hre.ethers.getContractAt("RedeemerV2", redeemerV2Address, await hre.ethers.getSigner(deployer));

      // Get dStable token
      const { contract: dstableTokenContract, tokenInfo: dstableTokenInfo } = await getTokenContractForSymbol(hre, deployer, config.symbol);
      dstableContract = dstableTokenContract as TestMintableERC20;
      dstableInfo = dstableTokenInfo;

      // Get CollateralVault (needed for context, though direct interactions might be less in unit tests)
      const collateralVaultAddress = (await hre.deployments.get(config.collateralVaultContractId)).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get OracleAggregator (needed for value calculations)
      const oracleAggregatorAddress = (await hre.deployments.get(config.oracleAggregatorId)).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get the configured fee receiver
      if (configuredFeeReceiver) {
        feeReceiverSigner = await hre.ethers.getSigner(configuredFeeReceiver);
      }

      // Prepare issuer and issue dStable tokens to user1
      const issuerAddress = (await hre.deployments.get(config.issuerContractId)).address;
      issuerContract = await hre.ethers.getContractAt("IssuerV2_2", issuerAddress, await hre.ethers.getSigner(deployer));
      collateralContracts = new Map();
      collateralInfos = new Map();
      for (const collateralSymbol of config.peggedCollaterals) {
        const result = await getTokenContractForSymbol(hre, deployer, collateralSymbol);
        const collateralContract = result.contract as TestERC20;
        const collateralInfo = result.tokenInfo;
        collateralContracts.set(collateralSymbol, collateralContract);
        collateralInfos.set(collateralSymbol, collateralInfo);
        // Transfer and approve collateral for user1
        const depositAmount = hre.ethers.parseUnits("1000", collateralInfo.decimals);
        await collateralContract.transfer(user1, depositAmount);
        const userAmount = hre.ethers.parseUnits("500", collateralInfo.decimals);
        await collateralContract.connect(await hre.ethers.getSigner(user1)).approve(await issuerContract.getAddress(), userAmount);
        // Issue dStable with 5% slippage protection
        const baseValue = await collateralVaultContract.assetValueFromAmount(userAmount, collateralInfo.address);
        const expectedDstable = await issuerContract.baseValueToDstableAmount(baseValue);
        const minDstable = (expectedDstable * 95n) / 100n;
        await issuerContract.connect(await hre.ethers.getSigner(user1)).issue(userAmount, collateralInfo.address, minDstable);
      }
      // Grant REDEMPTION_MANAGER_ROLE to user1
      const REDEMPTION_MANAGER_ROLE = await redeemerV2Contract.REDEMPTION_MANAGER_ROLE();
      await redeemerV2Contract.grantRole(REDEMPTION_MANAGER_ROLE, user1);
    });

    describe("Deployment and Configuration", () => {
      it("should have the correct fee receiver and default redemption fee", async function () {
        const appConfig = await getConfig(hre);
        let expectedFeeReceiver: string;
        let expectedDefaultFeeBps: bigint;

        if (config.symbol === "D") {
          if (appConfig.dStables.D?.initialFeeReceiver === undefined || appConfig.dStables.D?.initialRedemptionFeeBps === undefined) {
            throw new Error("D initialFeeReceiver or initialRedemptionFeeBps is undefined in config for assertion");
          }
          expectedFeeReceiver = appConfig.dStables.D.initialFeeReceiver;
          expectedDefaultFeeBps = BigInt(appConfig.dStables.D.initialRedemptionFeeBps);
        } else {
          throw new Error(`Unsupported dStable symbol: ${config.symbol}`);
        }

        const actualFeeReceiver = await redeemerV2Contract.feeReceiver();
        const actualDefaultFeeBps = await redeemerV2Contract.defaultRedemptionFeeBps();

        assert.equal(actualFeeReceiver, expectedFeeReceiver, "Fee receiver is not correctly set");
        assert.equal(actualDefaultFeeBps, expectedDefaultFeeBps, "Default redemption fee BPS is not correctly set");
      });
    });

    describe("Public Redemption with Fees", () => {
      config.peggedCollaterals.forEach((collateralSymbol) => {
        it(`redeems ${config.symbol} for ${collateralSymbol} with default fee`, async function () {
          const collateralContract = collateralContracts.get(collateralSymbol)!;
          const collateralInfo = collateralInfos.get(collateralSymbol)!;
          const userSigner = await hre.ethers.getSigner(user1);
          const redeemerAddress = await redeemerV2Contract.getAddress();
          const feeReceiverAddress = await redeemerV2Contract.feeReceiver();
          // Redeem amount
          const redeemAmount = hre.ethers.parseUnits("100", dstableInfo.decimals);
          // Approve redeemer
          await dstableContract.connect(userSigner).approve(redeemerAddress, redeemAmount);
          // Calculate expected total collateral using contract logic
          const dstableValue = await redeemerV2Contract.dstableAmountToBaseValue(redeemAmount);
          const totalCollateral = await collateralVaultContract.assetAmountFromValue(dstableValue, collateralInfo.address);
          const defaultFeeBp = BigInt((await redeemerV2Contract.defaultRedemptionFeeBps()).toString());
          const expectedFee = (totalCollateral * defaultFeeBp) / BigInt(ONE_HUNDRED_PERCENT_BPS);
          const expectedNet = totalCollateral - expectedFee;
          // Balances before
          const userCollateralBefore = await collateralContract.balanceOf(user1);
          const feeBefore = await collateralContract.balanceOf(feeReceiverAddress);
          const vaultBefore = await collateralContract.balanceOf(await collateralVaultContract.getAddress());

          // Redeem
          const tx = await redeemerV2Contract.connect(userSigner).redeem(redeemAmount, collateralInfo.address, 0);
          // Check event
          await expect(tx)
            .to.emit(redeemerV2Contract, "Redemption")
            .withArgs(user1, collateralInfo.address, redeemAmount, expectedNet, expectedFee);
          // Balances after
          const userCollateralAfter = await collateralContract.balanceOf(user1);
          const feeAfter = await collateralContract.balanceOf(feeReceiverAddress);
          const vaultAfter = await collateralContract.balanceOf(await collateralVaultContract.getAddress());

          assert.equal(
            (userCollateralAfter - userCollateralBefore).toString(),
            expectedNet.toString(),
            "User receives net collateral after fee",
          );
          assert.equal((feeAfter - feeBefore).toString(), expectedFee.toString(), "Fee receiver gets correct fee amount");
          assert.equal((vaultBefore - vaultAfter).toString(), totalCollateral.toString(), "Vault balance decreases by total collateral");
        });

        it(`reverts if slippage is too high for ${config.symbol}`, async function () {
          const collateralInfo = collateralInfos.get(collateralSymbol)!;
          const userSigner = await hre.ethers.getSigner(user1);
          const redeemAmount = hre.ethers.parseUnits("100", dstableInfo.decimals);
          await dstableContract.connect(userSigner).approve(await redeemerV2Contract.getAddress(), redeemAmount);
          const highMin = hre.ethers.parseUnits("1000000", collateralInfo.decimals);
          await expect(
            redeemerV2Contract.connect(userSigner).redeem(redeemAmount, collateralInfo.address, highMin),
          ).to.be.revertedWithCustomError(redeemerV2Contract, "SlippageTooHigh");
        });

        it("reverts when redeeming an unsupported collateral asset", async function () {
          const TestERC20Factory = await hre.ethers.getContractFactory("TestERC20", await hre.ethers.getSigner(deployer));
          const unsupportedCollateralContract = await TestERC20Factory.deploy("Unsupported Token", "UNSUP", 18);
          await unsupportedCollateralContract.waitForDeployment();

          const userSigner = await hre.ethers.getSigner(user1);

          // Give the user some allowance of dStable for redemption
          const redeemAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
          await dstableContract.connect(userSigner).approve(await redeemerV2Contract.getAddress(), redeemAmount);

          // Expect revert due to unsupported collateral
          await expect(redeemerV2Contract.connect(userSigner).redeem(redeemAmount, await unsupportedCollateralContract.getAddress(), 0))
            .to.be.revertedWithCustomError(collateralVaultContract, "UnsupportedCollateral")
            .withArgs(await unsupportedCollateralContract.getAddress());
        });
      });
    });

    describe("Protocol Redemption (No Fees)", () => {
      it("allows manager to redeem without fees", async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralContract = collateralContracts.get(collateralSymbol)!;
        const collateralInfo = collateralInfos.get(collateralSymbol)!;
        const managerSigner = await hre.ethers.getSigner(user1);
        const redeemAmount = hre.ethers.parseUnits("100", dstableInfo.decimals);
        await dstableContract.connect(managerSigner).approve(await redeemerV2Contract.getAddress(), redeemAmount);
        const userCollateralBefore = await collateralContract.balanceOf(user1);
        // Redeem as protocol
        await expect(redeemerV2Contract.connect(managerSigner).redeemAsProtocol(redeemAmount, collateralInfo.address, 0)).to.emit(
          redeemerV2Contract,
          "Redemption",
        );
        const userCollateralAfter = await collateralContract.balanceOf(user1);
        assert.isTrue(userCollateralAfter > userCollateralBefore, "Manager should receive collateral");
      });

      it("reverts if non-manager calls redeemAsProtocol", async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralInfo = collateralInfos.get(collateralSymbol)!;
        const otherSigner = await hre.ethers.getSigner(deployer);
        const redeemAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        await expect(redeemerV2Contract.connect(otherSigner).redeemAsProtocol(redeemAmount, collateralInfo.address, 0)).to.be.reverted;
      });
    });

    describe("Administrative functions", () => {
      it("allows admin to set fee receiver", async function () {
        const newReceiver = user1;
        await redeemerV2Contract.setFeeReceiver(newReceiver);
        assert.equal(await redeemerV2Contract.feeReceiver(), newReceiver, "Fee receiver should be updated");
      });

      it("reverts when non-admin tries to set fee receiver", async function () {
        const nonAdmin = await hre.ethers.getSigner(user1);
        await expect(redeemerV2Contract.connect(nonAdmin).setFeeReceiver(ZeroAddress)).to.be.reverted;
      });

      it("allows admin to set default redemption fee", async function () {
        const newFee = 100; // 1%
        await redeemerV2Contract.setDefaultRedemptionFee(newFee);
        assert.equal((await redeemerV2Contract.defaultRedemptionFeeBps()).toString(), newFee.toString(), "Default fee should be updated");
      });

      it("reverts if admin sets default fee above max", async function () {
        const maxFee = (await redeemerV2Contract.MAX_FEE_BPS()) + 1n;
        await expect(redeemerV2Contract.setDefaultRedemptionFee(maxFee)).to.be.revertedWithCustomError(redeemerV2Contract, "FeeTooHigh");
      });

      it("allows admin to set collateral-specific fee", async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralInfo = collateralInfos.get(collateralSymbol)!;
        const newFee = 200; // 2%
        await redeemerV2Contract.setCollateralRedemptionFee(collateralInfo.address, newFee);
        assert.equal(
          (await redeemerV2Contract.collateralRedemptionFeeBps(collateralInfo.address)).toString(),
          newFee.toString(),
          "Collateral fee should be updated",
        );
      });

      it("reverts if admin sets collateral fee above max", async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralInfo = collateralInfos.get(collateralSymbol)!;
        const maxFee = (await redeemerV2Contract.MAX_FEE_BPS()) + 1n;
        await expect(redeemerV2Contract.setCollateralRedemptionFee(collateralInfo.address, maxFee)).to.be.revertedWithCustomError(
          redeemerV2Contract,
          "FeeTooHigh",
        );
      });
    });

    describe("Utility functions", () => {
      it("dstableAmountToBaseValue returns correct base value", async function () {
        const amount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        const baseUnit = await redeemerV2Contract.baseCurrencyUnit();
        const expected = (amount * baseUnit) / 10n ** BigInt(dstableInfo.decimals);
        assert.equal(
          (await redeemerV2Contract.dstableAmountToBaseValue(amount)).toString(),
          expected.toString(),
          "Base value calculation should match",
        );
      });
    });
  });
});
