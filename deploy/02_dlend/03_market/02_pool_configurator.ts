import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  CONFIGURATOR_LOGIC_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_CONFIGURATOR_ID,
  RESERVES_SETUP_HELPER_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!config.dLend) {
    console.log("No dLend configuration found for this network. Skipping dLend deployment.");
    return true;
  }

  // Get addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  // Get configurator logic library
  const configuratorLogicDeployment = await hre.deployments.get(CONFIGURATOR_LOGIC_ID);

  // Deploy pool configurator implementation
  console.log("[dLend] Deploying PoolConfigurator implementation...");
  const poolConfiguratorArtifact = await hre.deployments.getExtendedArtifact("PoolConfigurator");
  const poolConfiguratorFactory = await hre.ethers.getContractFactory("PoolConfigurator", {
    libraries: {
      ConfiguratorLogic: configuratorLogicDeployment.address,
    },
    signer,
  });

  const deployTx = await poolConfiguratorFactory.getDeployTransaction();
  const estimatedGas = await signer.provider.estimateGas({
    from: deployer,
    data: deployTx.data,
  });
  const gasLimit = estimatedGas + 200_000n; // add ~5% buffer to avoid out-of-gas without tripping RPC guardrails

  const deploymentResponse = await signer.sendTransaction({
    data: deployTx.data,
    gasLimit,
  });
  const receipt = await deploymentResponse.wait();
  const poolConfiguratorAddress = receipt?.contractAddress;

  if (!poolConfiguratorAddress) {
    throw new Error("PoolConfigurator deployment failed: contract address missing in receipt");
  }

  await hre.deployments.save(POOL_CONFIGURATOR_ID, {
    ...poolConfiguratorArtifact,
    address: poolConfiguratorAddress,
    transactionHash: deploymentResponse.hash,
  });

  // Initialize implementation
  console.log("[dLend] Initializing PoolConfigurator...");
  const poolConfig = await hre.ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress);
  const initializeGasEstimate = await signer.provider.estimateGas({
    to: poolConfiguratorAddress,
    data: poolConfig.interface.encodeFunctionData("initialize", [addressesProviderAddress]),
    from: deployer,
  });
  const initializeGasLimit = initializeGasEstimate + 100_000n;
  await (await poolConfig.initialize(addressesProviderAddress, { gasLimit: initializeGasLimit })).wait();

  // Deploy reserves setup helper
  await hre.deployments.deploy(RESERVES_SETUP_HELPER_ID, {
    from: deployer,
    args: [],
    contract: "ReservesSetupHelper",
    autoMine: true,
    log: false,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  // Return true to indicate deployment success
  return true;
};

func.id = "dLend:PoolConfigurator";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];

export default func;
