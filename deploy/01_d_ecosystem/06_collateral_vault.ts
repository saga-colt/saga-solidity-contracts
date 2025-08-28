import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  D_COLLATERAL_VAULT_CONTRACT_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  await hre.deployments.deploy(D_COLLATERAL_VAULT_CONTRACT_ID, {
    from: deployer,
    args: [oracleAggregatorAddress],
    contract: "CollateralHolderVault",
    autoMine: true,
    log: false,
  });

  console.log(`☯️ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = D_COLLATERAL_VAULT_CONTRACT_ID;
func.tags = ["d", "d-collateral-vault"];
func.dependencies = ["usd-oracle"];

export default func;
