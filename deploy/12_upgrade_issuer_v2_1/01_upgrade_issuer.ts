import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  D_COLLATERAL_VAULT_CONTRACT_ID,
  D_ISSUER_CONTRACT_ID,
  D_ISSUER_V2_1_CONTRACT_ID,
  D_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Build a Safe transaction payload for a simple function call.
 *
 * @param contractAddress - address of the target contract
 * @param data - ABI-encoded calldata
 */
function buildRoleTx(contractAddress: string, data: string): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data,
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (!isMainnet(hre.network.name)) {
    console.log(`\n≻ 12_upgrade_issuer_v2_1/01_upgrade_issuer.ts: ⏭️  Skipping upgrade on ${hre.network.name}`);
    return true;
  }

  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const dstableAddress = config.tokenAddresses[D_TOKEN_ID];

  if (!dstableAddress) {
    throw new Error("Saga Dollar (D) address missing from config");
  }

  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);

  console.log(`\n≻ Upgrading D Issuer to IssuerV2_1...`);

  await hre.deployments.deploy(D_ISSUER_V2_1_CONTRACT_ID, {
    from: deployer,
    args: [collateralVaultAddress, dstableAddress, oracleAggregatorAddress],
    contract: "IssuerV2_1",
    log: true,
    autoMine: true,
  });

  const { address: newIssuerAddress } = await hre.deployments.get(D_ISSUER_V2_1_CONTRACT_ID);
  console.log(`   ↳ IssuerV2_1 deployed at ${newIssuerAddress}`);

  const testMultisig = process.env.TEST_GOVERNANCE_MULTISIG;
  const governanceMultisig = testMultisig || config.walletAddresses.governanceMultisig;

  const safeConfig =
    testMultisig && config.safeConfig
      ? {
          safeAddress: governanceMultisig,
          chainId: config.safeConfig.chainId,
          txServiceUrl: config.safeConfig.txServiceUrl,
        }
      : config.safeConfig;

  const executor = new SagaGovernanceExecutor(hre, deployerSigner, safeConfig);
  await executor.initialize();

  const dstable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", dstableAddress, deployerSigner);
  const issuer = await hre.ethers.getContractAt("IssuerV2_1", newIssuerAddress, deployerSigner);
  const MINTER_ROLE = await dstable.MINTER_ROLE();
  const DEFAULT_ADMIN_ROLE = await issuer.DEFAULT_ADMIN_ROLE();
  const INCENTIVES_MANAGER_ROLE = await issuer.INCENTIVES_MANAGER_ROLE();
  const PAUSER_ROLE = await issuer.PAUSER_ROLE();
  const dstableDefaultAdminRole = await dstable.DEFAULT_ADMIN_ROLE();
  const deployerIsDstAdmin = await dstable.hasRole(dstableDefaultAdminRole, deployer);
  const canDirectlyManageDStableRoles = !executor.useSafe && deployerIsDstAdmin;

  const previousIssuerDeployment = await hre.deployments.getOrNull(D_ISSUER_CONTRACT_ID);
  const previousIssuerAddress = previousIssuerDeployment?.address;

  let pendingGovernance = false;

  /**
   * Attempt direct execution or enqueue a Safe transaction if governance signatures are needed.
   *
   * @param description - human-readable label for logs/Safe UI
   * @param directCall - action to execute immediately
   * @param safeTx - optional Safe transaction payload if the direct call fails
   */
  async function queueOrExecute(description: string, directCall: () => Promise<void>, safeTx?: SafeTransactionData): Promise<void> {
    const completed = await executor.tryOrQueue(directCall, safeTx ? (): SafeTransactionData => safeTx : undefined);

    if (!completed) {
      pendingGovernance = true;
      console.log(`   ⏳ ${description} queued for governance`);
    } else {
      console.log(`   ✅ ${description}`);
    }
  }

  const enqueueGovernance = (description: string, builder: () => SafeTransactionData): void => {
    executor.queueTransaction(builder);
    pendingGovernance = true;
    console.log(`   ⏳ ${description} queued for governance`);
  };

  if (!(await dstable.hasRole(MINTER_ROLE, newIssuerAddress))) {
    const buildGrantMinterTx = (): SafeTransactionData =>
      buildRoleTx(dstableAddress, dstable.interface.encodeFunctionData("grantRole", [MINTER_ROLE, newIssuerAddress]));

    if (executor.useSafe && !canDirectlyManageDStableRoles) {
      enqueueGovernance("Grant MINTER_ROLE to IssuerV2_1", buildGrantMinterTx);
    } else {
      await queueOrExecute(
        "Grant MINTER_ROLE to IssuerV2_1",
        async (): Promise<void> => {
          if (!canDirectlyManageDStableRoles) {
            throw new Error(
              deployerIsDstAdmin
                ? "Safe execution required for granting MINTER_ROLE on Saga Dollar"
                : "Deployer is missing DEFAULT_ADMIN_ROLE on Saga Dollar",
            );
          }
          await dstable.grantRole(MINTER_ROLE, newIssuerAddress);
        },
        buildGrantMinterTx(),
      );
    }
  } else {
    console.log("   ✓ IssuerV2_1 already has MINTER_ROLE");
  }

  if (previousIssuerAddress && (await dstable.hasRole(MINTER_ROLE, previousIssuerAddress))) {
    const buildRevokeMinterTx = (): SafeTransactionData =>
      buildRoleTx(dstableAddress, dstable.interface.encodeFunctionData("revokeRole", [MINTER_ROLE, previousIssuerAddress]));

    if (executor.useSafe && !canDirectlyManageDStableRoles) {
      enqueueGovernance("Revoke MINTER_ROLE from legacy Issuer", buildRevokeMinterTx);
    } else {
      await queueOrExecute(
        "Revoke MINTER_ROLE from legacy Issuer",
        async (): Promise<void> => {
          if (!canDirectlyManageDStableRoles) {
            throw new Error(
              deployerIsDstAdmin
                ? "Safe execution required for revoking MINTER_ROLE on Saga Dollar"
                : "Deployer is missing DEFAULT_ADMIN_ROLE on Saga Dollar",
            );
          }
          await dstable.revokeRole(MINTER_ROLE, previousIssuerAddress);
        },
        buildRevokeMinterTx(),
      );
    }
  }

  if (!(await issuer.hasRole(DEFAULT_ADMIN_ROLE, governanceMultisig))) {
    await queueOrExecute(
      "Grant DEFAULT_ADMIN_ROLE to governance",
      async (): Promise<void> => {
        await issuer.grantRole(DEFAULT_ADMIN_ROLE, governanceMultisig);
      },
      buildRoleTx(newIssuerAddress, issuer.interface.encodeFunctionData("grantRole", [DEFAULT_ADMIN_ROLE, governanceMultisig])),
    );
  } else {
    console.log("   ✓ Governance already has DEFAULT_ADMIN_ROLE");
  }

  if (!(await issuer.hasRole(INCENTIVES_MANAGER_ROLE, governanceMultisig))) {
    await queueOrExecute(
      "Grant INCENTIVES_MANAGER_ROLE to governance",
      async (): Promise<void> => {
        await issuer.grantRole(INCENTIVES_MANAGER_ROLE, governanceMultisig);
      },
      buildRoleTx(newIssuerAddress, issuer.interface.encodeFunctionData("grantRole", [INCENTIVES_MANAGER_ROLE, governanceMultisig])),
    );
  } else {
    console.log("   ✓ Governance already has INCENTIVES_MANAGER_ROLE");
  }

  if (!(await issuer.hasRole(PAUSER_ROLE, governanceMultisig))) {
    await queueOrExecute(
      "Grant PAUSER_ROLE to governance",
      async (): Promise<void> => {
        await issuer.grantRole(PAUSER_ROLE, governanceMultisig);
      },
      buildRoleTx(newIssuerAddress, issuer.interface.encodeFunctionData("grantRole", [PAUSER_ROLE, governanceMultisig])),
    );
  } else {
    console.log("   ✓ Governance already has PAUSER_ROLE");
  }

  if (await issuer.hasRole(INCENTIVES_MANAGER_ROLE, deployer)) {
    await queueOrExecute(
      "Revoke deployer INCENTIVES_MANAGER_ROLE",
      async (): Promise<void> => {
        await issuer.revokeRole(INCENTIVES_MANAGER_ROLE, deployer);
      },
      buildRoleTx(newIssuerAddress, issuer.interface.encodeFunctionData("revokeRole", [INCENTIVES_MANAGER_ROLE, deployer])),
    );
  }

  if (await issuer.hasRole(PAUSER_ROLE, deployer)) {
    await queueOrExecute(
      "Revoke deployer PAUSER_ROLE",
      async (): Promise<void> => {
        await issuer.revokeRole(PAUSER_ROLE, deployer);
      },
      buildRoleTx(newIssuerAddress, issuer.interface.encodeFunctionData("revokeRole", [PAUSER_ROLE, deployer])),
    );
  }

  if (await issuer.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
    await queueOrExecute(
      "Revoke deployer DEFAULT_ADMIN_ROLE",
      async (): Promise<void> => {
        await issuer.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
      },
      buildRoleTx(newIssuerAddress, issuer.interface.encodeFunctionData("revokeRole", [DEFAULT_ADMIN_ROLE, deployer])),
    );
  }

  if (pendingGovernance) {
    const flushed = await executor.flush("Upgrade D Issuer to IssuerV2_1");

    if (executor.useSafe) {
      if (!flushed) {
        console.log("\n❌ Failed to queue governance actions");
        return false;
      }
      console.log("\n⏳ Some actions require governance signatures via Safe.");
      console.log(`   Review: https://app.safe.global/transactions/queue?safe=saga:${governanceMultisig}`);
      console.log(`\n≻ 12_upgrade_issuer_v2_1/01_upgrade_issuer.ts: pending governance ⏳`);
      return false;
    }
  }

  console.log(`\n≻ 12_upgrade_issuer_v2_1/01_upgrade_issuer.ts: ✅`);
  return true;
};

func.tags = ["d", "issuer-v2_1", "upgrade"];
func.dependencies = [D_COLLATERAL_VAULT_CONTRACT_ID, D_TOKEN_ID, USD_ORACLE_AGGREGATOR_ID];
func.id = "upgrade-d-issuer-v2_1";

export default func;
