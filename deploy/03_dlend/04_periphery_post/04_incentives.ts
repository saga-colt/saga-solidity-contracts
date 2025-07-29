import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  EMISSION_MANAGER_ID,
  INCENTIVES_IMPL_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  PULL_REWARDS_TRANSFER_STRATEGY_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, save, getExtendedArtifact } = deployments;
  const { deployer } = await getNamedAccounts();
  const config = await getConfig(hre);

  // Get AddressesProvider address
  const addressesProvider = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressesProviderInstance = await ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProvider.address,
    await ethers.getSigner(deployer)
  );

  // Deploy EmissionManager
  const emissionManager = await deploy(EMISSION_MANAGER_ID, {
    from: deployer,
    args: [deployer],
    log: true,
    waitConfirmations: 1,
  });

  // Deploy Incentives Implementation (RewardsController)
  const incentivesImpl = await deploy(INCENTIVES_IMPL_ID, {
    from: deployer,
    args: [emissionManager.address],
    log: true,
    waitConfirmations: 1,
  });

  const incentivesImplContract = await ethers.getContractAt(
    "RewardsController",
    incentivesImpl.address
  );

  // Initialize the implementation
  try {
    await incentivesImplContract.initialize(ZeroAddress);
  } catch (error: any) {
    if (
      error?.message.includes("Contract instance has already been initialized")
    ) {
      console.log("Incentives implementation already initialized");
    } else {
      throw Error(`Failed to initialize Incentives implementation: ${error}`);
    }
  }

  // The Rewards Controller must be set at AddressesProvider with id keccak256("INCENTIVES_CONTROLLER")
  const incentivesControllerId = ethers.keccak256(
    ethers.toUtf8Bytes("INCENTIVES_CONTROLLER")
  );

  const isRewardsProxyPending =
    (await addressesProviderInstance.getAddressFromID(
      incentivesControllerId
    )) === ZeroAddress;

  if (isRewardsProxyPending) {
    const proxyArtifact = await getExtendedArtifact(
      "InitializableImmutableAdminUpgradeabilityProxy"
    );

    const _setRewardsAsProxyTx =
      await addressesProviderInstance.setAddressAsProxy(
        incentivesControllerId,
        incentivesImpl.address
      );

    const proxyAddress = await addressesProviderInstance.getAddressFromID(
      incentivesControllerId
    );

    if (proxyAddress === ZeroAddress) {
      throw new Error(
        "Failed to deploy IncentivesProxy: obtained zero address from AddressesProvider"
      );
    }

    await save(INCENTIVES_PROXY_ID, {
      ...proxyArtifact,
      address: proxyAddress,
    });
  }

  // Try to load existing artifact (may be undefined if it was deleted)
  let incentivesProxyAddress: string | undefined;
  const existingProxyDeploy = await deployments.getOrNull(INCENTIVES_PROXY_ID);
  if (existingProxyDeploy && existingProxyDeploy.address !== ZeroAddress) {
    incentivesProxyAddress = existingProxyDeploy.address;
  }

  // If artifact missing or zero, attempt to fetch from on-chain AddressesProvider
  if (!incentivesProxyAddress || incentivesProxyAddress === ZeroAddress) {
    const proxyAddressOnChain =
      await addressesProviderInstance.getAddressFromID(incentivesControllerId);

    if (proxyAddressOnChain !== ZeroAddress) {
      const proxyArtifact = await getExtendedArtifact(
        "InitializableImmutableAdminUpgradeabilityProxy"
      );

      await save(INCENTIVES_PROXY_ID, {
        ...proxyArtifact,
        address: proxyAddressOnChain,
      });

      incentivesProxyAddress = proxyAddressOnChain;
    } else {
      throw new Error(
        "IncentivesProxy address not found on-chain and artifact missing/invalid. Deployment cannot continue."
      );
    }
  }

  // Initialize EmissionManager with the rewards controller address
  const emissionManagerContract = await ethers.getContractAt(
    "EmissionManager",
    emissionManager.address
  );

  if (incentivesProxyAddress) {
    await emissionManagerContract.setRewardsController(incentivesProxyAddress);
  } else {
    console.log(
      "Warning: IncentivesProxy address is undefined, skipping setRewardsController"
    );
  }

  // Deploy Rewards Strategies
  await deploy(PULL_REWARDS_TRANSFER_STRATEGY_ID, {
    from: deployer,
    args: [
      incentivesProxyAddress,
      config.walletAddresses.governanceMultisig, // This is the REWARDS_ADMIN
      config.walletAddresses.incentivesVault, // This is where we pull the rewards from
    ],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:Incentives";
func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = [
  "dlend-core",
  "dlend-periphery-pre",
  "dlend-market",
  "PoolAddressesProvider",
];

export default func;
