/* eslint-disable @typescript-eslint/explicit-function-return-type -- helper wrappers and config objects are self-typed by Hardhat */
import "@typechain/hardhat";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import "dotenv/config";

import { extendEnvironment, HardhatUserConfig } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getEnvPrivateKeys } from "./typescript/hardhat/named-accounts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Wrapper function to add a delay to transactions

const wrapSigner = (signer: any, hre: HardhatRuntimeEnvironment) => {
  const originalSendTransaction = signer.sendTransaction;

  signer.sendTransaction = async (tx: any) => {
    const result = await originalSendTransaction.apply(signer, [tx]);

    if (hre.network.live) {
      const sleepTime = 5000;
      console.log(`\n>>> Waiting ${sleepTime}ms after transaction to ${result.to || "a new contract"}`);
      await sleep(sleepTime);
    }
    return result;
  };
  return signer;
};

extendEnvironment((hre: HardhatRuntimeEnvironment) => {
  // Wrap hre.ethers.getSigner
  const originalGetSigner = hre.ethers.getSigner;

  hre.ethers.getSigner = async (address) => {
    const signer = await originalGetSigner(address);
    return wrapSigner(signer, hre);
  };

  // Wrap hre.ethers.getSigners
  const originalGetSigners = hre.ethers.getSigners;

  hre.ethers.getSigners = async () => {
    const signers = await originalGetSigners();
    return signers.map((signer) => wrapSigner(signer, hre));
  };
});

/* eslint-disable camelcase -- Network names follow specific naming conventions that require snake_case */
const config: HardhatUserConfig = {
  //
  // Compile settings -------------------------------------------------------
  //  • Default: classic solc pipeline (fast) with optimizer.
  //  • Set env `VIA_IR=true` to enable the IR pipeline for **all** contracts.
  //  • Always compile complex contracts and their dependencies with IR to avoid
  //    "stack too deep" errors, without slowing down the whole codebase.
  // -----------------------------------------------------------------------
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
          ...(process.env.VIA_IR === "true" ? { viaIR: true } : {}),
        },
      },
      {
        version: "0.8.10",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
          ...(process.env.VIA_IR === "true" ? { viaIR: true } : {}),
        },
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          ...(process.env.VIA_IR === "true" ? { viaIR: true } : {}),
        },
      },
      {
        version: "0.8.22",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          ...(process.env.VIA_IR === "true" ? { viaIR: true } : {}),
        },
      },
    ],
    overrides: {
      // DStake router with stack too deep errors
      "contracts/vaults/dstake/DStakeRouterDLend.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // Contracts that import DStakeRouterDLend
      "contracts/vaults/dstake/rewards/DStakeRewardManagerDLend.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      // UniswapV3 contracts - force to use 0.7.6
      "contracts/Uniswap/Uniswapv3/Libraries/TickBitmap.sol": {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
        },
      },
      "contracts/Uniswap/Uniswapv3/UniswapV3Pool.sol": {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
        },
      },
      "contracts/Uniswap/Uniswapv3/NoDelegateCall.sol": {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999999,
          },
        },
      },
      // UniswapV3 interfaces - use 0.8.20
      "contracts/Uniswap/Uniswapv3/interfaces/ISwapRouter.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      "contracts/Uniswap/Uniswapv3/interfaces/IUniswapV3Pool.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      "contracts/Uniswap/Uniswapv3/interfaces/IUniswapV3PoolDeployer.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      // SMOHelper contract - use viaIR to avoid stack too deep errors
      "contracts/dstable/SMOHelper.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhat: {
      deploy: ["deploy-mocks", "deploy"],
      allowUnlimitedContractSize: true,
      saveDeployments: false, // allow testing without needing to remove the previous deployments
      // Forking configuration - can be overridden via environment variables
      forking: process.env.FORK_URL
        ? {
            url: process.env.FORK_URL,
            blockNumber: process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined,
            enabled: true,
          }
        : undefined,
      // Configure hardfork for Saga network compatibility
      hardfork: "london", // Use istanbul to avoid hardfork activation issues
      // Set chain ID to match the forked network when forking
      chainId: 5464,
      // Set gas price to 0 for Saga network compatibility
      gasPrice: 0,
    },
    localhost: {
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
    },
    saga_testnet: {
      // https://docs.soniclabs.com/sonic/build-on-sonic/getting-started
      url: `https://sagaevm.jsonrpc.sagarpc.io/`,
      deploy: ["deploy-mocks", "deploy"],
      saveDeployments: true,
      accounts: getEnvPrivateKeys("saga_testnet"),
      gasPrice: 0,
      live: true,
    },
    saga_mainnet: {
      url: `https://sagaevm.jsonrpc.sagarpc.io/`,
      deploy: ["deploy"], // NOTE: DO NOT DEPLOY mocks
      saveDeployments: true,
      accounts: getEnvPrivateKeys("saga_mainnet"),
      gasPrice: 0,
      live: true,
      chainId: 5464,
    },
  },
  namedAccounts: {
    deployer: 0,
    user1: 1,
    user2: 2,
    user3: 3,
    user4: 4,
    user5: 5,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deployments: "./deployments",
    deploy: "./deploy",
  },
  gasReporter: {
    enabled: false, // Enable this when testing new complex functions
  },
  etherscan: {
    apiKey: {
      saga_mainnet: "empty",
      sagaevm: "empty",
    },
    customChains: [
      {
        network: "saga_mainnet",
        chainId: 5464,
        urls: {
          apiURL: "https://api-sagaevm.sagaexplorer.io/api",
          browserURL: "https://sagaevm.sagaexplorer.io",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
};
/* eslint-enable camelcase -- Re-enabling camelcase rule after network definitions */

export default config;
/* eslint-enable @typescript-eslint/explicit-function-return-type -- re-enable rule after config definition */
