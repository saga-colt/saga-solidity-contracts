import { DUSD_A_TOKEN_WRAPPER_ID } from "../deploy-ids";

const DLEND_A_TOKEN_WRAPPER_PREFIX = "dLend_ATokenWrapper";

/**
 * Generates a deployment ID for a dLEND wrapped aToken (StaticATokenLM) based on convention.
 *
 * @param dStableSymbol The symbol of the underlying dStable ("D")
 * @returns The derived deployment ID (e.g., "dLend_ATokenWrapper_D")
 */
export const getWrappedATokenId = (dStableSymbol: string): string => {
  // Use the existing constants for well-known dStables
  if (dStableSymbol === "D") {
    return DUSD_A_TOKEN_WRAPPER_ID;
  }
  // For any other dStable, use the standard prefix
  return `${DLEND_A_TOKEN_WRAPPER_PREFIX}_${dStableSymbol}`;
};
