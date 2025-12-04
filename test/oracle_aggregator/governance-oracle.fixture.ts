import { deployments, ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

import { GovernanceOracleWrapper } from "../../typechain-types";
import { MUST_GOVERNANCE_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";

export interface GovernanceOracleWrapperFixtureResult {
  wrapper: GovernanceOracleWrapper;
  signers: SignerWithAddress[];
}

/**
 * Deploy the GovernanceOracleWrapper through the hardhat-deploy scripts so tests
 * exercise the deployment path alongside the contract.
 */
export const getGovernanceOracleWrapperFixture = () =>
  deployments.createFixture(async (): Promise<GovernanceOracleWrapperFixtureResult> => {
    await deployments.fixture(["deploy-mocks", "usd-oracle", "d", "local-setup", "governance-oracle"]);

    const { address: wrapperAddress } = await deployments.get(MUST_GOVERNANCE_ORACLE_WRAPPER_ID);
    const wrapper = await ethers.getContractAt("GovernanceOracleWrapper", wrapperAddress);
    const signers = await ethers.getSigners();

    return { wrapper, signers };
  });
