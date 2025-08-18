import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { ensureDefaultAdminExistsAndRevokeFrom } from "../../typescript/hardhat/access_control";

const ZERO_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Migrate roles to governance multisig (always idempotent)
 *
 * @param hre HardhatRuntimeEnvironment
 * @param redeemerAddress Address of the RedeemerV2 contract
 * @param deployerAddress Address of the deployer
 * @param governanceMultisig Address of the governance multisig
 * @param manualActions Array to collect manual actions needed if automatic actions fail
 */
async function migrateRedeemerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  redeemerAddress: string,
  deployerAddress: string,
  governanceMultisig: string,
  manualActions?: string[],
): Promise<void> {
  const redeemer = await hre.ethers.getContractAt(
    "RedeemerV2",
    redeemerAddress,
  );
  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  const REDEMPTION_MANAGER_ROLE = await redeemer.REDEMPTION_MANAGER_ROLE();
  const PAUSER_ROLE = await redeemer.PAUSER_ROLE();

  const roles = [
    { name: "DEFAULT_ADMIN_ROLE", hash: DEFAULT_ADMIN_ROLE },
    { name: "REDEMPTION_MANAGER_ROLE", hash: REDEMPTION_MANAGER_ROLE },
    { name: "PAUSER_ROLE", hash: PAUSER_ROLE },
  ];

  for (const role of roles) {
    if (!(await redeemer.hasRole(role.hash, governanceMultisig))) {
      try {
        await redeemer.grantRole(role.hash, governanceMultisig);
        console.log(`    ➕ Granted ${role.name} to ${governanceMultisig}`);
      } catch (e) {
        console.log(
          `    ⚠️ Could not grant ${role.name} to ${governanceMultisig}: ${(e as Error).message}`,
        );
        manualActions?.push(
          `RedeemerV2 (${redeemerAddress}).grantRole(${role.name}, ${governanceMultisig})`,
        );
      }
    } else {
      console.log(
        `    ✓ ${role.name} already granted to ${governanceMultisig}`,
      );
    }
  }

  // Revoke roles from deployer to mirror realistic governance
  for (const role of [REDEMPTION_MANAGER_ROLE, PAUSER_ROLE]) {
    if (await redeemer.hasRole(role, deployerAddress)) {
      try {
        await redeemer.revokeRole(role, deployerAddress);
        console.log(`    ➖ Revoked ${role} from deployer`);
      } catch (e) {
        console.log(
          `    ⚠️ Could not revoke ${role} from deployer: ${(e as Error).message}`,
        );
        const roleName =
          role === REDEMPTION_MANAGER_ROLE
            ? "REDEMPTION_MANAGER_ROLE"
            : "PAUSER_ROLE";
        manualActions?.push(
          `RedeemerV2 (${redeemerAddress}).revokeRole(${roleName}, ${deployerAddress})`,
        );
      }
    }
  }
  // Safely migrate DEFAULT_ADMIN_ROLE away from deployer
  await ensureDefaultAdminExistsAndRevokeFrom(
    hre,
    "RedeemerV2",
    redeemerAddress,
    governanceMultisig,
    deployerAddress,
    await hre.ethers.getSigner(deployerAddress),
    manualActions,
  );
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const manualActions: string[] = [];

  // Check all required configuration values at the top
  const dUSDConfig = config.dStables.D;

  const missingConfigs: string[] = [];

  // Check D configuration
  if (
    !dUSDConfig?.initialFeeReceiver ||
    !isAddress(dUSDConfig.initialFeeReceiver)
  ) {
    missingConfigs.push("dStables.D.initialFeeReceiver");
  }

  if (dUSDConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.D.initialRedemptionFeeBps");
  }

  // If any required config values are missing, skip deployment
  if (missingConfigs.length > 0) {
    console.log(
      `⚠️  Skipping RedeemerV2 deployment - missing configuration values: ${missingConfigs.join(", ")}`,
    );
    console.log(
      `☯️  ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipped)`,
    );
    return true;
  }

  console.log(`\n=== Deploy RedeemerV2 for dUSD ===`);

  // Deploy RedeemerV2 for dUSD
  const dUSDToken = await deployments.get(DUSD_TOKEN_ID);
  const dUSDCollateralVaultDeployment = await deployments.get(
    DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const usdOracleAggregator = await deployments.get(USD_ORACLE_AGGREGATOR_ID);

  const dUSDRedeemerV2Deployment = await deployments.deploy(
    DUSD_REDEEMER_CONTRACT_ID,
    {
      from: deployer,
      contract: "RedeemerV2",
      args: [
        dUSDCollateralVaultDeployment.address,
        dUSDToken.address,
        usdOracleAggregator.address,
        dUSDConfig.initialFeeReceiver,
        dUSDConfig.initialRedemptionFeeBps,
      ],
      autoMine: true,
      log: false,
    },
  );

  if (dUSDRedeemerV2Deployment.newlyDeployed) {
    console.log(
      `  ✅ Deployed ${DUSD_REDEEMER_CONTRACT_ID} at ${dUSDRedeemerV2Deployment.address}`,
    );
  } else {
    console.log(
      `  ✓ ${DUSD_REDEEMER_CONTRACT_ID} already at ${dUSDRedeemerV2Deployment.address}`,
    );
  }

  // Grant vault withdraw permission to new redeemer and revoke from old redeemer
  try {
    const dUSDCollateralVaultContract = await hre.ethers.getContractAt(
      "CollateralVault",
      dUSDCollateralVaultDeployment.address,
      await hre.ethers.getSigner(deployer),
    );
    const WITHDRAWER_ROLE =
      await dUSDCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();

    if (
      !(await dUSDCollateralVaultContract.hasRole(
        WITHDRAWER_ROLE,
        dUSDRedeemerV2Deployment.address,
      ))
    ) {
      try {
        await dUSDCollateralVaultContract.grantRole(
          WITHDRAWER_ROLE,
          dUSDRedeemerV2Deployment.address,
        );
        console.log(
          `    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to new redeemer ${dUSDRedeemerV2Deployment.address}`,
        );
      } catch (e) {
        console.log(
          `    ⚠️ Could not grant COLLATERAL_WITHDRAWER_ROLE to ${dUSDRedeemerV2Deployment.address}: ${(e as Error).message}`,
        );
        manualActions.push(
          `CollateralVault (${dUSDCollateralVaultDeployment.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${dUSDRedeemerV2Deployment.address})`,
        );
      }
    }

    // Note: Since this is a clean replacement for Saga, we don't need to revoke roles from legacy redeemers
    // as they don't exist in the Saga deployment yet
  } catch (e) {
    console.log(
      `    ⚠️ Could not update vault withdrawer roles: ${(e as Error).message}`,
    );
    manualActions.push(
      `CollateralVault (${dUSDCollateralVaultDeployment.address}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${dUSDRedeemerV2Deployment.address})`,
    );
  }

  // Post-deploy configuration no longer needed for fee receiver and default fee,
  // as they are provided via constructor.

  // Migrate roles to governance multisig (idempotent)
  await migrateRedeemerRolesIdempotent(
    hre,
    dUSDRedeemerV2Deployment.address,
    deployer,
    config.walletAddresses.governanceMultisig,
    manualActions,
  );

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize RedeemerV2 setup:");
    manualActions.forEach((a: string) => console.log(`   - ${a}`));
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DUSD_REDEEMER_CONTRACT_ID;
func.tags = ["dusd"];
func.dependencies = [
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  "usd-oracle",
];

export default func;
