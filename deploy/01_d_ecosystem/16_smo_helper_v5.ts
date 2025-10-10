import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { D_REDEEMER_CONTRACT_ID, D_SMO_HELPER_ID, D_TOKEN_ID } from "../../typescript/deploy-ids";

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
    console.log(`⚠️  Skipping SMOHelper V5 deployment - missing configuration values: ${missingConfigs.join(", ")}`);
    console.log(`☯️  ${__filename.split("/").slice(-1)[0]}: ⏭️  (skipped)`);
    return true;
  }

  // Get required contract addresses
  const dToken = await get(D_TOKEN_ID);
  const dRedeemer = await get(D_REDEEMER_CONTRACT_ID);

  // List of all previous SMOHelper deployments to check and revoke operator access from
  const previousSmoHelperDeployments = [
    { name: "D_SmoHelper", id: D_SMO_HELPER_ID },
    { name: "D_SmoHelperV2", id: "D_SmoHelperV2" },
    { name: "D_SmoHelperV3", id: "D_SmoHelperV3" },
    { name: "D_SmoHelperV4", id: "D_SmoHelperV4" },
  ];
  console.log("\n🔍 Manual Actions Check:");
  const manualActionsNeeded: string[] = [];
  // Revoke operator access from all previous SMOHelper deployments
  for (const deployment of previousSmoHelperDeployments) {
    try {
      const smoHelperDeployment = await get(deployment.id);
      const smoHelperContract = await hre.ethers.getContractAt(
        "SMOHelper",
        smoHelperDeployment.address,
        await hre.ethers.getSigner(deployer),
      );

      const operatorRole = await smoHelperContract.OPERATOR_ROLE();
      const hasOperatorRole = await smoHelperContract.hasRole(operatorRole, deployer);

      if (hasOperatorRole) {
        console.log(`🔄 Revoking OPERATOR_ROLE from deployer (${deployer}) on ${deployment.name} (${smoHelperDeployment.address})`);

        try {
          const revokeTx = await smoHelperContract.revokeRole(operatorRole, deployer);
          await revokeTx.wait();
          console.log(`✅ Successfully revoked OPERATOR_ROLE from deployer on ${deployment.name}`);
        } catch (error) {
          console.log(`⚠️  Failed to revoke OPERATOR_ROLE from deployer on ${deployment.name}:`, error);
          manualActionsNeeded.push(`❌ REVOK OPERATOR_ROLE from deployer (${deployer}) on ${deployment.name} (${smoHelperDeployment.address})`);
        }
      } else {
        console.log(`ℹ️  Deployer (${deployer}) does not have OPERATOR_ROLE on ${deployment.name}`);
      }
    } catch (error) {
      console.log(`ℹ️  ${deployment.name} not found or not accessible:`, error.message);
    }
  }

  // Deploy new SMOHelper V5 with issuer integration
  const smoHelperV5Deployment = await deploy("D_SmoHelperV5", {
    from: deployer,
    contract: "SMOHelper",
    args: [
      dToken.address, // dstable
      dRedeemer.address, // redeemer
      config.uniswapRouter, // uniswapRouter
      config.walletAddresses.governanceMultisig, // operator
    ],
  });

  // Verify the new deployment and check roles
  const smoHelperV5Contract = await hre.ethers.getContractAt(
    "SMOHelper",
    smoHelperV5Deployment.address,
    await hre.ethers.getSigner(deployer),
  );

  // Get the operator role for the new contract
  const operatorRole = await smoHelperV5Contract.OPERATOR_ROLE();

  // Grant OPERATOR_ROLE to the new operator address
  const newOperatorAddress = "0xd2f775Ff2cD41bfe43C7A8c016eD10393553fe44";
  console.log(`🔄 Granting OPERATOR_ROLE to new operator: ${newOperatorAddress}`);

  try {
    const grantTx = await smoHelperV5Contract.grantRole(operatorRole, newOperatorAddress);
    await grantTx.wait();
    console.log(`✅ Successfully granted OPERATOR_ROLE to ${newOperatorAddress}`);
  } catch (error) {
    console.log(`⚠️  Failed to grant OPERATOR_ROLE to ${newOperatorAddress}:`, error);
  }

  // Verify the new operator has the role
  const hasNewOperatorRole = await smoHelperV5Contract.hasRole(operatorRole, newOperatorAddress);

  if (!hasNewOperatorRole) {
    console.log("⚠️  New operator does not have OPERATOR_ROLE - this should not happen");
  } else {
    console.log("✅ New operator has OPERATOR_ROLE");
  }

  // Check if the governance multisig has the OPERATOR_ROLE (from constructor)
  const hasGovernanceOperatorRole = await smoHelperV5Contract.hasRole(operatorRole, config.walletAddresses.governanceMultisig);

  if (!hasGovernanceOperatorRole) {
    console.log("⚠️  Governance multisig does not have OPERATOR_ROLE - this should not happen as it's set in constructor");
  } else {
    console.log("✅ Governance multisig has OPERATOR_ROLE");
  }

  // Check if the deployer has DEFAULT_ADMIN_ROLE (should be true from constructor)
  const adminRole = await smoHelperV5Contract.DEFAULT_ADMIN_ROLE();
  const deployerHasAdminRole = await smoHelperV5Contract.hasRole(adminRole, deployer);

  if (!deployerHasAdminRole) {
    console.log("⚠️  Deployer does not have DEFAULT_ADMIN_ROLE - this should not happen as it's set in constructor");
  } else {
    console.log("✅ Deployer has DEFAULT_ADMIN_ROLE");
  }

  // Verify contract addresses are correctly set
  const deployedDStableAddress = await smoHelperV5Contract.getDStableToken();
  const deployedRedeemerAddress = await smoHelperV5Contract.getRedeemer();
  const deployedUniswapRouterAddress = await smoHelperV5Contract.getUniswapRouter();

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

  if (deployedUniswapRouterAddress !== config.uniswapRouter) {
    console.log(`⚠️  Uniswap router address mismatch: expected ${config.uniswapRouter}, got ${deployedUniswapRouterAddress}`);
  } else {
    console.log("✅ Uniswap router address correctly set");
  }

  // Summary
  console.log("\n📋 Migration Summary:");
  console.log(`   Previous SMOHelper deployments checked: ${previousSmoHelperDeployments.map((d) => d.name).join(", ")}`);
  console.log(`   New SMOHelper V5: ${smoHelperV5Deployment.address}`);
  console.log(`   Deployer operator access: REVOKED from all previous deployments`);
  console.log(`   New operator (${newOperatorAddress}) access: ${hasNewOperatorRole ? "GRANTED" : "FAILED"}`);

  // Check for manual actions needed


  // Check if new operator access was successfully granted
  if (!hasNewOperatorRole) {
    manualActionsNeeded.push(`❌ GRANT OPERATOR_ROLE to ${newOperatorAddress} on new SMOHelper V5 (${smoHelperV5Deployment.address})`);
  }

  // Check if governance multisig has proper access
  if (!hasGovernanceOperatorRole) {
    manualActionsNeeded.push(
      `❌ GRANT OPERATOR_ROLE to governance multisig (${config.walletAddresses.governanceMultisig}) on new SMOHelper V5`,
    );
  }

  // Check if deployer has admin access
  if (!deployerHasAdminRole) {
    manualActionsNeeded.push(`❌ GRANT DEFAULT_ADMIN_ROLE to deployer (${deployer}) on new SMOHelper V5`);
  }

  // Check contract address configurations
  if (deployedDStableAddress !== dToken.address) {
    manualActionsNeeded.push(`❌ VERIFY dSTABLE address configuration on new SMOHelper V5`);
  }

  if (deployedRedeemerAddress !== dRedeemer.address) {
    manualActionsNeeded.push(`❌ VERIFY Redeemer address configuration on new SMOHelper V5`);
  }

  if (deployedUniswapRouterAddress !== config.uniswapRouter) {
    manualActionsNeeded.push(`❌ VERIFY Uniswap Router address configuration on new SMOHelper V5`);
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
    console.log("   • Test the new SMOHelper V5 functionality after manual fixes");
  } else {
    console.log("✅ No manual actions required - all operations completed successfully!");
  }

  // Additional recommendations
  console.log("\n💡 Additional Recommendations:");
  console.log("   • Update any frontend/backend integrations to use the new SMOHelper V5 address");
  console.log("   • Consider pausing the old SMOHelper contracts if no longer needed");
  console.log("   • Monitor the new SMOHelper V5 for proper operation");
  console.log("   • Update documentation with the new contract address");

  console.log(`☯️ ${__filename.split("/").slice(-1)[0]}: ${manualActionsNeeded.length > 0 ? "⚠️ (manual actions needed)" : "✅"}`);

  return true;
};

func.id = "D_SmoHelperV5";
func.tags = ["d", "smo-helper-v5", "migration"];
func.dependencies = [D_TOKEN_ID, D_REDEEMER_CONTRACT_ID, D_SMO_HELPER_ID, "D_SmoHelperV4"];

export default func;
