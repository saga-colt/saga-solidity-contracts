import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get deployed addresses
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  const { address: collateralVaultAddress } = await hre.deployments.get(
    DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const { tokenAddresses } = await getConfig(hre);
  const { address: amoManagerAddress } =
    await hre.deployments.get(DUSD_AMO_MANAGER_ID);

  await hre.deployments.deploy(DUSD_ISSUER_CONTRACT_ID, {
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
  const { address: issuerAddress } = await hre.deployments.get(
    DUSD_ISSUER_CONTRACT_ID,
  );

  // Grant MINTER_ROLE to the IssuerV2 contract so it can mint dUSD
  const dusdContract = await hre.ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    tokenAddresses.D,
  );

  const MINTER_ROLE = await dusdContract.MINTER_ROLE();

  await dusdContract.grantRole(MINTER_ROLE, issuerAddress);
  console.log(`Granted MINTER_ROLE to IssuerV2 contract at ${issuerAddress}`);

  // Preemptively disable minting for wstkscUSD if it exists in config and is supported by the vault
  // This is to ensure wstkscUSD minting is disabled by default as per requirements
  const config = await getConfig(hre);

  try {
    const wstkscUSDAddress = (config as any).tokenAddresses?.wstkscUSD;

    if (wstkscUSDAddress && wstkscUSDAddress !== "") {
      const vaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultAddress,
      );

      if (await vaultContract.isCollateralSupported(wstkscUSDAddress)) {
        const issuer = await hre.ethers.getContractAt(
          "IssuerV2",
          issuerAddress,
          await hre.ethers.getSigner(deployer),
        );
        const isEnabled = await issuer.isAssetMintingEnabled(wstkscUSDAddress);

        if (isEnabled) {
          await issuer.setAssetMintingPause(wstkscUSDAddress, true);
          console.log(
            `Disabled minting for wstkscUSD on IssuerV2 at ${issuerAddress}`,
          );
        } else {
          console.log(
            `Minting for wstkscUSD already disabled on IssuerV2 at ${issuerAddress}`,
          );
        }
      } else {
        console.log(
          `wstkscUSD not supported by collateral vault; skipping issuer-level pause`,
        );
      }
    } else {
      console.log(
        "wstkscUSD address not present in config; skipping issuer-level pause",
      );
    }
  } catch (e) {
    console.log(
      `Could not check/disable wstkscUSD minting: ${(e as Error).message}`,
    );
  }

  console.log(`☯️ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DUSD_ISSUER_CONTRACT_ID;
func.tags = ["dusd"];
func.dependencies = [
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  "usd-oracle",
  DUSD_AMO_MANAGER_ID,
];

export default func;
