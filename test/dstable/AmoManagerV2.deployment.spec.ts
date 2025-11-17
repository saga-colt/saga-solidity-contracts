import { expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { AmoDebtToken, AmoManagerV2, CollateralHolderVault, ERC20StablecoinUpgradeable, OracleAggregator } from "../../typechain-types";
import { getConfig } from "../../config/config";
import { createDStableAmoV2Fixture, D_CONFIG } from "./fixtures";

const fixture = createDStableAmoV2Fixture(D_CONFIG);

describe("AmoManagerV2 deployment configuration", () => {
  let deployer: Address;
  let governance: Address;

  before(async () => {
    ({ deployer } = await getNamedAccounts());
    const config = await getConfig(hre);
    governance = config.walletAddresses.governanceMultisig;
  });

  describe("D AMO stack", () => {
    let amoManager: AmoManagerV2;
    let debtToken: AmoDebtToken;
    let dstable: ERC20StablecoinUpgradeable;
    let collateralVault: CollateralHolderVault;
    let oracle: OracleAggregator;

    beforeEach(async () => {
      await fixture();

      const managerDeployment = await hre.deployments.get(D_CONFIG.amoManagerId!);
      const debtTokenDeployment = await hre.deployments.get(D_CONFIG.amoDebtTokenId!);
      const dstableInfo = await hre.deployments.get(D_CONFIG.symbol);
      const collateralVaultDeployment = await hre.deployments.get(D_CONFIG.collateralVaultContractId);
      const oracleDeployment = await hre.deployments.get(D_CONFIG.oracleAggregatorId);

      amoManager = (await hre.ethers.getContractAt(
        "AmoManagerV2",
        managerDeployment.address,
        await hre.ethers.getSigner(deployer),
      )) as AmoManagerV2;
      debtToken = (await hre.ethers.getContractAt(
        "AmoDebtToken",
        debtTokenDeployment.address,
        await hre.ethers.getSigner(deployer),
      )) as AmoDebtToken;
      dstable = (await hre.ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dstableInfo.address,
        await hre.ethers.getSigner(deployer),
      )) as ERC20StablecoinUpgradeable;
      collateralVault = (await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultDeployment.address,
        await hre.ethers.getSigner(deployer),
      )) as CollateralHolderVault;
      oracle = (await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleDeployment.address,
        await hre.ethers.getSigner(deployer),
      )) as OracleAggregator;
    });

    it("sets expected addresses", async () => {
      expect(await amoManager.debtToken()).to.equal(await debtToken.getAddress());
      expect(await amoManager.collateralVault()).to.equal(await collateralVault.getAddress());
    });

    it("grants required roles", async () => {
      const AMO_MANAGER_ROLE = await debtToken.AMO_MANAGER_ROLE();
      expect(await debtToken.hasRole(AMO_MANAGER_ROLE, await amoManager.getAddress())).to.be.true;

      const MINTER_ROLE = await dstable.MINTER_ROLE();
      expect(await dstable.hasRole(MINTER_ROLE, await amoManager.getAddress())).to.be.true;

      const COLLATERAL_WITHDRAWER_ROLE = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();
      expect(await collateralVault.hasRole(COLLATERAL_WITHDRAWER_ROLE, await amoManager.getAddress())).to.be.true;
    });

    it("allowlists the vault and manager on the debt token", async () => {
      expect(await debtToken.isAllowlisted(await collateralVault.getAddress())).to.be.true;
      expect(await debtToken.isAllowlisted(await amoManager.getAddress())).to.be.true;
    });

    it("registers the hard peg oracle", async () => {
      const price = await oracle.getAssetPrice(await debtToken.getAddress());
      const unit = await oracle.baseCurrencyUnit();
      expect(price).to.equal(unit);
    });

    it("allowlists governance wallets for AMO operations", async () => {
      expect(await amoManager.isAmoWalletAllowed(governance)).to.be.true;
    });
  });
});
