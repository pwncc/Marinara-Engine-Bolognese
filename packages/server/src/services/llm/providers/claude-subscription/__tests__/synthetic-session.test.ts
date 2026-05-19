// Tests for the synthetic-session lifecycle module.
//
// File-system-touching tests use a per-test temp directory under
// `os.tmpdir()` so they never write to the real `~/.claude/projects/...`
// location (which would risk polluting the user's actual CC session list).

import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  assembleEntries,
  cleanupOrphanedSessions,
  cleanupSessionFile,
  constructSessionFile,
  sessionsDirFor,
  type ConstructOptions,
} from "../synthetic-session.ts";
import type { CommonSessionMeta } from "../jsonl-entries.ts";
import type { ChatMessage } from "../../../base-provider.ts";

const META: CommonSessionMeta = {
  sessionId: "fixed-session-id",
  cwd: "/tmp/test-cwd",
  version: "test-1.0.0",
  gitBranch: "test-branch",
  permissionMode: "bypassPermissions",
};

describe("sessionsDirFor", () => {
  it("replaces every '/' with '-' in the cwd to match CC's project-dir convention", () => {
    const dir = sessionsDirFor("/home/user/project");
    assert.ok(dir.endsWith("/.claude/projects/-home-user-project"), `unexpected suffix: ${dir}`);
  });

  it("handles a cwd that already starts at root", () => {
    const dir = sessionsDirFor("/");
    assert.ok(dir.endsWith("/.claude/projects/-"));
  });
});

describe("assembleEntries", () => {
  it("skips system messages (they ride systemPrompt, not the JSONL)", () => {
    const history: ChatMessage[] = [
      { role: "system", content: "you are helpful" },
      { role: "user", content: "hi" },
    ];
    const entries = assembleEntries(history, META, "m");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.type, "user");
  });

  it("chains parentUuid pointers in order", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
    ];
    const entries = assembleEntries(history, META, "m");
    assert.equal(entries.length, 3);
    assert.equal(entries[0]!.parentUuid, null);
    assert.equal(entries[1]!.parentUuid, entries[0]!.uuid);
    assert.equal(entries[2]!.parentUuid, entries[1]!.uuid);
  });

  it("routes role=tool messages through buildUserEntry (tool_result blocks)", () => {
    const history: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }],
      },
      { role: "tool", content: "result text", tool_call_id: "t1" },
    ];
    const entries = assembleEntries(history, META, "m");
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.type, "assistant");
    assert.equal(entries[1]!.type, "user");
    const blocks = entries[1]!.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks[0]!["type"], "tool_result");
    assert.equal(blocks[0]!["tool_use_id"], "t1");
  });

  it("returns an empty entries array for empty history", () => {
    assert.deepEqual(assembleEntries([], META, "m"), []);
  });
});

describe("constructSessionFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "marinara-jsonl-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const baseOpts = (sessionsDir: string): ConstructOptions => ({
    model: "test-model",
    sessionsDir,
    gitBranch: "test-branch",
    sdkVersion: "test-1.0.0",
  });

  it("writes a JSONL file with one entry per history message", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const { sessionId, path } = await constructSessionFile(history, baseOpts(dir));
    assert.ok(sessionId.length > 0);
    assert.ok(path.startsWith(dir), "path should be inside the override dir");
    assert.ok(path.endsWith(`${sessionId}.jsonl`));
    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 2);
    const u = JSON.parse(lines[0]!) as Record<string, unknown>;
    const a = JSON.parse(lines[1]!) as Record<string, unknown>;
    assert.equal(u["type"], "user");
    assert.equal(a["type"], "assistant");
    assert.equal(u["sessionId"], sessionId);
    assert.equal(a["sessionId"], sessionId);
    assert.equal(u["gitBranch"], "test-branch");
    assert.equal(u["version"], "test-1.0.0");
  });

  it("creates the sessions directory if it does not already exist", async () => {
    const nested = join(dir, "nested", "dir");
    await constructSessionFile([{ role: "user", content: "x" }], baseOpts(nested));
    const s = await stat(nested);
    assert.ok(s.isDirectory());
  });

  it("writes an empty file (no entries) when history is empty after filtering", async () => {
    // Only a system message; assembleEntries strips it, leaving zero entries.
    const { path } = await constructSessionFile(
      [{ role: "system", content: "s" }],
      baseOpts(dir),
    );
    const text = await readFile(path, "utf8");
    assert.equal(text, "");
  });
});

describe("cleanupSessionFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "marinara-jsonl-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("removes the named session file", async () => {
    const path = join(dir, "abc-123.jsonl");
    await writeFile(path, "x\n", "utf8");
    await cleanupSessionFile(path);
    await assert.rejects(() => stat(path), /ENOENT/);
  });

  it("swallows ENOENT (file already gone is fine)", async () => {
    await cleanupSessionFile(join(dir, "does-not-exist.jsonl"));
  });

  it("integrates with constructSessionFile's returned path (no dir threading)", async () => {
    // Regression: prior API required threading `dir` through to cleanup.
    // The new API takes the path directly so callers can't forget which
    // sessionsDir override was used.
    const { path } = await constructSessionFile(
      [{ role: "user", content: "x" }],
      { model: "m", sessionsDir: dir, gitBranch: "b", sdkVersion: "v" },
    );
    await cleanupSessionFile(path);
    await assert.rejects(() => stat(path), /ENOENT/);
  });
});

describe("cleanupOrphanedSessions", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "marinara-jsonl-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 0 when the directory does not exist", async () => {
    const removed = await cleanupOrphanedSessions(1000, Date.now(), join(dir, "missing"));
    assert.equal(removed, 0);
  });

  it("removes files older than maxAgeMs and keeps recent ones", async () => {
    const recentPath = join(dir, "recent.jsonl");
    const oldPath = join(dir, "old.jsonl");
    await writeFile(recentPath, "x", "utf8");
    await writeFile(oldPath, "x", "utf8");

    const now = Date.now();
    const oneHourAgo = (now - 60 * 60 * 1000) / 1000;
    // Use utimes to backdate the old file's mtime by 1h.
    await utimes(oldPath, oneHourAgo, oneHourAgo);

    const removed = await cleanupOrphanedSessions(30 * 60 * 1000, now, dir);
    assert.equal(removed, 1);
    await stat(recentPath); // still there
    await assert.rejects(() => stat(oldPath), /ENOENT/);
  });

  it("ignores non-.jsonl files in the directory", async () => {
    const other = join(dir, "notes.txt");
    await writeFile(other, "x", "utf8");
    const oneHourAgo = (Date.now() - 60 * 60 * 1000) / 1000;
    await utimes(other, oneHourAgo, oneHourAgo);

    const removed = await cleanupOrphanedSessions(30 * 60 * 1000, Date.now(), dir);
    assert.equal(removed, 0);
    await stat(other); // still there
  });
});
