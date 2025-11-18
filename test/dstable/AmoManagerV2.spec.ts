import { expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoDebtToken,
  AmoManagerV2,
  CollateralHolderVault,
  ERC20StablecoinUpgradeable,
  OracleAggregator,
  TestERC20,
} from "../../typechain-types";
import { getTokenContractForAddress, getTokenContractForSymbol, TokenInfo } from "../../typescript/token/utils";
import { getConfig } from "../../config/config";
import { createDStableAmoV2Fixture, D_CONFIG } from "./fixtures";

const fixture = createDStableAmoV2Fixture(D_CONFIG);

describe("AmoManagerV2 debt-backed AMO system", () => {
  let deployer: Address;
  let user1: Address;
  let amoWallet: Address;

  let amoManager: AmoManagerV2;
  let amoDebtToken: AmoDebtToken;
  let dstable: ERC20StablecoinUpgradeable;
  let collateralVault: CollateralHolderVault;
  let oracleAggregator: OracleAggregator;
  let collateralTokens: Map<string, TestERC20> = new Map();
  let collateralInfos: Map<string, TokenInfo> = new Map();

  let amoIncreaseRole: string;
  let amoDecreaseRole: string;
  let collateralWithdrawerRole: string;

  before(async () => {
    ({ deployer, user1 } = await getNamedAccounts());
    amoWallet = user1;
  });

  beforeEach(async () => {
    await fixture();
    ({ deployer, user1 } = await getNamedAccounts());
    amoWallet = user1;

    if (!D_CONFIG.amoManagerId || !D_CONFIG.amoDebtTokenId) {
      throw new Error("Missing AMO deployment IDs");
    }

    const managerDeployment = await hre.deployments.get(D_CONFIG.amoManagerId);
    const debtTokenDeployment = await hre.deployments.get(D_CONFIG.amoDebtTokenId);
    const collateralVaultDeployment = await hre.deployments.get(D_CONFIG.collateralVaultContractId);
    const oracleDeployment = await hre.deployments.get(D_CONFIG.oracleAggregatorId);

    const { tokenInfo: dstableInfo } = await getTokenContractForSymbol(hre, deployer, D_CONFIG.symbol);
    dstable = (await hre.ethers.getContractAt(
      "ERC20StablecoinUpgradeable",
      dstableInfo.address,
      await hre.ethers.getSigner(deployer),
    )) as ERC20StablecoinUpgradeable;

    amoDebtToken = (await hre.ethers.getContractAt(
      "AmoDebtToken",
      debtTokenDeployment.address,
      await hre.ethers.getSigner(deployer),
    )) as AmoDebtToken;

    amoManager = (await hre.ethers.getContractAt(
      "AmoManagerV2",
      managerDeployment.address,
      await hre.ethers.getSigner(deployer),
    )) as AmoManagerV2;

    collateralVault = (await hre.ethers.getContractAt(
      "CollateralHolderVault",
      collateralVaultDeployment.address,
      await hre.ethers.getSigner(deployer),
    )) as CollateralHolderVault;

    oracleAggregator = (await hre.ethers.getContractAt(
      "OracleAggregator",
      oracleDeployment.address,
      await hre.ethers.getSigner(deployer),
    )) as OracleAggregator;

    amoIncreaseRole = await amoManager.AMO_INCREASE_ROLE();
    amoDecreaseRole = await amoManager.AMO_DECREASE_ROLE();
    collateralWithdrawerRole = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();

    await amoManager.setAmoWalletAllowed(deployer, true);
    await amoManager.setAmoWalletAllowed(amoWallet, true);
    await amoManager.grantRole(amoIncreaseRole, deployer);
    await amoManager.grantRole(amoDecreaseRole, deployer);
    await amoManager.grantRole(amoIncreaseRole, amoWallet);
    await amoManager.grantRole(amoDecreaseRole, amoWallet);

    const networkConfig = await getConfig(hre);
    const collateralAddresses = networkConfig.dStables[D_CONFIG.symbol].collaterals;
    collateralTokens = new Map();
    collateralInfos = new Map();

    for (const collateralAddress of collateralAddresses) {
      if (collateralAddress === hre.ethers.ZeroAddress) {
        continue;
      }
      const { contract, tokenInfo } = await getTokenContractForAddress(hre, deployer, collateralAddress);
      collateralTokens.set(tokenInfo.symbol, contract as TestERC20);
      collateralInfos.set(tokenInfo.symbol, tokenInfo);

      const initialAmount = hre.ethers.parseUnits("100000", tokenInfo.decimals);
      if ("mint" in contract && typeof contract.mint === "function") {
        await (contract as TestERC20).mint(deployer, initialAmount);
        await (contract as TestERC20).mint(amoWallet, initialAmount);
      } else {
        await contract.transfer(deployer, initialAmount);
        await contract.transfer(amoWallet, initialAmount);
      }

      await (contract as TestERC20).transfer(collateralVaultDeployment.address, initialAmount / 2n);
    }
  });

  describe("Deployment wiring", () => {
    it("wires the debt token and manager correctly", async () => {
      expect(await amoDebtToken.name()).to.equal("dTRINITY AMO Receipt");
      expect(await amoDebtToken.decimals()).to.equal(18);
      expect(await amoManager.debtToken()).to.equal(await amoDebtToken.getAddress());
      expect(await amoManager.dstable()).to.equal(await dstable.getAddress());
      expect(await amoManager.collateralVault()).to.equal(await collateralVault.getAddress());
    });

    it("registers the debt token price with the oracle", async () => {
      const price = await oracleAggregator.getAssetPrice(await amoDebtToken.getAddress());
      const unit = await oracleAggregator.baseCurrencyUnit();
      expect(price).to.equal(unit);
    });
  });

  describe("Stable AMO operations", () => {
    it("mints dStable and debt tokens in lockstep", async () => {
      const amount = hre.ethers.parseUnits("1000", 18);
      const preDebt = await amoDebtToken.totalSupply();
      const preDStable = await dstable.totalSupply();

      await amoManager.increaseAmoSupply(amount, deployer);

      const postDebt = await amoDebtToken.totalSupply();
      const postDStable = await dstable.totalSupply();
      expect(postDStable - preDStable).to.equal(amount);
      expect(postDebt - preDebt).to.be.gt(0n);
    });

    it("burns dStable and debt tokens symmetrically", async () => {
      const amount = hre.ethers.parseUnits("500", 18);
      await amoManager.increaseAmoSupply(amount, deployer);

      await dstable.approve(await amoManager.getAddress(), amount);
      await amoManager.decreaseAmoSupply(amount, deployer);

      expect(await dstable.balanceOf(await amoManager.getAddress())).to.equal(0n);
      expect(await amoDebtToken.balanceOf(await collateralVault.getAddress())).to.equal(0n);
    });
  });

  describe("Collateral AMO operations", () => {
    it("borrows collateral and mints matching debt tokens", async () => {
      const [collateralSymbol] = collateralInfos.keys();
      const collateralInfo = collateralInfos.get(collateralSymbol)!;
      const collateralToken = collateralTokens.get(collateralSymbol)!;
      const amount = hre.ethers.parseUnits("1000", collateralInfo.decimals);

      await collateralToken.connect(await hre.ethers.getSigner(deployer)).approve(await collateralVault.getAddress(), amount);
      await collateralVault.deposit(amount, collateralInfo.address);

      const debtBefore = await amoDebtToken.balanceOf(await collateralVault.getAddress());
      await amoManager.borrowTo(deployer, collateralInfo.address, amount / 2n, 1n);
      const debtAfter = await amoDebtToken.balanceOf(await collateralVault.getAddress());
      expect(debtAfter).to.be.gt(debtBefore);
    });

    it("repays collateral and burns debt tokens", async () => {
      const [collateralSymbol] = collateralInfos.keys();
      const collateralInfo = collateralInfos.get(collateralSymbol)!;
      const collateralToken = collateralTokens.get(collateralSymbol)!;
      const amount = hre.ethers.parseUnits("800", collateralInfo.decimals);

      await collateralToken.approve(await collateralVault.getAddress(), amount);
      await collateralVault.deposit(amount, collateralInfo.address);

      await amoManager.borrowTo(deployer, collateralInfo.address, amount / 2n, 1n);
      await collateralToken.approve(await amoManager.getAddress(), amount / 4n);
      await amoManager.repayFrom(deployer, collateralInfo.address, amount / 4n, hre.ethers.MaxUint256);

      const debtBalance = await amoDebtToken.balanceOf(await collateralVault.getAddress());
      expect(debtBalance).to.be.gt(0n);
    });
  });
});
