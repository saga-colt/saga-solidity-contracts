import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { MUST_GOVERNANCE_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";
import { ZERO_BYTES_32 } from "../../typescript/dlend/constants";
import { isLocalNetwork, isMainnet, isSagaTestnet } from "../../typescript/hardhat/deploy";

/**
 * Transfer GovernanceOracleWrapper roles to governance and guardian multisigs
 *
 * @param hre
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const networkName = hre.network.name;

  if (!isMainnet(networkName) && !isSagaTestnet(networkName) && !isLocalNetwork(networkName)) {
    console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping unsupported network (${networkName})`);
    return true;
  }

  const { getNamedAccounts, ethers, deployments } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  // Get the configuration from the network
  const config = await getConfig(hre);

  // Get the multisig addresses
  const { governanceMultisig } = config.walletAddresses;
  const guardianMultisig = config.walletAddresses.guardianMultisig || governanceMultisig; // Fallback to governance if guardian not specified

  console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: Transferring GovernanceOracleWrapper roles to multisigs`);
  console.log(`   Governance multisig: ${governanceMultisig}`);
  console.log(`   Guardian multisig: ${guardianMultisig}`);

  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;

  // Get the wrapper deployment
  const wrapperDeployment = await deployments.getOrNull(MUST_GOVERNANCE_ORACLE_WRAPPER_ID);

  if (!wrapperDeployment) {
    console.log(`\n  ⚠️  GovernanceOracleWrapper not deployed, skipping role transfer`);
    return true;
  }

  const wrapper = await ethers.getContractAt("GovernanceOracleWrapper", wrapperDeployment.address, deployerSigner);

  const ORACLE_MANAGER_ROLE = await wrapper.ORACLE_MANAGER_ROLE();
  const GUARDIAN_ROLE = await wrapper.GUARDIAN_ROLE();

  // Transfer ORACLE_MANAGER_ROLE to governance multisig
  await transferRole(wrapper, "GovernanceOracleWrapper", ORACLE_MANAGER_ROLE, "ORACLE_MANAGER_ROLE", governanceMultisig, deployer);

  // Transfer GUARDIAN_ROLE to guardian multisig
  await transferRole(wrapper, "GovernanceOracleWrapper", GUARDIAN_ROLE, "GUARDIAN_ROLE", guardianMultisig, deployer);

  // Transfer DEFAULT_ADMIN_ROLE to governance multisig
  await transferRole(wrapper, "GovernanceOracleWrapper", DEFAULT_ADMIN_ROLE, "DEFAULT_ADMIN_ROLE", governanceMultisig, deployer);

  console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: ✅ Done\n`);

  return true;
};

/**
 * Transfer a specified role from deployer to target multisig
 *
 * @param contract
 * @param contractName
 * @param role
 * @param roleName
 * @param targetMultisig
 * @param deployer
 */
async function transferRole(
  contract: any,
  contractName: string,
  role: string,
  roleName: string,
  targetMultisig: string,
  deployer: string,
): Promise<boolean> {
  console.log(`\n  📄 ROLE TRANSFER: ${contractName} - ${roleName}`);

  // Grant role to multisig
  if (!(await contract.hasRole(role, targetMultisig))) {
    await contract.grantRole(role, targetMultisig);
    console.log(`    ➕ Granted ${roleName} to ${targetMultisig}`);
  } else {
    console.log(`    ✓ ${roleName} already granted to ${targetMultisig}`);
  }

  // Safety check: Ensure the multisig has the role before revoking from deployer
  const multisigHasRole = await contract.hasRole(role, targetMultisig);

  if (!multisigHasRole) {
    throw new Error(`❌ Multisig ${targetMultisig} does not have the role ${roleName}. Aborting revocation from deployer.`);
  }

  // Revoke role from deployer unless deployer and target are the same (e.g., local testing)
  if (targetMultisig.toLowerCase() !== deployer.toLowerCase() && (await contract.hasRole(role, deployer))) {
    await contract.revokeRole(role, deployer);
    console.log(`    ➖ Revoked ${roleName} from deployer`);
  }

  console.log(`    ✅ Completed ${contractName} ${roleName} transfer`);

  return true;
}

func.id = "transfer_governance_oracle_wrapper_roles_to_multisig";
func.tags = ["governance", "roles", "governance-oracle"];
func.dependencies = [MUST_GOVERNANCE_ORACLE_WRAPPER_ID];

export default func;
