#!/usr/bin/env node
/**
 * Persists last successful launcher production build metadata for fast startup skips.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const STAMP_DIR = join(root, "node_modules", ".cache", "marinara");
const STAMP_PATH = join(STAMP_DIR, "launcher-build-stamp.json");

export function readLauncherBuildStamp() {
  if (!existsSync(STAMP_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STAMP_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function writeLauncherBuildStamp(partial) {
  const prev = readLauncherBuildStamp() ?? {};
  mkdirSync(STAMP_DIR, { recursive: true });
  writeFileSync(
    STAMP_PATH,
    `${JSON.stringify({ ...prev, ...partial, builtAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

export function resolveRepoHeadCommit() {
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    }).trim();
  } catch {
    return null;
  }
}

export function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}
