import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  D_REDEEMER_CONTRACT_ID,
  D_SMO_HELPER_ID,
  D_TOKEN_ID,
  D_ISSUER_CONTRACT_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;
  const config = await getConfig(hre);

  // Validate configuration
  const missingConfigs: string[] = [];

  // Check Uniswap router configuration
  if (!config.uniswapRouter || !isAddress(config.uniswapRouter)) {
    missingConfigs.push("uniswapRouter");
  }

  // Check governance multisig configuration
  if (!config.walletAddresses?.governanceMultisig || !isAddress(config.walletAddresses.governanceMultisig)) {
    missingConfigs.push("walletAddresses.governanceMultisig");
  }

  // If any required config values are missing, skip deployment
  if (missingConfigs.length > 0) {
    console.log(
      `⚠️  Skipping SMOHelper V2 deployment - missing configuration values: ${missingConfigs.join(", ")}`,
    );
    console.log(
      `☯️  ${__filename.split("/").slice(-1)[0]}: ⏭️  (skipped)`,
    );
    return true;
  }

  // Get required contract addresses
  const dToken = await get(D_TOKEN_ID);
  const dRedeemer = await get(D_REDEEMER_CONTRACT_ID);
  const dIssuer = await get(D_ISSUER_CONTRACT_ID);

  // Get the old SMOHelper contract to revoke operator access
  const oldSmoHelper = await get(D_SMO_HELPER_ID);
  const oldSmoHelperContract = await hre.ethers.getContractAt(
    "SMOHelper",
    oldSmoHelper.address,
    await hre.ethers.getSigner(deployer),
  );

  // Check if the old SMOHelper has the old operator address
  const oldOperatorAddress = "0xd2f775Ff2cD41bfe43C7A8c016eD10393553fe44";
  const operatorRole = await oldSmoHelperContract.OPERATOR_ROLE();
  const hasOldOperatorRole = await oldSmoHelperContract.hasRole(
    operatorRole,
    oldOperatorAddress,
  );

  if (hasOldOperatorRole) {
    console.log(`🔄 Revoking OPERATOR_ROLE from old operator: ${oldOperatorAddress}`);
    try {
      const revokeTx = await oldSmoHelperContract.revokeRole(operatorRole, oldOperatorAddress);
      await revokeTx.wait();
      console.log(`✅ Successfully revoked OPERATOR_ROLE from ${oldOperatorAddress}`);
    } catch (error) {
      console.log(`⚠️  Failed to revoke OPERATOR_ROLE from ${oldOperatorAddress}:`, error);
    }
  } else {
    console.log(`ℹ️  Old operator ${oldOperatorAddress} does not have OPERATOR_ROLE on old SMOHelper`);
  }

  // Deploy new SMOHelper V2 with issuer integration
  const smoHelperV2Deployment = await deploy("D_SmoHelperV2", {
    from: deployer,
    contract: "SMOHelper",
    args: [
      dToken.address, // dstable
      dRedeemer.address, // redeemer
      dIssuer.address, // issuer
      config.uniswapRouter, // uniswapRouter
      config.walletAddresses.governanceMultisig, // operator
    ],
  });

  // Verify the new deployment and check roles
  const smoHelperV2Contract = await hre.ethers.getContractAt(
    "SMOHelper",
    smoHelperV2Deployment.address,
    await hre.ethers.getSigner(deployer),
  );

  // Grant OPERATOR_ROLE to the new operator address
  const newOperatorAddress = "0xd2f775Ff2cD41bfe43C7A8c016eD10393553fe44";
  console.log(`🔄 Granting OPERATOR_ROLE to new operator: ${newOperatorAddress}`);

  try {
    const grantTx = await smoHelperV2Contract.grantRole(operatorRole, newOperatorAddress);
    await grantTx.wait();
    console.log(`✅ Successfully granted OPERATOR_ROLE to ${newOperatorAddress}`);
  } catch (error) {
    console.log(`⚠️  Failed to grant OPERATOR_ROLE to ${newOperatorAddress}:`, error);
  }

  // Verify the new operator has the role
  const hasNewOperatorRole = await smoHelperV2Contract.hasRole(
    operatorRole,
    newOperatorAddress,
  );

  if (!hasNewOperatorRole) {
    console.log("⚠️  New operator does not have OPERATOR_ROLE - this should not happen");
  } else {
    console.log("✅ New operator has OPERATOR_ROLE");
  }

  // Check if the governance multisig has the OPERATOR_ROLE (from constructor)
  const hasGovernanceOperatorRole = await smoHelperV2Contract.hasRole(
    operatorRole,
    config.walletAddresses.governanceMultisig,
  );

  if (!hasGovernanceOperatorRole) {
    console.log("⚠️  Governance multisig does not have OPERATOR_ROLE - this should not happen as it's set in constructor");
  } else {
    console.log("✅ Governance multisig has OPERATOR_ROLE");
  }

  // Check if the deployer has DEFAULT_ADMIN_ROLE (should be true from constructor)
  const adminRole = await smoHelperV2Contract.DEFAULT_ADMIN_ROLE();
  const deployerHasAdminRole = await smoHelperV2Contract.hasRole(adminRole, deployer);

  if (!deployerHasAdminRole) {
    console.log("⚠️  Deployer does not have DEFAULT_ADMIN_ROLE - this should not happen as it's set in constructor");
  } else {
    console.log("✅ Deployer has DEFAULT_ADMIN_ROLE");
  }

  // Verify contract addresses are correctly set
  const deployedDStableAddress = await smoHelperV2Contract.getDStableToken();
  const deployedRedeemerAddress = await smoHelperV2Contract.getRedeemer();
  const deployedIssuerAddress = await smoHelperV2Contract.getIssuer();
  const deployedUniswapRouterAddress = await smoHelperV2Contract.getUniswapRouter();

  if (deployedDStableAddress !== dToken.address) {
    console.log(`⚠️  DStable address mismatch: expected ${dToken.address}, got ${deployedDStableAddress}`);
  } else {
    console.log("✅ DStable address correctly set");
  }

  if (deployedRedeemerAddress !== dRedeemer.address) {
    console.log(`⚠️  Redeemer address mismatch: expected ${dRedeemer.address}, got ${deployedRedeemerAddress}`);
  } else {
    console.log("✅ Redeemer address correctly set");
  }

  if (deployedIssuerAddress !== dIssuer.address) {
    console.log(`⚠️  Issuer address mismatch: expected ${dIssuer.address}, got ${deployedIssuerAddress}`);
  } else {
    console.log("✅ Issuer address correctly set");
  }

  if (deployedUniswapRouterAddress !== config.uniswapRouter) {
    console.log(`⚠️  Uniswap router address mismatch: expected ${config.uniswapRouter}, got ${deployedUniswapRouterAddress}`);
  } else {
    console.log("✅ Uniswap router address correctly set");
  }

  // Summary
  console.log("\n📋 Migration Summary:");
  console.log(`   Old SMOHelper: ${oldSmoHelper.address}`);
  console.log(`   New SMOHelper V2: ${smoHelperV2Deployment.address}`);
  console.log(`   Old operator (${oldOperatorAddress}) access: ${hasOldOperatorRole ? "REVOKED" : "NOT FOUND"}`);
  console.log(`   New operator (${newOperatorAddress}) access: ${hasNewOperatorRole ? "GRANTED" : "FAILED"}`);

  // Check for manual actions needed
  console.log("\n🔍 Manual Actions Check:");
  const manualActionsNeeded: string[] = [];

  // Check if old operator access was successfully revoked
  if (hasOldOperatorRole) {
    const stillHasOldRole = await oldSmoHelperContract.hasRole(operatorRole, oldOperatorAddress);
    if (stillHasOldRole) {
      manualActionsNeeded.push(`❌ REVOKE OPERATOR_ROLE from ${oldOperatorAddress} on old SMOHelper (${oldSmoHelper.address})`);
    }
  }

  // Check if new operator access was successfully granted
  if (!hasNewOperatorRole) {
    manualActionsNeeded.push(`❌ GRANT OPERATOR_ROLE to ${newOperatorAddress} on new SMOHelper V2 (${smoHelperV2Deployment.address})`);
  }

  // Check if governance multisig has proper access
  if (!hasGovernanceOperatorRole) {
    manualActionsNeeded.push(`❌ GRANT OPERATOR_ROLE to governance multisig (${config.walletAddresses.governanceMultisig}) on new SMOHelper V2`);
  }

  // Check if deployer has admin access
  if (!deployerHasAdminRole) {
    manualActionsNeeded.push(`❌ GRANT DEFAULT_ADMIN_ROLE to deployer (${deployer}) on new SMOHelper V2`);
  }

  // Check contract address configurations
  if (deployedDStableAddress !== dToken.address) {
    manualActionsNeeded.push(`❌ VERIFY dSTABLE address configuration on new SMOHelper V2`);
  }
  if (deployedRedeemerAddress !== dRedeemer.address) {
    manualActionsNeeded.push(`❌ VERIFY Redeemer address configuration on new SMOHelper V2`);
  }
  if (deployedIssuerAddress !== dIssuer.address) {
    manualActionsNeeded.push(`❌ VERIFY Issuer address configuration on new SMOHelper V2`);
  }
  if (deployedUniswapRouterAddress !== config.uniswapRouter) {
    manualActionsNeeded.push(`❌ VERIFY Uniswap Router address configuration on new SMOHelper V2`);
  }

  // Display manual actions if any
  if (manualActionsNeeded.length > 0) {
    console.log("\n⚠️  MANUAL ACTIONS REQUIRED:");
    manualActionsNeeded.forEach((action, index) => {
      console.log(`   ${index + 1}. ${action}`);
    });
    console.log("\n📝 Instructions:");
    console.log("   • Use the contract's grantRole() and revokeRole() functions");
    console.log("   • Ensure you have the appropriate admin privileges");
    console.log("   • Verify all addresses are correct before executing");
    console.log("   • Test the new SMOHelper V2 functionality after manual fixes");
  } else {
    console.log("✅ No manual actions required - all operations completed successfully!");
  }

  // Additional recommendations
  console.log("\n💡 Additional Recommendations:");
  console.log("   • Update any frontend/backend integrations to use the new SMOHelper V2 address");
  console.log("   • Consider pausing the old SMOHelper contract if no longer needed");
  console.log("   • Monitor the new SMOHelper V2 for proper operation");
  console.log("   • Update documentation with the new contract address");

  console.log(`☯️ ${__filename.split("/").slice(-1)[0]}: ${manualActionsNeeded.length > 0 ? "⚠️ (manual actions needed)" : "✅"}`);

  return true;
};

func.id = "D_SmoHelperV2";
func.tags = ["d", "smo-helper-v2", "migration"];
func.dependencies = [D_TOKEN_ID, D_REDEEMER_CONTRACT_ID, D_ISSUER_CONTRACT_ID, D_SMO_HELPER_ID];

export default func;
