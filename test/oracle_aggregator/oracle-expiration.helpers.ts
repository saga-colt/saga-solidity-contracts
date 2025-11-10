import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

/**
 * Advances block timestamp by specified seconds
 * @param seconds Number of seconds to advance
 */
export async function advanceTime(seconds: bigint): Promise<void> {
  await time.increase(Number(seconds));
}

/**
 * Sets block timestamp to a specific value
 * @param timestamp Target timestamp
 */
export async function setTime(timestamp: bigint): Promise<void> {
  await time.setNextBlockTimestamp(Number(timestamp));
}

/**
 * Gets current block timestamp
 * @returns Current block timestamp
 */
export async function getCurrentTime(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block!.timestamp);
}

/**
 * Calculates timestamp that is specified seconds in the future
 * @param secondsFromNow Number of seconds from now
 * @returns Future timestamp
 */
export async function getFutureTime(secondsFromNow: bigint): Promise<bigint> {
  const now = await getCurrentTime();
  return now + secondsFromNow;
}

/**
 * Calculates timestamp that is specified seconds in the past
 * @param secondsAgo Number of seconds ago
 * @returns Past timestamp
 */
export async function getPastTime(secondsAgo: bigint): Promise<bigint> {
  const now = await getCurrentTime();
  return now - secondsAgo;
}

/**
 * Creates a time scenario for testing expiration logic
 * @param setTimestamp Timestamp when override/feed is set
 * @param checkTimestamp Timestamp when we check expiration
 * @returns Object with setTime, checkTime, and helper to advance
 */
export async function createTimeScenario(setTimestamp: bigint, checkTimestamp: bigint) {
  return {
    setTime: setTimestamp,
    checkTime: checkTimestamp,
    async setup() {
      await setTime(setTimestamp);
    },
    async advance() {
      await setTime(checkTimestamp);
    },
    isExpired(): boolean {
      return checkTimestamp > setTimestamp;
    },
  };
}
