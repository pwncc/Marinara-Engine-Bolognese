// ──────────────────────────────────────────────
// REagent workspace: one folder per chat, journaled on the transcript.
//
// The model's file writes are recorded as after-images on the swipe that made
// them. The folder on disk is only ever a projection of the visible transcript
// (plus the user's own anchored edits), rebuilt before every generation and
// before the memory file is shown or edited. That is what makes a swipe, a
// regenerate, a delete or a trash restore revert the workspace for free: there
// is no undo log to keep in step, the transcript already is one.
//
// Files a shell command creates are not journaled. They stay on disk until
// something overwrites them; commands are commands.
// ──────────────────────────────────────────────

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  REAGENT_MEMORY_FILE,
  readReagentUserFileEdits,
  type ReagentFileVersions,
  type ReagentSettings,
  type ReagentUserFileEdit,
} from "@marinara-engine/shared";
import { getDataDir } from "../../config/runtime-config.js";
import { logger } from "../../lib/logger.js";
import type { DB } from "../../db/connection.js";
import { createChatsStorage } from "../storage/chats.storage.js";

/** Largest text file the model may write or read as text. */
export const REAGENT_MAX_TEXT_FILE_BYTES = 256 * 1024;
/** Largest image the model may look at. */
export const REAGENT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Largest video the model may look at. */
export const REAGENT_MAX_VIDEO_BYTES = 60 * 1024 * 1024;
/** Combined after-image bytes one swipe may journal. */
export const REAGENT_MAX_SWIPE_JOURNAL_BYTES = 1024 * 1024;

export const REAGENT_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"]);
export const REAGENT_VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv"]);

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
};

export function reagentRootDir() {
  return resolve(getDataDir(), "reagent");
}

export function reagentWorkspaceDir(chatId: string) {
  // Chat ids are nanoids; keep the path safe even if one ever is not.
  return resolve(reagentRootDir(), chatId.replace(/[^A-Za-z0-9_-]/g, "_"));
}

export async function ensureWorkspaceDir(chatId: string) {
  const dir = reagentWorkspaceDir(chatId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Workspace-relative, forward-slash path, or null when the path escapes the workspace. */
export function toWorkspaceRelative(workspaceDir: string, absolutePath: string): string | null {
  const rel = relative(workspaceDir, absolutePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return rel === "" ? "" : null;
  return rel.split(sep).join("/");
}

function isInside(root: string, target: string) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export interface ResolvedReagentPath {
  absolute: string;
  /** Set when the path lives inside the chat workspace (and is therefore journaled). */
  workspaceRelative: string | null;
}

/**
 * Resolve a model-supplied path. Relative paths are workspace-relative; absolute
 * paths are allowed for reading anywhere on the machine unless reads are
 * restricted, and for writing only inside the workspace or a configured root.
 */
export function resolveReagentPath(
  input: string,
  options: { workspaceDir: string; settings: ReagentSettings; forWrite: boolean },
): ResolvedReagentPath {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("A path is required.");
  const absolute = isAbsolute(raw) ? resolve(raw) : resolve(options.workspaceDir, raw);
  const workspaceRelative = isInside(options.workspaceDir, absolute)
    ? toWorkspaceRelative(options.workspaceDir, absolute)
    : null;
  if (workspaceRelative !== null) return { absolute, workspaceRelative };
  if (options.forWrite) {
    const allowed = options.settings.writableRoots.some((root) => root.trim() && isInside(resolve(root), absolute));
    if (!allowed) {
      throw new Error(
        `Writes are only allowed inside the workspace (${options.workspaceDir})${
          options.settings.writableRoots.length ? ` or ${options.settings.writableRoots.join(", ")}` : ""
        }.`,
      );
    }
  } else if (options.settings.restrictReadsToWorkspace) {
    throw new Error(`Reads are restricted to the workspace (${options.workspaceDir}).`);
  }
  return { absolute, workspaceRelative: null };
}

export function classifyFileKind(path: string): "image" | "video" | "text" {
  const ext = extname(path).toLowerCase();
  if (REAGENT_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (REAGENT_VIDEO_EXTENSIONS.has(ext)) return "video";
  return "text";
}

export function videoMimeType(path: string) {
  return VIDEO_MIME_BY_EXT[extname(path).toLowerCase()] ?? "video/mp4";
}

/** Text files only: anything with a NUL byte in its head is treated as binary. */
export function looksBinary(buffer: Buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 8000));
  return head.includes(0);
}

// ── Journal folding ──

type TranscriptRow = { id: string; extra: unknown };

function parseExtra(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readReagentFiles(extra: unknown): ReagentFileVersions {
  const raw = parseExtra(extra).reagentFiles;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ReagentFileVersions = {};
  for (const [path, content] of Object.entries(raw as Record<string, unknown>)) {
    if (content === null || typeof content === "string") out[path] = content;
  }
  return out;
}

/**
 * The workspace as the visible transcript leaves it: each message's after-images
 * in order, with the user's own edits applied right after the message they are
 * anchored to (edits anchored to a message that is no longer there apply last).
 */
export function foldWorkspaceState(
  messages: TranscriptRow[],
  userEdits: ReagentUserFileEdit[],
  options: { beforeMessageId?: string | null } = {},
): ReagentFileVersions {
  const state: ReagentFileVersions = {};
  const visibleIds = new Set(messages.map((message) => message.id));
  const editsByAnchor = new Map<string | null, ReagentUserFileEdit[]>();
  const orphaned: ReagentUserFileEdit[] = [];
  for (const edit of userEdits) {
    if (edit.afterMessageId === null || visibleIds.has(edit.afterMessageId)) {
      const list = editsByAnchor.get(edit.afterMessageId) ?? [];
      list.push(edit);
      editsByAnchor.set(edit.afterMessageId, list);
    } else {
      orphaned.push(edit);
    }
  }
  const apply = (versions: ReagentFileVersions | ReagentUserFileEdit[]) => {
    if (Array.isArray(versions)) {
      for (const edit of versions) state[edit.path] = edit.content;
    } else {
      for (const [path, content] of Object.entries(versions)) state[path] = content;
    }
  };
  apply(editsByAnchor.get(null) ?? []);
  for (const message of messages) {
    if (options.beforeMessageId && message.id === options.beforeMessageId) break;
    apply(readReagentFiles(message.extra));
    apply(editsByAnchor.get(message.id) ?? []);
  }
  apply(orphaned);
  return state;
}

async function writeWorkspaceFile(workspaceDir: string, relPath: string, content: string | null) {
  const absolute = resolve(workspaceDir, relPath);
  if (!isInside(workspaceDir, absolute)) return;
  if (content === null) {
    await rm(absolute, { force: true });
    return;
  }
  await mkdir(dirname(absolute), { recursive: true });
  let current: string | null = null;
  try {
    current = await readFile(absolute, "utf8");
  } catch {
    /* new file */
  }
  if (current !== content) await writeFile(absolute, content, "utf8");
}

/**
 * Bring the on-disk workspace in line with the transcript. `beforeMessageId`
 * projects the state before that message, which is what a regenerate needs.
 */
export async function materializeWorkspace(
  db: DB,
  chatId: string,
  options: { beforeMessageId?: string | null; messages?: TranscriptRow[]; chatMetadata?: Record<string, unknown> } = {},
) {
  const chats = createChatsStorage(db);
  const workspaceDir = await ensureWorkspaceDir(chatId);
  const messages = options.messages ?? (await chats.listMessages(chatId));
  const metadata = options.chatMetadata ?? parseExtra((await chats.getById(chatId))?.metadata);
  const userEdits: ReagentUserFileEdit[] = readReagentUserFileEdits(metadata);
  const state = foldWorkspaceState(messages, userEdits, { beforeMessageId: options.beforeMessageId });
  for (const [relPath, content] of Object.entries(state)) {
    try {
      await writeWorkspaceFile(workspaceDir, relPath, content);
    } catch (error) {
      logger.warn(error, "[reagent] Could not materialize %s for chat %s", relPath, chatId);
    }
  }
  return { workspaceDir, state };
}

export async function readWorkspaceMemory(workspaceDir: string): Promise<string> {
  try {
    const content = await readFile(join(workspaceDir, REAGENT_MEMORY_FILE), "utf8");
    return content.length > REAGENT_MAX_TEXT_FILE_BYTES ? content.slice(0, REAGENT_MAX_TEXT_FILE_BYTES) : content;
  } catch {
    return "";
  }
}

export interface WorkspaceListing {
  path: string;
  kind: "file" | "dir";
  bytes: number;
  modifiedAt: string;
}

export async function listDirectory(absoluteDir: string, limit = 400): Promise<WorkspaceListing[]> {
  if (!existsSync(absoluteDir)) return [];
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const out: WorkspaceListing[] = [];
  for (const entry of entries.slice(0, limit)) {
    const full = join(absoluteDir, entry.name);
    try {
      const info = await stat(full);
      out.push({
        path: entry.name,
        kind: entry.isDirectory() ? "dir" : "file",
        bytes: entry.isDirectory() ? 0 : info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "dir" ? -1 : 1));
}

export function displayName(path: string) {
  return basename(path);
}
