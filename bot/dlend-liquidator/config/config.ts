import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig as getLocalhostConfig } from "./networks/localhost";
import { getConfig as getSagaMainnetConfig } from "./networks/saga_mainnet";
import { Config } from "./types";

/**
 * Get the configuration for the network
 *
 * @param hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  hre: HardhatRuntimeEnvironment,
): Promise<Config> {
  switch (hre.network.name) {
    case "saga_mainnet":
      return getSagaMainnetConfig();
    case "hardhat":
    case "localhost":
      return getLocalhostConfig();
    default:
      throw new Error(`Unknown network: ${hre.network.name}`);
  }
}
