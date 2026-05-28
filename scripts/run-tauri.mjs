import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const cargoHome = process.env.CARGO_HOME || (process.env.HOME ? join(process.env.HOME, ".cargo") : "");
const cargoBin = cargoHome ? join(cargoHome, "bin") : "";

const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
const tauriArgs = process.argv.slice(2);
const webview2DebugArg = "--remote-debugging-port=9222";

if (cargoBin && existsSync(cargoBin)) {
  env[pathKey] = [cargoBin, env[pathKey]].filter(Boolean).join(delimiter);
}

if (tauriArgs[0] === "dev" && !env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS?.includes("--remote-debugging-port=")) {
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, webview2DebugArg]
    .filter(Boolean)
    .join(" ");
}

const tauriBin = process.platform === "win32" ? "tauri.cmd" : "tauri";
const child = spawn(tauriBin, tauriArgs, {
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
