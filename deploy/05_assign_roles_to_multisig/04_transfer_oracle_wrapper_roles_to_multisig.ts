import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Transfer Tellor oracle wrapper roles to governance multisig
 *
 * @param _hre The Hardhat Runtime Environment for deployment
 */
const func: DeployFunction = async function (_hre: HardhatRuntimeEnvironment) {
  console.log(
    `\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping until admin tool is ready`,
  );
  return true;

  // if (!isMainnet(hre.network.name)) {
  //   console.log(
  //     `\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping non-mainnet network`,
  //   );
  //   return true;
  // }

  // const { getNamedAccounts, ethers, deployments } = hre;
  // const { deployer } = await getNamedAccounts();
  // const deployerSigner = await ethers.getSigner(deployer);

  // // Get the configuration from the network
  // const config = await getConfig(hre);

  // // Get the governance multisig address
  // const { governanceMultisig } = config.walletAddresses;

  // console.log(
  //   `\n🔑 ${__filename.split("/").slice(-2).join("/")}: Transferring Tellor oracle wrapper roles to governance multisig`,
  // );

  // const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  // const ORACLE_MANAGER_ROLE = await ethers
  //   .getContractAt(
  //     "OracleAggregator",
  //     (await deployments.get(USD_ORACLE_AGGREGATOR_ID)).address,
  //   )
  //   .then((c) => c.ORACLE_MANAGER_ROLE());

  // if (!ORACLE_MANAGER_ROLE) {
  //   throw new Error("❌ Could not determine ORACLE_MANAGER_ROLE.");
  // }

  // // Transfer roles for USD Tellor oracle wrappers
  // if (ORACLE_MANAGER_ROLE) {
  //   await transferRole(
  //     hre,
  //     USD_TELLOR_ORACLE_WRAPPER_ID,
  //     "USD Tellor Plain Wrapper",
  //     ORACLE_MANAGER_ROLE,
  //     "ORACLE_MANAGER_ROLE",
  //     deployerSigner,
  //     governanceMultisig,
  //     deployer,
  //   );
  // }
  // await transferRole(
  //   hre,
  //   USD_TELLOR_ORACLE_WRAPPER_ID,
  //   "USD Tellor Plain Wrapper",
  //   DEFAULT_ADMIN_ROLE,
  //   "DEFAULT_ADMIN_ROLE",
  //   deployerSigner,
  //   governanceMultisig,
  //   deployer,
  // );

  // if (ORACLE_MANAGER_ROLE) {
  //   await transferRole(
  //     hre,
  //     USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
  //     "USD Tellor Wrapper With Thresholding",
  //     ORACLE_MANAGER_ROLE,
  //     "ORACLE_MANAGER_ROLE",
  //     deployerSigner,
  //     governanceMultisig,
  //     deployer,
  //   );
  // }
  // await transferRole(
  //   hre,
  //   USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
  //   "USD Tellor Wrapper With Thresholding",
  //   DEFAULT_ADMIN_ROLE,
  //   "DEFAULT_ADMIN_ROLE",
  //   deployerSigner,
  //   governanceMultisig,
  //   deployer,
  // );

  // console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: ✅ Done\n`);

  // return true;
};

/* eslint-disable unused-imports/no-unused-vars -- Keep dormant role transfer helpers until admin automation lands */
/**
 * Transfer a specified role from deployer to governance multisig for a given contract
 *
 * @param hre The Hardhat Runtime Environment for deployment
 * @param contractId The ID of the contract to transfer roles for
 * @param contractName The name of the contract for logging purposes
 * @param role The role bytes32 to transfer
 * @param roleName The name of the role for logging purposes
 * @param deployerSigner The signer instance for the deployer account
 * @param governanceMultisig The address of the governance multisig to transfer roles to
 * @param deployer The address of the deployer account to transfer roles from
 * @returns Promise that resolves to true when the role is transferred
 */
async function transferRole(
  hre: HardhatRuntimeEnvironment,
  contractId: string,
  contractName: string,
  role: string,
  roleName: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  deployer: string,
): Promise<boolean> {
  const { deployments, ethers } = hre;

  const contractDeployment = await deployments.get(contractId);

  if (!contractDeployment) {
    console.log(
      `  ⚠️ ${contractName} not deployed, skipping ${roleName} transfer`,
    );
    return false; // Indicate that the transfer was skipped
  }

  console.log(`\n  📄 ROLE TRANSFER: ${contractName} - ${roleName}`);

  const contract = await ethers.getContractAt(
    "@openzeppelin/contracts/access/AccessControl.sol:AccessControl",
    contractDeployment.address,
    deployerSigner,
  );

  // Grant role to multisig
  if (!(await contract.hasRole(role, governanceMultisig))) {
    await contract.grantRole(role, governanceMultisig);
    console.log(`    ➕ Granted ${roleName} to ${governanceMultisig}`);
  } else {
    console.log(`    ✓ ${roleName} already granted to ${governanceMultisig}`);
  }

  // Safety check: Ensure the governance multisig has the role before revoking from deployer
  const multisigHasRole = await contract.hasRole(role, governanceMultisig);

  if (!multisigHasRole) {
    throw new Error(
      `❌ Governance multisig ${governanceMultisig} does not have the role ${roleName}. Aborting revocation from deployer.`,
    );
  }

  // Revoke role from deployer
  if (await contract.hasRole(role, deployer)) {
    await contract.revokeRole(role, deployer);
    console.log(`    ➖ Revoked ${roleName} from deployer`);
  }

  console.log(`    ✅ Completed ${contractName} ${roleName} transfer`);

  return true; // Indicate successful transfer
}

func.id = "transfer_oracle_wrapper_roles_to_multisig";
func.tags = ["governance", "roles"];
func.dependencies = ["setup-usd-tellor-oracle-wrappers"];

export default func;

/* eslint-enable unused-imports/no-unused-vars -- Restore unused-var enforcement */
