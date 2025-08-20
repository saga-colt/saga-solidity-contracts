import hre from "hardhat";
import {
  DUSD_TOKEN_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_DATA_PROVIDER_ID,
  POOL_PROXY_ID,
} from "../../typescript/deploy-ids";
import { getConfig } from "../../config/config";

async function main() {
  const { ethers, deployments, getNamedAccounts, network } = hre;
  const { deployer } = await getNamedAccounts();

  console.log(`--- dLEND Test Position Setup ---`);
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer}`);

  // Resolve dUSD token address
  const config = await getConfig(hre);
  let dUSDAddress = config.tokenAddresses.D;
  if (!dUSDAddress) {
    const dusdDeployment = await deployments.get(DUSD_TOKEN_ID);
    dUSDAddress = dusdDeployment.address;
  }
  if (!dUSDAddress) throw new Error("dUSD token address not found");

  // Resolve Pool address (prefer saved proxy, fallback to AddressesProvider)
  let poolAddress: string;
  const poolProxy = await deployments.getOrNull(POOL_PROXY_ID);
  if (poolProxy?.address) {
    poolAddress = poolProxy.address;
  } else {
    const addressesProviderDeployment = await deployments.get(
      POOL_ADDRESSES_PROVIDER_ID
    );
    const addressesProvider = await ethers.getContractAt(
      "PoolAddressesProvider",
      addressesProviderDeployment.address
    );
    poolAddress = await addressesProvider.getPool();
  }
  if (!poolAddress) throw new Error("Pool address not found");

  console.log(`dUSD: ${dUSDAddress}`);
  console.log(`Pool: ${poolAddress}`);

  // Signers
  const deployerSigner = await ethers.getSigner(deployer);

  // Contracts
  const dUSDContract = await ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    dUSDAddress,
    deployerSigner
  );

  const decimals = Number(await dUSDContract.decimals());
  const amount = ethers.parseUnits("420", decimals);

  // Step 1: Check deployer dUSD balance
  const deployerBalance = await dUSDContract.balanceOf(deployer);
  console.log(
    `Deployer dUSD balance: ${ethers.formatUnits(deployerBalance, decimals)} D`
  );
  if (deployerBalance < amount) {
    throw new Error(
      `Insufficient dUSD balance in deployer. Need ${ethers.formatUnits(
        amount,
        decimals
      )} D`
    );
  }

  // Step 2: Deployer lends 420 dUSD on dLEND
  console.log(`Approving Pool to spend 420 dUSD from deployer...`);
  const approveTx = await dUSDContract.approve(poolAddress, amount);
  console.log(`approve tx: ${approveTx.hash}`);
  await approveTx.wait();

  const poolAsDeployer = await ethers.getContractAt(
    "IPool",
    poolAddress,
    deployerSigner
  );
  console.log(`Supplying 420 dUSD as deployer...`);
  const supplyTx = await poolAsDeployer.supply(
    dUSDAddress,
    amount,
    deployer,
    0
  );
  console.log(`supply tx: ${supplyTx.hash}`);
  await supplyTx.wait();

  // Optional: show resulting aToken balance for deployer
  try {
    const dataProviderDeployment = await deployments.get(POOL_DATA_PROVIDER_ID);
    const dataProvider = await ethers.getContractAt(
      "AaveProtocolDataProvider",
      dataProviderDeployment.address
    );
    const tokens = await dataProvider.getReserveTokensAddresses(dUSDAddress);
    const aTokenAddress = tokens.aTokenAddress || tokens[0];
    const aToken = await ethers.getContractAt("IERC20Detailed", aTokenAddress);
    const aBal = await aToken.balanceOf(deployer);
    const aSym = await aToken.symbol();
    console.log(
      `Deployer ${aSym} balance after supply: ${ethers.formatUnits(aBal, decimals)}`
    );
  } catch (e) {
    console.log("Skipped aToken balance lookup (optional):", e);
  }

  console.log(
    `\n✅ Finished setting up test position: supplied 420 dUSD from deployer.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
  });
