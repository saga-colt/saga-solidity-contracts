import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig as getLocalhostConfig } from "./networks/localhost";
import { getConfig as getSagaMainNetConfig } from "./networks/saga_mainnet";
import { getConfig as getSagaTestNetConfig } from "./networks/saga_testnet";
import { Config } from "./types";

/**
 * Get the configuration for the network
 *
 * @param hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(hre: HardhatRuntimeEnvironment): Promise<Config> {
  switch (hre.network.name) {
    case "saga_testnet":
      return getSagaTestNetConfig(hre);
    case "saga_mainnet":
      return getSagaMainNetConfig(hre);
    case "hardhat":
    case "localhost":
      return getLocalhostConfig(hre);
    default:
      throw new Error(`Unknown network: ${hre.network.name}`);
  }
}
