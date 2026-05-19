// ──────────────────────────────────────────────
// Synthetic JSONL entry builder for Claude Code session replay
// ──────────────────────────────────────────────
//
// The Claude Agent SDK's `resume: <sessionId>` option reads a JSONL file at
// `~/.claude/projects/<cwd-as-dashes>/<sessionId>.jsonl` and replays it as
// the conversation history the model sees. Marinara synthesizes these files
// in-process so its `ChatMessage[]` history reaches the model as real
// multi-turn context instead of being folded into one big
// `User: ... / Assistant: ...` string prompt.
//
// Schema mirrors what the CLI writes (observed in SDK v2.1.x sessions) but
// omits hook/UI noise entries (queue-operation, last-prompt, attachment,
// permission-mode, file-history-snapshot, ai-title) — those aren't required
// for resume. The same minimal shape is used by `claude-openai-proxy` and
// validated to round-trip cleanly.

import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../../base-provider.js";
import { logger } from "../../../../lib/logger.js";

// Content block shapes the Anthropic API accepts. Re-declared locally rather
// than imported from the SDK so this module stays SDK-free (callers can
// unit-test it without triggering the lazy SDK import cascade).

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export type UserContentBlock = TextBlock | ToolResultBlock | ImageBlock;
export type AssistantContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

export interface CommonSessionMeta {
  sessionId: string;
  cwd: string;
  version: string;
  gitBranch: string;
  permissionMode: string;
}

export interface SyntheticUserEntry {
  parentUuid: string | null;
  isSidechain: false;
  promptId: string;
  type: "user";
  message: { role: "user"; content: string | UserContentBlock[] };
  uuid: string;
  timestamp: string;
  permissionMode: string;
  userType: "external";
  entrypoint: "cli";
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
}

export interface SyntheticAssistantMessage {
  model: string;
  id: string;
  type: "message";
  role: "assistant";
  content: AssistantContentBlock[];
  stop_reason: "end_turn" | "tool_use";
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface SyntheticAssistantEntry {
  parentUuid: string | null;
  isSidechain: false;
  message: SyntheticAssistantMessage;
  requestId: string;
  type: "assistant";
  uuid: string;
  timestamp: string;
  userType: "external";
  entrypoint: "cli";
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
}

export type SyntheticEntry = SyntheticUserEntry | SyntheticAssistantEntry;

// Constrain the payload to the legal base64 alphabet so the regex engine
// fails fast on garbage instead of backtracking across multi-KB inputs.
const DATA_URL_RE = /^data:(image\/[^;]+);base64,([A-Za-z0-9+/]+=*)$/;

function shortHex(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

function parseToolArguments(args: string, toolName: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    logger.warn(
      "[claude-subscription/jsonl] tool_use input for %s was not a JSON object; substituting {}",
      toolName,
    );
    return {};
  } catch (err) {
    logger.warn(
      err,
      "[claude-subscription/jsonl] failed to parse tool_use arguments for %s; substituting {}",
      toolName,
    );
    return {};
  }
}

function imageBlocksFromDataUrls(urls: readonly string[]): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  for (const url of urls) {
    const match = url.match(DATA_URL_RE);
    if (!match) {
      logger.warn("[claude-subscription/jsonl] dropping image: not a recognised base64 data URL");
      continue;
    }
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: match[1]!, data: match[2]! },
    });
  }
  return blocks;
}

/**
 * Build a JSONL user entry from a Marinara `ChatMessage`.
 *
 * Handles three shapes:
 *  - role "tool" with `tool_call_id` → single `tool_result` block.
 *  - role "user" with `images` → image blocks (Anthropic-conventional first)
 *    followed by an optional text block.
 *  - plain text → string content (smaller files, identical wire result).
 */
export function buildUserEntry(args: {
  message: ChatMessage;
  parentUuid: string | null;
  meta: CommonSessionMeta;
  timestamp?: string;
  uuid?: string;
  promptId?: string;
}): SyntheticUserEntry {
  const { message } = args;
  const text = message.content ?? "";
  let content: string | UserContentBlock[] = text;

  if (message.role === "tool") {
    // `tool_call_id` is optional on ChatMessage but mandatory for a valid
    // tool_result block. Falling through to the text path would silently
    // erase the tool linkage on resume, so warn and emit a placeholder
    // block instead — at least the entry is still recognisably a tool result.
    if (!message.tool_call_id) {
      logger.warn(
        "[claude-subscription/jsonl] role=tool message missing tool_call_id; emitting tool_result with empty tool_use_id",
      );
    }
    content = [
      {
        type: "tool_result",
        tool_use_id: message.tool_call_id ?? "",
        content: text,
      },
    ];
  } else {
    const images = imageBlocksFromDataUrls(message.images ?? []);
    if (images.length > 0) {
      const blocks: UserContentBlock[] = [...images];
      if (text) blocks.push({ type: "text", text });
      content = blocks;
    }
  }

  return {
    parentUuid: args.parentUuid,
    isSidechain: false,
    promptId: args.promptId ?? randomUUID(),
    type: "user",
    message: { role: "user", content },
    uuid: args.uuid ?? randomUUID(),
    timestamp: args.timestamp ?? new Date().toISOString(),
    permissionMode: args.meta.permissionMode,
    userType: "external",
    entrypoint: "cli",
    cwd: args.meta.cwd,
    sessionId: args.meta.sessionId,
    version: args.meta.version,
    gitBranch: args.meta.gitBranch,
  };
}

/**
 * Build a JSONL assistant entry from a Marinara `ChatMessage`.
 *
 * `tool_calls` from the agent loop become `tool_use` blocks; their string
 * `arguments` are parsed back into the object shape Anthropic expects on
 * `input`. Parse failures emit a warn and fall through to `{}`.
 *
 * The Anthropic API rejects empty `content`; an assistant turn with neither
 * text nor tool_calls gets a single empty text block so resume still loads.
 */
export function buildAssistantEntry(args: {
  message: ChatMessage;
  parentUuid: string | null;
  meta: CommonSessionMeta;
  model: string;
  timestamp?: string;
  uuid?: string;
  messageId?: string;
  requestId?: string;
}): SyntheticAssistantEntry {
  const { message } = args;
  const text = message.content ?? "";
  const toolCalls = message.tool_calls ?? [];

  const blocks: AssistantContentBlock[] = [];
  if (text) blocks.push({ type: "text", text });
  for (const tc of toolCalls) {
    blocks.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: parseToolArguments(tc.function.arguments, tc.function.name),
    });
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });

  const stopReason: "end_turn" | "tool_use" = toolCalls.length > 0 ? "tool_use" : "end_turn";

  return {
    parentUuid: args.parentUuid,
    isSidechain: false,
    message: {
      model: args.model,
      id: args.messageId ?? `msg_${shortHex()}`,
      type: "message",
      role: "assistant",
      content: blocks,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    requestId: args.requestId ?? `req_${shortHex()}`,
    type: "assistant",
    uuid: args.uuid ?? randomUUID(),
    timestamp: args.timestamp ?? new Date().toISOString(),
    userType: "external",
    entrypoint: "cli",
    cwd: args.meta.cwd,
    sessionId: args.meta.sessionId,
    version: args.meta.version,
    gitBranch: args.meta.gitBranch,
  };
}

export function serializeEntries(entries: readonly SyntheticEntry[]): string {
  if (entries.length === 0) return "";
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
