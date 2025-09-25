import { isAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  D_REDEEMER_CONTRACT_ID,
  D_SMO_HELPER_ID,
  D_TOKEN_ID,
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
  if (
    !config.walletAddresses?.governanceMultisig ||
    !isAddress(config.walletAddresses.governanceMultisig)
  ) {
    missingConfigs.push("walletAddresses.governanceMultisig");
  }

  // If any required config values are missing, skip deployment
  if (missingConfigs.length > 0) {
    console.log(
      `⚠️  Skipping SMOHelper deployment - missing configuration values: ${missingConfigs.join(", ")}`,
    );
    console.log(`☯️  ${__filename.split("/").slice(-1)[0]}: ⏭️  (skipped)`);
    return true;
  }

  // Get required contract addresses
  const dToken = await get(D_TOKEN_ID);
  const dRedeemer = await get(D_REDEEMER_CONTRACT_ID);

  // Deploy SMOHelper
  const smoHelperDeployment = await deploy(D_SMO_HELPER_ID, {
    from: deployer,
    contract: "SMOHelper",
    args: [
      dToken.address, // dstable
      dRedeemer.address, // redeemer
      config.uniswapRouter, // uniswapRouter
      config.walletAddresses.governanceMultisig, // operator
    ],
  });

  // Verify the deployment and check roles
  const smoHelperContract = await hre.ethers.getContractAt(
    "SMOHelper",
    smoHelperDeployment.address,
    await hre.ethers.getSigner(deployer),
  );

  // Check if the governance multisig has the OPERATOR_ROLE
  const operatorRole = await smoHelperContract.OPERATOR_ROLE();
  const hasOperatorRole = await smoHelperContract.hasRole(
    operatorRole,
    config.walletAddresses.governanceMultisig,
  );

  if (!hasOperatorRole) {
    console.log(
      "⚠️  Governance multisig does not have OPERATOR_ROLE - this should not happen as it's set in constructor",
    );
  } else {
    console.log("✅ Governance multisig has OPERATOR_ROLE");
  }

  // Check if the deployer has DEFAULT_ADMIN_ROLE (should be true from constructor)
  const adminRole = await smoHelperContract.DEFAULT_ADMIN_ROLE();
  const deployerHasAdminRole = await smoHelperContract.hasRole(
    adminRole,
    deployer,
  );

  if (!deployerHasAdminRole) {
    console.log(
      "⚠️  Deployer does not have DEFAULT_ADMIN_ROLE - this should not happen as it's set in constructor",
    );
  } else {
    console.log("✅ Deployer has DEFAULT_ADMIN_ROLE");
  }

  // Verify contract addresses are correctly set
  const deployedDStableAddress = await smoHelperContract.getDStableToken();
  const deployedRedeemerAddress = await smoHelperContract.getRedeemer();
  const deployedUniswapRouterAddress =
    await smoHelperContract.getUniswapRouter();

  if (deployedDStableAddress !== dToken.address) {
    console.log(
      `⚠️  DStable address mismatch: expected ${dToken.address}, got ${deployedDStableAddress}`,
    );
  } else {
    console.log("✅ DStable address correctly set");
  }

  if (deployedRedeemerAddress !== dRedeemer.address) {
    console.log(
      `⚠️  Redeemer address mismatch: expected ${dRedeemer.address}, got ${deployedRedeemerAddress}`,
    );
  } else {
    console.log("✅ Redeemer address correctly set");
  }

  if (deployedUniswapRouterAddress !== config.uniswapRouter) {
    console.log(
      `⚠️  Uniswap router address mismatch: expected ${config.uniswapRouter}, got ${deployedUniswapRouterAddress}`,
    );
  } else {
    console.log("✅ Uniswap router address correctly set");
  }

  console.log(`☯️ ${__filename.split("/").slice(-1)[0]}: ✅`);

  return true;
};

func.id = D_SMO_HELPER_ID;
func.tags = ["d", "smo-helper"];
func.dependencies = [D_TOKEN_ID, D_REDEEMER_CONTRACT_ID];

export default func;
