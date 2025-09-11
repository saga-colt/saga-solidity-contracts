import { deployments } from "hardhat";
import hre from "hardhat";
import {
  USD_ORACLE_AGGREGATOR_ID,
  D_HARD_PEG_ORACLE_WRAPPER_ID,
  USD_TELLOR_ORACLE_WRAPPER_ID,
  USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";
import {
  OracleAggregator,
  HardPegOracleWrapper,
  TellorWrapper,
  TellorWrapperWithThresholding,
} from "../../typechain-types";
import { getConfig } from "../../config/config";
import { OracleAggregatorConfig } from "../../config/types";

/**
 * Configuration for oracle aggregator fixtures
 */
export interface OracleAggregatorFixtureConfig extends OracleAggregatorConfig {
  currency: string;
  deploymentTag: string;
  oracleAggregatorId: string;
  wrapperIds: {
    hardPegWrapper: string;
    tellorWrapper: string;
    tellorWrapperWithThresholding: string;
  };
}

/**
 * Return type for oracle aggregator fixtures
 */
export interface OracleAggregatorFixtureResult {
  config: OracleAggregatorFixtureConfig;
  contracts: {
    oracleAggregator: OracleAggregator;
    hardPegWrapper?: HardPegOracleWrapper;
    tellorWrapper: TellorWrapper;
    tellorWrapperWithThresholding: TellorWrapperWithThresholding;
  };
  assets: {
    allAssets: string[];
    // Tellor Assets
    tellorPlainAssets: {
      [address: string]: { address: string; feed: string };
    };
    tellorThresholdAssets: {
      [address: string]: {
        address: string;
        feed: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
  };
  mockOracles: {
    [feedName: string]: string;
  };
}

/**
 * Create a fixture factory for any oracle aggregator based on its configuration
 */
export const createOracleAggregatorFixture = (
  config: OracleAggregatorFixtureConfig
) => {
  return deployments.createFixture(
    async ({
      deployments,
      getNamedAccounts,
      ethers,
    }): Promise<OracleAggregatorFixtureResult> => {
      const { deployer } = await getNamedAccounts();

      // Deploy only the necessary components for oracle testing (avoid dStake dependencies)
      if (config.currency === "USD") {
        await deployments.fixture([
          "deploy-mocks",
          "usd-oracle",
          "d",
          "local-setup",
        ]);
      } else {
        throw new Error(
          `Unsupported currency: ${config.currency}. Only USD is supported.`
        );
      }

      // Get contract instances
      const { address: oracleAggregatorAddress } = await deployments.get(
        config.oracleAggregatorId
      );
      const oracleAggregator = await ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress
      );

      // Hard peg wrapper is only available for USD currency (for dUSD)
      let hardPegWrapper: HardPegOracleWrapper | undefined;
      if (config.wrapperIds.hardPegWrapper) {
        const { address: hardPegWrapperAddress } = await deployments.get(
          config.wrapperIds.hardPegWrapper
        );
        hardPegWrapper = await ethers.getContractAt(
          "HardPegOracleWrapper",
          hardPegWrapperAddress
        );
      }

      // Get Tellor wrapper instances
      const { address: tellorWrapperAddress } =
        await deployments.get(config.wrapperIds.tellorWrapper);
      const tellorWrapper = await ethers.getContractAt(
        "TellorWrapper",
        tellorWrapperAddress
      );

      const { address: tellorWrapperWithThresholdingAddress } =
        await deployments.get(
          config.wrapperIds.tellorWrapperWithThresholding
        );
      const tellorWrapperWithThresholding =
        await ethers.getContractAt(
          "TellorWrapperWithThresholding",
          tellorWrapperWithThresholdingAddress
        );

      // Find the mock oracle deployments
      const mockOracles: { [feedName: string]: string } = {};
      const allDeployments = await deployments.all();

      // Group Tellor assets by their oracle type
      const tellorPlainAssets: {
        [address: string]: { address: string; feed: string };
      } = {};
      const tellorThresholdAssets: {
        [address: string]: {
          address: string;
          feed: string;
          lowerThreshold: bigint;
          fixedPrice: bigint;
        };
      } = {};

      // Populate Tellor plain assets
      for (const [address, feed] of Object.entries(
        config.tellorOracleAssets?.plainTellorOracleWrappers || {}
      )) {
        tellorPlainAssets[address] = {
          address,
          feed,
        };
      }

      // Populate Tellor threshold assets
      for (const [address, data] of Object.entries(
        config.tellorOracleAssets?.tellorOracleWrappersWithThresholding || {}
      )) {
        tellorThresholdAssets[address] = {
          address,
          feed: data.feed,
          lowerThreshold: data.lowerThreshold,
          fixedPrice: data.fixedPrice,
        };
      }

      const allAssets = Object.keys(tellorPlainAssets).concat(
        Object.keys(tellorThresholdAssets)
      );

      return {
        config,
        contracts: {
          oracleAggregator,
          hardPegWrapper,
          tellorWrapper,
          tellorWrapperWithThresholding,
        },
        assets: {
          allAssets,
          // Tellor Assets
          tellorPlainAssets,
          tellorThresholdAssets,
        },
        mockOracles,
      };
    }
  );
};

/**
 * Helper function to get an oracle aggregator fixture by currency
 * @param currency The currency to get the fixture for (only "USD" is supported)
 * @returns The fixture for the specified currency
 */
export const getOracleAggregatorFixture = async (currency: string) => {
  if (currency !== "USD") {
    throw new Error(
      `Unsupported currency: ${currency}. Only USD oracle aggregator is supported.`
    );
  }

  const config = await getConfig(hre);
  const oracleAggregatorConfig = config.oracleAggregators[currency];

  if (!oracleAggregatorConfig) {
    throw new Error(
      `No oracle aggregator config found for currency ${currency}`
    );
  }

  const fixtureConfig: OracleAggregatorFixtureConfig = {
    ...oracleAggregatorConfig,
    currency,
    deploymentTag: "usd-oracle",
    oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
    wrapperIds: {
      hardPegWrapper: D_HARD_PEG_ORACLE_WRAPPER_ID,
      tellorWrapper: USD_TELLOR_ORACLE_WRAPPER_ID,
      tellorWrapperWithThresholding:
        USD_TELLOR_WRAPPER_WITH_THRESHOLDING_ID,
    },
  };

  return createOracleAggregatorFixture(fixtureConfig);
};

/**
 * Helper function to check if an asset has a mock oracle
 * @param mockOracles The mock oracles object from the fixture
 * @param assetSymbol The asset symbol to check
 * @param baseCurrency The base currency (e.g., "USD", "wS")
 * @returns True if the asset has a mock oracle, false otherwise
 */
export function hasOracleForAsset(
  mockOracles: { [feedName: string]: string },
  assetSymbol: string,
  baseCurrency: string
): boolean {
  const directFeed = `${assetSymbol}_${baseCurrency}`;
  return directFeed in mockOracles;
}

/**
 * Helper function to log available oracles for debugging
 * @param mockOracles The mock oracles object from the fixture
 */
export function logAvailableOracles(mockOracles: {
  [feedName: string]: string;
}): void {
  console.log("Available mock oracles:");
  for (const [feedName, address] of Object.entries(mockOracles)) {
    console.log(`  ${feedName}: ${address}`);
  }
}

/**
 * Helper function to get a random item from a list
 * @param list The list to get a random item from
 * @returns A randomly selected item from the list
 * @throws Error if the list is empty
 */
export function getRandomItemFromList(list: string[]): string {
  if (list.length === 0) {
    throw new Error("List is empty");
  }
  const randomIndex = Math.floor(Math.random() * list.length);
  return list[randomIndex];
}
