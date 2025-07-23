import { Config } from "../types";

/**
 * Get the config for the localhost network
 *
 * @returns The config for the localhost network
 */
export async function getConfig(): Promise<Config> {
  return {
    parentDeploymentAddresses: {
      poolAddressesProvider: "<need-to-be-filled>",
      poolDataProvider: "<need-to-be-filled>",
      aaveOracle: "<need-to-be-filled>",
      liquidationLogic: "<need-to-be-filled>",
    },
    tokenProxyContractMap: {}, // No proxy contract on localhost
    liquidatorBotOdos: {
      flashMinters: {
        dUSD: "0x00000000000000000000000000000000000000E3", // dummy address
        dS: "0x00000000000000000000000000000000000000F2", // dummy address
      },
      slippageTolerance: 100, // 1% (in basis points)
      healthFactorThreshold: 100000000000000000, // 0.1 in Wei
      healthFactorBatchSize: 10,
      reserveBatchSize: 5,
      profitableThresholdInUSD: 1, // $1
      liquidatingBatchSize: 2,
      graphConfig: {
        url: "http://localhost:8000/subgraphs/name/dtrinity/dlending",
        batchSize: 1000,
      },
      isUnstakeTokens: {},
      odosRouter: "0x00000000000000000000000000000000000000F2",
      odosApiUrl: "https://api.odos.xyz",
    },
  };
}
