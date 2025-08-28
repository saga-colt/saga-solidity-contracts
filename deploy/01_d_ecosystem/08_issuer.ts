import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  D_AMO_MANAGER_ID,
  D_COLLATERAL_VAULT_CONTRACT_ID,
  D_ISSUER_CONTRACT_ID,
  D_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get deployed addresses
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  const { address: collateralVaultAddress } = await hre.deployments.get(
    D_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const { tokenAddresses } = await getConfig(hre);
  const { address: amoManagerAddress } =
    await hre.deployments.get(D_AMO_MANAGER_ID);

  await hre.deployments.deploy(D_ISSUER_CONTRACT_ID, {
    from: deployer,
    args: [
      collateralVaultAddress,
      tokenAddresses.D,
      oracleAggregatorAddress,
      amoManagerAddress,
    ],
    contract: "IssuerV2",
    autoMine: true,
    log: false,
  });

  // Get the deployed IssuerV2 contract address
  const { address: issuerAddress } =
    await hre.deployments.get(D_ISSUER_CONTRACT_ID);

  // Grant MINTER_ROLE to the IssuerV2 contract so it can mint d
  const dContract = await hre.ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    tokenAddresses.D,
  );

  const MINTER_ROLE = await dContract.MINTER_ROLE();

  await dContract.grantRole(MINTER_ROLE, issuerAddress);
  console.log(`Granted MINTER_ROLE to IssuerV2 contract at ${issuerAddress}`);

  console.log(`☯️ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = D_ISSUER_CONTRACT_ID;
func.tags = ["d"];
func.dependencies = [
  D_COLLATERAL_VAULT_CONTRACT_ID,
  D_TOKEN_ID,
  "usd-oracle",
  D_AMO_MANAGER_ID,
];

export default func;
