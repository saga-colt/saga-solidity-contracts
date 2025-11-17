import { Interface } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  D_AMO_DEBT_TOKEN_ID,
  D_AMO_MANAGER_ID,
  D_COLLATERAL_VAULT_CONTRACT_ID,
  D_HARD_PEG_ORACLE_WRAPPER_ID,
  D_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { SagaGovernanceExecutor } from "../../typescript/hardhat/saga-governance";
import { SafeTransactionData } from "../../typescript/hardhat/saga-safe-manager";

/**
 * Helper to build a Safe transaction payload for any contract call
 *
 * @param contractAddress - Address of the target contract
 * @param contractInterface - Ethers interface for encoding the call
 * @param functionName - Name of the function to invoke
 * @param args - Arguments for the function call
 */
function buildSafeTransaction(
  contractAddress: string,
  contractInterface: Interface,
  functionName: string,
  args: unknown[],
): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData(functionName, args),
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const executor = new SagaGovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const { address: collateralVaultAddress } = await hre.deployments.get(D_COLLATERAL_VAULT_CONTRACT_ID);
  const dstableAddress = config.tokenAddresses.D;

  if (!dstableAddress) {
    throw new Error("Saga Dollar address missing from config");
  }

  console.log(`\n≻ Deploying AMO debt stack...`);

  const debtTokenDeployment = await hre.deployments.deploy(D_AMO_DEBT_TOKEN_ID, {
    from: deployer,
    contract: "AmoDebtToken",
    args: ["dTRINITY AMO Receipt", "amo-D"],
    log: true,
    autoMine: true,
  });

  console.log(`   ↳ AmoDebtToken deployed at ${debtTokenDeployment.address}`);

  const { address: hardPegWrapperAddress } = await hre.deployments.get(D_HARD_PEG_ORACLE_WRAPPER_ID);
  const oracle = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorAddress, deployerSigner);
  const oracleManagerRole = await oracle.ORACLE_MANAGER_ROLE();
  const deployerHasOracleManagerRole = await oracle.hasRole(oracleManagerRole, deployer);
  const canDirectlyUpdateOracle = !executor.useSafe && deployerHasOracleManagerRole;
  let pendingGovernanceActions = false;
  let requiresGovernanceBeforeContinue = false;

  const markPending = (opComplete: boolean, requiresImmediateFlush = false) => {
    if (!opComplete) {
      pendingGovernanceActions = true;
      if (requiresImmediateFlush) {
        requiresGovernanceBeforeContinue = true;
      }
    }
  };

  const currentOracle = await oracle.assetOracles(debtTokenDeployment.address);

  if (!currentOracle || currentOracle.toLowerCase() !== hardPegWrapperAddress.toLowerCase()) {
    const buildOracleTx = () =>
      buildSafeTransaction(oracleAggregatorAddress, oracle.interface, "setOracle", [debtTokenDeployment.address, hardPegWrapperAddress]);

    if (executor.useSafe && !canDirectlyUpdateOracle) {
      console.log(`   ↳ Queuing AmoDebtToken oracle configuration via Saga Safe`);
      executor.queueTransaction(buildOracleTx);
      markPending(false, true);
    } else {
      const oracleOpComplete = await executor.tryOrQueue(
        async () => {
          if (!canDirectlyUpdateOracle) {
            throw new Error(
              deployerHasOracleManagerRole
                ? "Safe execution required for AmoDebtToken oracle configuration"
                : "Deployer is missing ORACLE_MANAGER_ROLE on OracleAggregator",
            );
          }
          await oracle.setOracle(debtTokenDeployment.address, hardPegWrapperAddress);
          console.log(`   ↳ Hard peg oracle configured for AmoDebtToken`);
        },
        executor.useSafe ? buildOracleTx : undefined,
      );
      markPending(oracleOpComplete, !oracleOpComplete);
    }
  } else {
    console.log(`   ↳ Hard peg oracle already configured for AmoDebtToken`);
  }

  if (executor.useSafe && requiresGovernanceBeforeContinue) {
    const flushed = await executor.flush(`Configure AmoDebtToken oracle via Saga Safe`);

    if (!flushed) {
      console.log(`\n❌ Failed to prepare governance batch`);
      return false;
    }

    console.log("\n⏳ Oracle configuration requires governance execution through the Saga Safe.");
    console.log("   Re-run this deployment after the Safe transactions execute to finalize AmoManager setup.");
    console.log(`   View queue: https://app.safe.global/transactions/queue?safe=saga:${config.walletAddresses.governanceMultisig}`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
    return false;
  }

  const amoManagerDeployment = await hre.deployments.deploy(D_AMO_MANAGER_ID, {
    from: deployer,
    contract: "AmoManagerV2",
    args: [oracleAggregatorAddress, debtTokenDeployment.address, dstableAddress, collateralVaultAddress],
    log: true,
    autoMine: true,
  });
  console.log(`   ↳ AmoManagerV2 deployed at ${amoManagerDeployment.address}`);

  const dstable = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", dstableAddress, deployerSigner);
  const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployerSigner);
  const debtToken = await hre.ethers.getContractAt("AmoDebtToken", debtTokenDeployment.address, deployerSigner);
  const amoManager = await hre.ethers.getContractAt("AmoManagerV2", amoManagerDeployment.address, deployerSigner);

  const MINTER_ROLE = await dstable.MINTER_ROLE();
  const dstableDefaultAdminRole = await dstable.DEFAULT_ADMIN_ROLE();
  const deployerIsDstAdmin = await dstable.hasRole(dstableDefaultAdminRole, deployer);
  const canDirectlyGrantMinterRole = !executor.useSafe && deployerIsDstAdmin;

  if (!(await dstable.hasRole(MINTER_ROLE, amoManagerDeployment.address))) {
    const buildMinterTx = () => buildSafeTransaction(dstableAddress, dstable.interface, "grantRole", [MINTER_ROLE, amoManagerDeployment.address]);

    if (executor.useSafe && !canDirectlyGrantMinterRole) {
      console.log(`   ↳ Queuing MINTER_ROLE grant for AmoManagerV2 via Saga Safe`);
      executor.queueTransaction(buildMinterTx);
      markPending(false);
    } else {
      const minterOpComplete = await executor.tryOrQueue(
        async () => {
          if (!canDirectlyGrantMinterRole) {
            throw new Error(
              deployerIsDstAdmin
                ? "Safe execution required for granting MINTER_ROLE on Saga Dollar"
                : "Deployer is missing DEFAULT_ADMIN_ROLE on Saga Dollar",
            );
          }
          await dstable.grantRole(MINTER_ROLE, amoManagerDeployment.address);
          console.log(`   ↳ Granted MINTER_ROLE to AmoManagerV2 on Saga Dollar`);
        },
        executor.useSafe ? buildMinterTx : undefined,
      );
      markPending(minterOpComplete);
    }
  } else {
    console.log(`   ↳ AmoManagerV2 already has MINTER_ROLE on Saga Dollar`);
  }

  const collateralDefaultAdminRole = await collateralVault.DEFAULT_ADMIN_ROLE();
  const deployerIsCollateralAdmin = await collateralVault.hasRole(collateralDefaultAdminRole, deployer);
  const COLLATERAL_WITHDRAWER_ROLE = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();
  const canDirectlyGrantWithdrawerRole = !executor.useSafe && deployerIsCollateralAdmin;

  if (!(await collateralVault.hasRole(COLLATERAL_WITHDRAWER_ROLE, amoManagerDeployment.address))) {
    const buildWithdrawerTx = () =>
      buildSafeTransaction(collateralVaultAddress, collateralVault.interface, "grantRole", [
        COLLATERAL_WITHDRAWER_ROLE,
        amoManagerDeployment.address,
      ]);

    if (executor.useSafe && !canDirectlyGrantWithdrawerRole) {
      console.log(`   ↳ Queuing COLLATERAL_WITHDRAWER_ROLE grant for AmoManagerV2 via Saga Safe`);
      executor.queueTransaction(buildWithdrawerTx);
      markPending(false);
    } else {
      const withdrawerOpComplete = await executor.tryOrQueue(
        async () => {
          if (!canDirectlyGrantWithdrawerRole) {
            throw new Error(
              deployerIsCollateralAdmin
                ? "Safe execution required for granting COLLATERAL_WITHDRAWER_ROLE on CollateralVault"
                : "Deployer is missing DEFAULT_ADMIN_ROLE on CollateralVault",
            );
          }
          await collateralVault.grantRole(COLLATERAL_WITHDRAWER_ROLE, amoManagerDeployment.address);
          console.log(`   ↳ Granted COLLATERAL_WITHDRAWER_ROLE to AmoManagerV2`);
        },
        executor.useSafe ? buildWithdrawerTx : undefined,
      );
      markPending(withdrawerOpComplete);
    }
  } else {
    console.log(`   ↳ AmoManagerV2 already has COLLATERAL_WITHDRAWER_ROLE`);
  }

  const AMO_MANAGER_ROLE = await debtToken.AMO_MANAGER_ROLE();

  if (!(await debtToken.hasRole(AMO_MANAGER_ROLE, amoManagerDeployment.address))) {
    await debtToken.grantRole(AMO_MANAGER_ROLE, amoManagerDeployment.address);
  }

  if (!(await debtToken.isAllowlisted(collateralVaultAddress))) {
    await debtToken.setAllowlisted(collateralVaultAddress, true);
  }

  if (!(await debtToken.isAllowlisted(amoManagerDeployment.address))) {
    await debtToken.setAllowlisted(amoManagerDeployment.address, true);
  }

  const COLLATERAL_MANAGER_ROLE = await collateralVault.COLLATERAL_MANAGER_ROLE();
  const deployerIsCollateralManager = await collateralVault.hasRole(COLLATERAL_MANAGER_ROLE, deployer);
  const canDirectlyAllowCollateral = !executor.useSafe && deployerIsCollateralManager;

  if (!(await collateralVault.isCollateralSupported(debtTokenDeployment.address))) {
    const buildAllowCollateralTx = () =>
      buildSafeTransaction(collateralVaultAddress, collateralVault.interface, "allowCollateral", [debtTokenDeployment.address]);

    if (executor.useSafe && !canDirectlyAllowCollateral) {
      console.log(`   ↳ Queuing AmoDebtToken collateral support via Saga Safe`);
      executor.queueTransaction(buildAllowCollateralTx);
      markPending(false);
    } else {
      const allowCollateralOpComplete = await executor.tryOrQueue(
        async () => {
          if (!canDirectlyAllowCollateral) {
            throw new Error(
              deployerIsCollateralManager
                ? "Safe execution required for allowing collateral on CollateralVault"
                : "Deployer is missing COLLATERAL_MANAGER_ROLE on CollateralVault",
            );
          }
          await collateralVault.allowCollateral(debtTokenDeployment.address);
          console.log(`   ↳ Added AmoDebtToken as supported collateral`);
        },
        executor.useSafe ? buildAllowCollateralTx : undefined,
      );
      markPending(allowCollateralOpComplete);
    }
  } else {
    console.log(`   ↳ AmoDebtToken already supported as collateral`);
  }

  if ((await amoManager.collateralVault()) !== collateralVaultAddress) {
    await amoManager.setCollateralVault(collateralVaultAddress);
  }

  const governanceWallet = config.walletAddresses.governanceMultisig;

  if (governanceWallet && !(await amoManager.isAmoWalletAllowed(governanceWallet))) {
    await amoManager.setAmoWalletAllowed(governanceWallet, true);
  }

  if (!(await amoManager.isAmoWalletAllowed(deployer))) {
    await amoManager.setAmoWalletAllowed(deployer, true);
  }

  if (pendingGovernanceActions) {
    const flushed = await executor.flush(`Configure AmoManagerV2 permissions & oracle on Saga`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`\n❌ Failed to prepare governance batch`);
        return false;
      }
      console.log("\n⏳ Some operations require governance execution through the Saga Safe.");
      console.log("   Re-run this deployment after the Safe transactions execute to finalize verification.");
      console.log(`   View queue: https://app.safe.global/transactions/queue?safe=saga:${config.walletAddresses.governanceMultisig}`);
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    } else {
      console.log("\n⏭️ Non-Safe mode: operations pending manual execution; continuing.");
    }
  }

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = D_AMO_MANAGER_ID;
func.tags = ["d", "amo-v2"];
func.dependencies = [D_TOKEN_ID, D_COLLATERAL_VAULT_CONTRACT_ID, USD_ORACLE_AGGREGATOR_ID, D_HARD_PEG_ORACLE_WRAPPER_ID];

export default func;
