import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getConfig } from "../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // Skip this deployment since dPOOL was removed and MockCurveStableSwapNG no longer exists
  console.log("🚫 Skipping mock Curve pool deployment - dPOOL system was removed");
  console.log(`🎱 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "curve"];
func.dependencies = ["tokens"];
func.id = "local_curve_pools_setup";

export default func; 