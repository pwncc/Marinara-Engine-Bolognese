#!/usr/bin/env node
/**
 * Stops the process listening on PORT (default 7860) so start.bat can bind cleanly.
 * Avoids leaving an old Marinara server running after a client rebuild — that server
 * will return index.html for new /assets/* hashes (MIME type errors in the browser).
 */
import { execSync } from "node:child_process";
import { platform } from "node:os";

const rawPort = process.env.PORT ?? "7860";
const port = Number.parseInt(rawPort, 10);

if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
  console.error(`[kill-port] Invalid PORT: ${rawPort}`);
  process.exit(1);
}

function killWindows() {
  let out = "";
  try {
    out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
  } catch {
    return false;
  }

  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts[parts.length - 1] ?? "", 10);
    if (Number.isFinite(pid) && pid > 0) pids.add(pid);
  }

  if (!pids.size) return false;

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      console.log(`[kill-port] Stopped process ${pid} that was listening on port ${port}`);
    } catch {
      console.warn(`[kill-port] Could not stop PID ${pid} on port ${port}`);
    }
  }
  return true;
}

function killUnix() {
  try {
    const pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
    if (!pids) return false;
    for (const pid of pids.split(/\s+/)) {
      if (!pid) continue;
      try {
        process.kill(Number.parseInt(pid, 10), "SIGTERM");
        console.log(`[kill-port] Stopped process ${pid} on port ${port}`);
      } catch {
        console.warn(`[kill-port] Could not stop PID ${pid}`);
      }
    }
    return true;
  } catch {
    return false;
  }
}

const stopped = platform() === "win32" ? killWindows() : killUnix();
if (!stopped) {
  console.log(`[kill-port] No listener on port ${port}`);
}
