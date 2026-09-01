import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const profile = process.argv[2];
const supportedProfiles = ["smoke", "average", "load", "stress", "acceptance"];
if (!supportedProfiles.includes(profile))
  throw new Error(`Expected one of: ${supportedProfiles.join(", ")}.`);
if (!process.env.BASE_URL) throw new Error("BASE_URL is required.");
const target = new URL(process.env.BASE_URL);
if (
  target.hostname === "orbit.dhkim.cloud" &&
  process.env.CONFIRM_ORBIT_DHKIM_CLOUD !== "true"
) {
  throw new Error("orbit.dhkim.cloud requires CONFIRM_ORBIT_DHKIM_CLOUD=true.");
}
if (profile !== "smoke" && process.env.CONFIRM_LARGE_LOAD !== "true") {
  throw new Error(`${profile} profile requires CONFIRM_LARGE_LOAD=true.`);
}
if (profile !== "smoke" && !process.env.ARTILLERY_PUSHGATEWAY_URL) {
  throw new Error(`${profile} profile requires ARTILLERY_PUSHGATEWAY_URL.`);
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const config = path.join(directory, "artillery", `realtime-${profile}.yml`);
const artilleryArguments = process.argv.slice(3);
const child = spawn(
  process.execPath,
  [
    path.join(directory, "node_modules", "artillery", "bin", "run"),
    "run",
    config,
    ...artilleryArguments,
  ],
  {
    cwd: path.join(directory, "artillery"),
    env: {
      ...process.env,
      LOAD_PROFILE: profile,
      LOAD_TEST_STARTED_AT_MS: String(Date.now()),
    },
    stdio: "inherit",
  },
);
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
