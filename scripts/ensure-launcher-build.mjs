#!/usr/bin/env node
/**
 * Ensures production launcher artifacts exist and match source trees.
 * Skips work when dist is present, assets resolve, and nothing source-side changed.
 *
 * Set MARINARA_SKIP_BUILD=1 to start without building (fails if dist is missing).
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readLauncherBuildStamp,
  readPackageVersion,
  resolveRepoHeadCommit,
  writeLauncherBuildStamp,
} from "./launcher-build-stamp.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const MARKERS = {
  shared: join(root, "packages/shared/dist/index.js"),
  server: join(root, "packages/server/dist/index.js"),
  client: join(root, "packages/client/dist/index.html"),
};

function run(cmd) {
  console.log(`[launcher-build] ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: process.env });
}

function walkSourceNewerThan(dir, sinceMs) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (walkSourceNewerThan(path, sinceMs)) return true;
    } else if (/\.(tsx?|jsx?|css)$/.test(ent.name)) {
      if (statSync(path).mtimeMs > sinceMs) return true;
    }
  }
  return false;
}

/** Newest mtime under a package dist tree (tsc may skip touching index.js on incremental builds). */
function distNewestMtime(pkgDir) {
  const distDir = join(pkgDir, "dist");
  if (!existsSync(distDir)) return 0;
  let newest = 0;
  const stack = [distDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name);
      if (ent.isDirectory()) stack.push(path);
      else newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

function packageStale(pkgDir, distMarkerRel) {
  const srcDir = join(pkgDir, "src");
  const markerPath = join(pkgDir, distMarkerRel);
  if (!existsSync(markerPath)) return true;
  if (!existsSync(srcDir)) return false;
  const since = Math.max(statSync(markerPath).mtimeMs, distNewestMtime(pkgDir));
  return walkSourceNewerThan(srcDir, since);
}

function clientAssetsMissing() {
  const indexPath = MARKERS.client;
  if (!existsSync(indexPath)) return true;
  const html = readFileSync(indexPath, "utf8");
  const assets = [...html.matchAll(/\/assets\/([^"'\s>]+)/g)].map((m) => m[1]);
  for (const asset of assets) {
    const filePath = join(root, "packages/client/dist/assets", asset);
    if (!existsSync(filePath)) {
      console.warn(`[launcher-build] Missing client asset referenced by index.html: ${asset}`);
      return true;
    }
  }
  return false;
}

function allMarkersPresent() {
  return Object.values(MARKERS).every((path) => existsSync(path));
}

function skipBuildRequested() {
  const raw = process.env.MARINARA_SKIP_BUILD?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

if (skipBuildRequested()) {
  if (!existsSync(MARKERS.server)) {
    console.error("[launcher-build] MARINARA_SKIP_BUILD is set but packages/server/dist is missing.");
    process.exit(1);
  }
  if (clientAssetsMissing()) {
    console.error(
      "[launcher-build] MARINARA_SKIP_BUILD is set but client assets are missing. Unset MARINARA_SKIP_BUILD or run a build once.",
    );
    process.exit(1);
  }
  console.log("[launcher-build] Skipped (MARINARA_SKIP_BUILD).");
  process.exit(0);
}

const headCommit = resolveRepoHeadCommit();
const packageVersion = readPackageVersion();
const stamp = readLauncherBuildStamp();

const sharedStale = packageStale(join(root, "packages/shared"), "dist/index.js");
const serverStale = packageStale(join(root, "packages/server"), "dist/index.js");
const clientStale =
  packageStale(join(root, "packages/client"), "dist/index.html") || clientAssetsMissing();

const metadataDrift =
  (packageVersion && stamp?.version && packageVersion !== stamp.version) ||
  (headCommit && stamp?.commit && headCommit !== stamp.commit);

const stampMatches =
  stamp &&
  packageVersion &&
  stamp.version === packageVersion &&
  (!headCommit || stamp.commit === headCommit);

if (allMarkersPresent() && stampMatches && !metadataDrift && !sharedStale && !serverStale && !clientStale) {
  console.log(
    headCommit
      ? `[launcher-build] Up to date (v${packageVersion}, ${headCommit}).`
      : `[launcher-build] Up to date (v${packageVersion}).`,
  );
  process.exit(0);
}

if (metadataDrift) {
  console.log(
    `[launcher-build] Rebuilding after metadata drift (v${stamp?.version ?? "?"}→v${packageVersion ?? "?"}, ${stamp?.commit ?? "?"}→${headCommit ?? "?"}).`,
  );
}

let builtShared = false;
let builtServer = false;
let builtClient = false;

if (sharedStale || metadataDrift) {
  run("pnpm --filter @marinara-engine/shared build");
  builtShared = true;
}

if (serverStale || builtShared || metadataDrift) {
  run("pnpm --filter @marinara-engine/server build");
  builtServer = true;
}

if (clientStale || metadataDrift) {
  run("pnpm --filter @marinara-engine/client build");
  builtClient = true;
}

if (builtShared || builtServer || builtClient) {
  writeLauncherBuildStamp({
    version: packageVersion,
    commit: headCommit,
    shared: builtShared || !sharedStale,
    server: builtServer || !serverStale,
    client: builtClient || !clientStale,
  });
} else if (allMarkersPresent() && packageVersion) {
  writeLauncherBuildStamp({ version: packageVersion, commit: headCommit });
}
