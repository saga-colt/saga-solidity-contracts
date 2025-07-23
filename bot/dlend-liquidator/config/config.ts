import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig as getLocalhostConfig } from "./networks/localhost";
import { getConfig as getSonicMainnetConfig } from "./networks/sonic_mainnet";
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
    case "sonic_mainnet":
      return getSonicMainnetConfig();
    case "hardhat":
    case "localhost":
      return getLocalhostConfig();
    default:
      throw new Error(`Unknown network: ${hre.network.name}`);
  }
}
