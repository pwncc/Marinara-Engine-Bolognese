// ──────────────────────────────────────────────
// REagent tools: what the writer can do while it reasons.
//
// Definitions are plain function-calling schemas; execution runs here rather
// than in the generic tool executor because these calls need the chat's
// workspace, the transcript, the status ledger and the SSE stream.
// ──────────────────────────────────────────────

import { readFile, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";
import {
  REAGENT_MEMORY_FILE,
  type ConvoCharacterStatus,
  type LLMToolCall,
  type LLMToolDefinition,
  type ReagentActivityEntry,
  type ReagentSettings,
  type ReagentToolFamily,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { newId } from "../../utils/id-generator.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import { normalizeConvoCharacterStatusPatch } from "../conversation/character-status.service.js";
import { optimizeNoodleVisionImage } from "../noodle/noodle-vision.js";
import { stripHtml, decodeHtmlEntities } from "../professor-mari/fandom-mediawiki/html-text.js";
import type { LorebookSearchFn, ToolExecutionResult } from "../tools/tool-executor.js";
import { createApproval } from "./reagent-approvals.js";
import { judgeCommand, runShellCommand } from "./reagent-shell.js";
import {
  REAGENT_MAX_IMAGE_BYTES,
  REAGENT_MAX_TEXT_FILE_BYTES,
  REAGENT_MAX_VIDEO_BYTES,
  classifyFileKind,
  listDirectory,
  looksBinary,
  resolveReagentPath,
  videoMimeType,
} from "./reagent-workspace.js";

export interface ReagentMedia {
  kind: "image" | "video";
  name: string;
  dataUrl: string;
  mimeType: string;
}

export interface ReagentToolOutcome {
  result: ToolExecutionResult;
  media: ReagentMedia[];
  approval?: ReagentActivityEntry["approval"];
}

export interface ReagentCharacter {
  id: string;
  name: string;
}

export interface ReagentExecutorDeps {
  db: DB;
  chatId: string;
  chatName: string;
  settings: ReagentSettings;
  workspaceDir: string;
  characters: ReagentCharacter[];
  /** The character speaking this turn, when exactly one is. */
  callingCharacterId: string | null;
  searchLorebook?: LorebookSearchFn;
  signal?: AbortSignal;
  sendEvent?: (payload: Record<string, unknown>) => void;
  onStatusPatch: (characterId: string, patch: ConvoCharacterStatus) => void;
  onFileVersion: (workspaceRelativePath: string, content: string | null) => void;
}

const RESULT_TEXT_LIMIT = 12_000;
const MESSAGE_SNIPPET = 220;
const MESSAGE_READ_LIMIT = 4_000;

function clip(text: string, limit = RESULT_TEXT_LIMIT) {
  return text.length > limit ? `${text.slice(0, limit)}\n…[truncated ${text.length - limit} characters]` : text;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ── Definitions ──

const def = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) =>
  ({
    type: "function" as const,
    function: { name, description, parameters: { type: "object", properties, required } },
  }) satisfies LLMToolDefinition;

const FILE_TOOLS: LLMToolDefinition[] = [
  def(
    "read_file",
    "Read a file. Text files come back as text; images and videos are shown to you as real inputs so you can look at them. Relative paths are inside your workspace; absolute paths read anywhere you are allowed to.",
    {
      path: { type: "string", description: "File path, relative to the workspace or absolute." },
      offset: { type: "integer", description: "Text files: first line to return (1-based)." },
      limit: { type: "integer", description: "Text files: how many lines to return." },
    },
    ["path"],
  ),
  def("list_dir", "List a directory. Defaults to the workspace root.", {
    path: { type: "string", description: "Directory path, relative to the workspace or absolute." },
  }),
  def(
    "write_file",
    "Create or overwrite a text file in your workspace (or an allowed folder). Writes inside the workspace are tied to this reply: swiping or regenerating it reverts them.",
    {
      path: { type: "string", description: "File path, relative to the workspace." },
      content: { type: "string", description: "The complete new file content." },
    },
    ["path", "content"],
  ),
  def(
    "edit_file",
    "Replace one exact text passage in a text file. The old text must appear exactly once unless replace_all is true.",
    {
      path: { type: "string" },
      old_text: { type: "string", description: "Exact text to find." },
      new_text: { type: "string", description: "Replacement text." },
      replace_all: { type: "boolean" },
    },
    ["path", "old_text", "new_text"],
  ),
  def("delete_file", "Delete a file in your workspace.", { path: { type: "string" } }, ["path"]),
];

const MEMORY_TOOLS: LLMToolDefinition[] = [
  def(
    "update_memory",
    `Update ${REAGENT_MEMORY_FILE}, the notes you are shown at the start of every reply. Use it for things worth remembering across the whole chat: facts about the people here, promises, running threads, your own plans. Keep it tidy and short; rewrite rather than pile up.`,
    {
      mode: { type: "string", enum: ["replace", "append"], description: "Replace the whole file or append a section." },
      content: { type: "string" },
    },
    ["mode", "content"],
  ),
];

const RECALL_TOOLS: LLMToolDefinition[] = [
  def(
    "search_messages",
    "Search this chat's full history for messages matching words or a phrase, newest first. Use it to check what was actually said instead of guessing.",
    {
      query: { type: "string", description: "Words or a phrase to look for." },
      limit: { type: "integer", description: "Maximum matches (default 10, max 30)." },
      speaker: { type: "string", description: "Only messages by this speaker name, or 'user'." },
    },
    ["query"],
  ),
  def("read_messages", "Read messages in full by id (from search_messages) or by position in the transcript.", {
    ids: { type: "array", items: { type: "string" } },
    from_index: { type: "integer", description: "1-based position of the first message to read." },
    to_index: { type: "integer", description: "1-based position of the last message to read (max 20 at once)." },
  }),
];

const STATUS_TOOLS: LLMToolDefinition[] = [
  def(
    "set_character_status",
    "Update a character's body/mood ledger directly. Only include fields that changed. Bars are 0-100.",
    {
      character: { type: "string", description: "Character name. Optional when you are the only character speaking." },
      emotion: { type: "string" },
      emotion_cause: { type: "string", description: "One short clause explaining the emotion." },
      temperature: { type: "string" },
      notes: { type: "string", description: "Bodily notes: shaking, tipsy, tired…" },
      bars: { type: "object", additionalProperties: { type: "number" }, description: 'e.g. {"hunger": 70}' },
      limbs: { type: "object", additionalProperties: { type: "string" }, description: "Per body part state." },
      extras: { type: "object", additionalProperties: { type: "string" } },
    },
  ),
];

const LOREBOOK_TOOLS: LLMToolDefinition[] = [
  def(
    "lookup_lorebook",
    "Search the lorebooks active in this chat for entries about a topic.",
    { query: { type: "string" } },
    ["query"],
  ),
  def(
    "write_lorebook_entry",
    "Create or update an entry in this chat's own lorebook so a fact is injected whenever its keywords come up later.",
    {
      name: { type: "string", description: "Entry title; an existing entry with this name is updated." },
      content: { type: "string" },
      keys: { type: "array", items: { type: "string" }, description: "Trigger keywords." },
      mode: { type: "string", enum: ["replace", "append"] },
    },
    ["name", "content", "keys"],
  ),
];

const WEB_TOOLS: LLMToolDefinition[] = [
  def(
    "fetch_url",
    "Fetch a web page or file over HTTP(S) and return its readable text.",
    { url: { type: "string" }, max_chars: { type: "integer", description: "Default 12000." } },
    ["url"],
  ),
];

const SHELL_TOOLS: LLMToolDefinition[] = [
  def(
    "run_command",
    "Run a shell command on this machine and get its output. The working directory defaults to your workspace. Depending on the chat's policy the command may wait for the user's approval or be refused.",
    {
      command: { type: "string" },
      cwd: { type: "string", description: "Working directory, relative to the workspace or absolute." },
      reason: { type: "string", description: "One line on why, shown to the user when approval is needed." },
    },
    ["command"],
  ),
];

const FAMILY_TOOLS: Record<ReagentToolFamily, LLMToolDefinition[]> = {
  files: FILE_TOOLS,
  memory: MEMORY_TOOLS,
  recall: RECALL_TOOLS,
  status: STATUS_TOOLS,
  lorebook: LOREBOOK_TOOLS,
  web: WEB_TOOLS,
  shell: SHELL_TOOLS,
  noodle: [],
  images: [],
};

export function reagentToolDefinitions(settings: ReagentSettings): LLMToolDefinition[] {
  if (!settings.enabled) return [];
  const defs: LLMToolDefinition[] = [];
  for (const [family, tools] of Object.entries(FAMILY_TOOLS) as Array<[ReagentToolFamily, LLMToolDefinition[]]>) {
    if (settings.tools[family]) defs.push(...tools);
  }
  return defs;
}

export function isReagentToolName(name: string) {
  return Object.values(FAMILY_TOOLS).some((tools) => tools.some((tool) => tool.function.name === name));
}

// ── Prompt block ──

export function buildReagentPromptBlock(input: {
  settings: ReagentSettings;
  workspaceDir: string;
  memory: string;
  toolNames: string[];
}): string {
  const lines: string[] = [];
  lines.push("## Your tools (REagent)");
  lines.push(
    "You can call tools while thinking about your reply. Tool calls are invisible to the other person; the reply text you write afterwards is all they see. Use tools to check facts, look at files, remember things and keep your notes, then answer in character as usual. Never narrate or mention tool use in the reply itself.",
  );
  lines.push(`Workspace folder (your own; relative paths resolve here): ${input.workspaceDir}`);
  if (input.settings.tools.memory) {
    lines.push(
      `Your notes file ${REAGENT_MEMORY_FILE} is shown below every time. Update it with update_memory when something worth keeping happens; keep it concise.`,
    );
  }
  if (input.settings.tools.status) {
    lines.push("Use set_character_status when a character's feelings, body or state meaningfully change.");
  }
  if (input.settings.tools.shell) {
    lines.push(
      `Shell policy: ${input.settings.shellPolicy}${
        input.settings.shellPolicy === "ask" ? " (unlisted commands wait for the user's approval)" : ""
      }.`,
    );
  }
  lines.push(`Available tools: ${input.toolNames.join(", ")}.`);
  if (input.settings.tools.memory) {
    lines.push("");
    lines.push(`### ${REAGENT_MEMORY_FILE}`);
    lines.push(input.memory.trim() ? input.memory.trim() : "(empty — nothing noted yet)");
  }
  return lines.join("\n");
}

// ── Execution ──

export function createReagentExecutor(deps: ReagentExecutorDeps) {
  const chats = createChatsStorage(deps.db);
  const lorebooks = createLorebooksStorage(deps.db);
  const pathOptions = (forWrite: boolean) => ({ workspaceDir: deps.workspaceDir, settings: deps.settings, forWrite });

  const findCharacter = (name: string | undefined): ReagentCharacter | null => {
    if (name?.trim()) {
      const wanted = name.trim().toLowerCase();
      const exact = deps.characters.find((character) => character.name.toLowerCase() === wanted);
      if (exact) return exact;
      const partial = deps.characters.find(
        (character) => character.name.toLowerCase().includes(wanted) || wanted.includes(character.name.toLowerCase()),
      );
      if (partial) return partial;
      return null;
    }
    if (deps.callingCharacterId) {
      return deps.characters.find((character) => character.id === deps.callingCharacterId) ?? null;
    }
    return deps.characters.length === 1 ? deps.characters[0]! : null;
  };

  async function readFileTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const { absolute, workspaceRelative } = resolveReagentPath(str(args.path), pathOptions(false));
    const info = await stat(absolute).catch(() => null);
    if (!info) throw new Error(`File not found: ${absolute}`);
    if (info.isDirectory()) throw new Error(`${absolute} is a directory; use list_dir.`);
    const kind = classifyFileKind(absolute);
    const name = workspaceRelative ?? basename(absolute);
    if (kind === "image") {
      if (info.size > REAGENT_MAX_IMAGE_BYTES) throw new Error("Image is larger than 20 MB.");
      const buffer = await readFile(absolute);
      const dataUrl = await optimizeNoodleVisionImage(buffer);
      if (!dataUrl) throw new Error("The file is not a readable image.");
      return {
        result: ok(`Image "${name}" (${info.size} bytes) is attached to this turn as an input; look at it directly.`),
        media: [{ kind: "image", name, dataUrl, mimeType: "image/jpeg" }],
      };
    }
    if (kind === "video") {
      if (info.size > REAGENT_MAX_VIDEO_BYTES) throw new Error("Video is larger than 60 MB.");
      const buffer = await readFile(absolute);
      const mimeType = videoMimeType(absolute);
      return {
        result: ok(
          `Video "${name}" (${info.size} bytes) is attached to this turn as an input. If your model cannot take video, you will see an error instead.`,
        ),
        media: [{ kind: "video", name, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`, mimeType }],
      };
    }
    if (info.size > REAGENT_MAX_TEXT_FILE_BYTES * 4) throw new Error("File is too large to read as text (1 MB limit).");
    const buffer = await readFile(absolute);
    if (looksBinary(buffer)) throw new Error("Binary file; only text, images and videos can be read.");
    let text = buffer.toString("utf8");
    const offset = Math.max(1, Math.floor(num(args.offset, 1)));
    const limit = Math.max(1, Math.floor(num(args.limit, 0)));
    if (args.offset !== undefined || args.limit !== undefined) {
      const lines = text.split("\n");
      text = lines.slice(offset - 1, args.limit !== undefined ? offset - 1 + limit : undefined).join("\n");
    }
    return { result: ok(clip(text)), media: [] };
  }

  async function journalWorkspaceWrite(absolute: string, workspaceRelative: string | null, content: string | null) {
    if (workspaceRelative === null) return;
    deps.onFileVersion(workspaceRelative, content);
    if (content === null) return;
    void absolute;
  }

  async function writeFileTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const content = str(args.content);
    if (Buffer.byteLength(content, "utf8") > REAGENT_MAX_TEXT_FILE_BYTES) {
      throw new Error("Files are limited to 256 KB.");
    }
    const { absolute, workspaceRelative } = resolveReagentPath(str(args.path), pathOptions(true));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
    await journalWorkspaceWrite(absolute, workspaceRelative, content);
    return { result: ok(`Wrote ${workspaceRelative ?? absolute} (${content.length} characters).`), media: [] };
  }

  async function editFileTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const { absolute, workspaceRelative } = resolveReagentPath(str(args.path), pathOptions(true));
    const current = await readFile(absolute, "utf8").catch(() => null);
    if (current === null) throw new Error(`File not found: ${absolute}`);
    const oldText = str(args.old_text);
    const newText = str(args.new_text);
    if (!oldText) throw new Error("old_text is required.");
    const occurrences = current.split(oldText).length - 1;
    if (occurrences === 0) throw new Error("old_text was not found in the file.");
    if (occurrences > 1 && args.replace_all !== true) {
      throw new Error(`old_text appears ${occurrences} times; include more context or set replace_all.`);
    }
    const next = args.replace_all === true ? current.split(oldText).join(newText) : current.replace(oldText, newText);
    if (Buffer.byteLength(next, "utf8") > REAGENT_MAX_TEXT_FILE_BYTES) throw new Error("Files are limited to 256 KB.");
    await writeFile(absolute, next, "utf8");
    await journalWorkspaceWrite(absolute, workspaceRelative, next);
    return { result: ok(`Edited ${workspaceRelative ?? absolute} (${occurrences} replacement(s)).`), media: [] };
  }

  async function deleteFileTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const { absolute, workspaceRelative } = resolveReagentPath(str(args.path), pathOptions(true));
    const info = await stat(absolute).catch(() => null);
    if (!info || info.isDirectory()) throw new Error(`File not found: ${absolute}`);
    await rm(absolute, { force: true });
    await journalWorkspaceWrite(absolute, workspaceRelative, null);
    return { result: ok(`Deleted ${workspaceRelative ?? absolute}.`), media: [] };
  }

  async function listDirTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const target = str(args.path).trim()
      ? resolveReagentPath(str(args.path), pathOptions(false)).absolute
      : deps.workspaceDir;
    const entries = await listDirectory(target);
    return {
      result: ok(
        JSON.stringify({
          directory: target,
          entries: entries.map((entry) => ({ name: entry.path, kind: entry.kind, bytes: entry.bytes })),
        }),
      ),
      media: [],
    };
  }

  async function updateMemoryTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const absolute = resolve(deps.workspaceDir, REAGENT_MEMORY_FILE);
    const current = await readFile(absolute, "utf8").catch(() => "");
    const content = str(args.content);
    const next =
      args.mode === "append" ? `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${content.trim()}\n` : content;
    if (Buffer.byteLength(next, "utf8") > REAGENT_MAX_TEXT_FILE_BYTES)
      throw new Error("memory.md is limited to 256 KB.");
    await writeFile(absolute, next, "utf8");
    deps.onFileVersion(REAGENT_MEMORY_FILE, next);
    return { result: ok(`${REAGENT_MEMORY_FILE} updated (${next.length} characters).`), media: [] };
  }

  type TranscriptEntry = {
    id: string;
    index: number;
    role: string;
    speaker: string;
    createdAt: string;
    content: string;
  };

  async function loadTranscript(): Promise<TranscriptEntry[]> {
    const rows = await chats.listMessages(deps.chatId);
    const nameById = new Map(deps.characters.map((character) => [character.id, character.name]));
    return rows.map((row, index) => ({
      id: row.id,
      index: index + 1,
      role: row.role,
      speaker: row.role === "user" ? "user" : (nameById.get(row.characterId ?? "") ?? row.role),
      createdAt: row.createdAt,
      content: row.content ?? "",
    }));
  }

  async function searchMessagesTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const query = str(args.query).trim();
    if (!query) throw new Error("query is required.");
    const limit = Math.min(30, Math.max(1, Math.floor(num(args.limit, 10))));
    const speaker = str(args.speaker).trim().toLowerCase();
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 1);
    const transcript = await loadTranscript();
    const scored = transcript
      .filter((entry) => !speaker || entry.speaker.toLowerCase() === speaker)
      .map((entry) => {
        const haystack = entry.content.toLowerCase();
        const phrase = haystack.includes(query.toLowerCase()) ? 3 : 0;
        const hits = terms.filter((term) => haystack.includes(term)).length;
        return { entry, score: phrase + hits };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.index - a.entry.index)
      .slice(0, limit);
    const matches = scored.map(({ entry }) => {
      const at = Math.max(0, entry.content.toLowerCase().indexOf(terms[0] ?? query.toLowerCase()));
      const start = Math.max(0, at - MESSAGE_SNIPPET / 3);
      return {
        id: entry.id,
        index: entry.index,
        speaker: entry.speaker,
        at: entry.createdAt,
        snippet: `${start > 0 ? "…" : ""}${entry.content.slice(start, start + MESSAGE_SNIPPET)}${
          start + MESSAGE_SNIPPET < entry.content.length ? "…" : ""
        }`,
      };
    });
    return { result: ok(JSON.stringify({ total: transcript.length, matches })), media: [] };
  }

  async function readMessagesTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const transcript = await loadTranscript();
    let picked: TranscriptEntry[] = [];
    if (Array.isArray(args.ids) && args.ids.length) {
      const wanted = new Set(args.ids.map(String));
      picked = transcript.filter((entry) => wanted.has(entry.id));
    } else {
      const from = Math.max(1, Math.floor(num(args.from_index, 1)));
      const to = Math.min(transcript.length, Math.floor(num(args.to_index, from)));
      picked = transcript.filter((entry) => entry.index >= from && entry.index <= to);
    }
    picked = picked.slice(0, 20);
    return {
      result: ok(
        JSON.stringify({
          messages: picked.map((entry) => ({
            id: entry.id,
            index: entry.index,
            speaker: entry.speaker,
            at: entry.createdAt,
            content: clip(entry.content, MESSAGE_READ_LIMIT),
          })),
        }),
      ),
      media: [],
    };
  }

  async function setStatusTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const character = findCharacter(str(args.character) || undefined);
    if (!character) {
      throw new Error(
        `Which character? Known: ${deps.characters.map((entry) => entry.name).join(", ") || "none in this chat"}.`,
      );
    }
    const patch = normalizeConvoCharacterStatusPatch({
      emotion: args.emotion,
      emotionCause: args.emotion_cause,
      temperature: args.temperature,
      notes: args.notes,
      bars: args.bars,
      limbs: args.limbs,
      extras: args.extras,
    });
    if (!patch || Object.keys(patch).length === 0) throw new Error("Nothing to update; include at least one field.");
    deps.onStatusPatch(character.id, patch);
    return {
      result: ok(`${character.name}'s status will be updated with this reply: ${JSON.stringify(patch)}`),
      media: [],
    };
  }

  async function lookupLorebookTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const query = str(args.query).trim();
    if (!query) throw new Error("query is required.");
    if (!deps.searchLorebook) throw new Error("Lorebook search is unavailable for this chat.");
    const entries = await deps.searchLorebook(query, null);
    return {
      result: ok(
        JSON.stringify({
          entries: entries.slice(0, 12).map((entry) => ({
            name: entry.name,
            keys: entry.keys,
            content: clip(entry.content, 2_000),
          })),
        }),
      ),
      media: [],
    };
  }

  async function chatLorebookId(): Promise<string> {
    const existing = await lorebooks.listByChat(deps.chatId);
    const first = existing[0] as { id: string } | undefined;
    if (first) return first.id;
    const created = await lorebooks.create({
      name: `${deps.chatName || "Chat"} (REagent)`,
      description: "Entries written by the character while chatting.",
      chatId: deps.chatId,
    } as never);
    if (!created) throw new Error("Could not create the chat lorebook.");
    return (created as unknown as { id: string }).id;
  }

  async function writeLorebookEntryTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = str(args.name).trim().slice(0, 200);
    const content = str(args.content).trim();
    const keys = Array.isArray(args.keys)
      ? args.keys
          .map(String)
          .map((key) => key.trim())
          .filter(Boolean)
      : [];
    if (!name || !content) throw new Error("name and content are required.");
    const lorebookId = await chatLorebookId();
    const entries = (await lorebooks.listEntries(lorebookId)) as unknown as Array<{
      id: string;
      name: string;
      content: string;
      keys: unknown[];
    }>;
    const existing = entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const nextContent = args.mode === "append" ? `${existing.content.trimEnd()}\n${content}` : content;
      const currentKeys = Array.isArray(existing.keys) ? existing.keys.map(String) : [];
      await lorebooks.updateEntry(existing.id, {
        content: nextContent,
        keys: Array.from(new Set([...currentKeys, ...keys])),
      } as never);
      return { result: ok(`Updated lorebook entry "${name}".`), media: [] };
    }
    await lorebooks.createEntry({ lorebookId, name, content, keys: keys.length ? keys : [name] });
    return {
      result: ok(`Created lorebook entry "${name}" with keys ${JSON.stringify(keys.length ? keys : [name])}.`),
      media: [],
    };
  }

  async function fetchUrlTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const url = str(args.url).trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs can be fetched.");
    const maxChars = Math.min(60_000, Math.max(500, Math.floor(num(args.max_chars, RESULT_TEXT_LIMIT))));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    deps.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (compatible; MarinaraEngine REagent)", accept: "text/html,*/*" },
      });
      const type = response.headers.get("content-type") ?? "";
      const raw = Buffer.from(await response.arrayBuffer());
      const text = raw.subarray(0, 4 * 1024 * 1024).toString("utf8");
      let body: string;
      let title: string | undefined;
      if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(text)) {
        title = decodeHtmlEntities(text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "") || undefined;
        body = stripHtml(text.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " "));
      } else if (/json/i.test(type)) {
        try {
          body = JSON.stringify(JSON.parse(text), null, 1);
        } catch {
          body = text;
        }
      } else {
        body = text;
      }
      body = body.replace(/\n{3,}/g, "\n\n").trim();
      return {
        result: ok(JSON.stringify({ status: response.status, url: response.url, title, text: clip(body, maxChars) })),
        media: [],
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function runCommandTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const command = str(args.command).trim();
    if (!command) throw new Error("command is required.");
    const cwd = str(args.cwd).trim()
      ? resolveReagentPath(str(args.cwd), pathOptions(false)).absolute
      : deps.workspaceDir;
    const verdict = judgeCommand(command, deps.settings);
    if (verdict === "refuse") {
      throw new Error(
        deps.settings.shellPolicy === "allowlist"
          ? "This command is not on the chat's allowlist."
          : "This command matches the chat's deny list.",
      );
    }
    let approval: ReagentActivityEntry["approval"];
    if (verdict === "ask") {
      const { request, decision } = createApproval(
        { chatId: deps.chatId, command, cwd, ...(str(args.reason) ? { reason: str(args.reason) } : {}) },
        deps.signal,
      );
      deps.sendEvent?.({ type: "reagent_approval", data: request });
      approval = await decision;
      if (approval !== "approved") {
        return {
          result: fail(
            approval === "timeout"
              ? "The user did not answer in time; the command was not run."
              : "The user declined this command.",
          ),
          media: [],
          approval,
        };
      }
    }
    const run = await runShellCommand(command, { cwd, signal: deps.signal });
    return {
      result: ok(
        JSON.stringify({
          exitCode: run.exitCode,
          timedOut: run.timedOut,
          durationMs: run.durationMs,
          cwd,
          stdout: run.stdout,
          stderr: run.stderr,
        }),
      ),
      media: [],
      ...(approval ? { approval } : {}),
    };
  }

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<ReagentToolOutcome>> = {
    read_file: readFileTool,
    list_dir: listDirTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
    delete_file: deleteFileTool,
    update_memory: updateMemoryTool,
    search_messages: searchMessagesTool,
    read_messages: readMessagesTool,
    set_character_status: setStatusTool,
    lookup_lorebook: lookupLorebookTool,
    write_lorebook_entry: writeLorebookEntryTool,
    fetch_url: fetchUrlTool,
    run_command: runCommandTool,
  };

  function ok(result: string): ToolExecutionResult {
    return { toolCallId: "", name: "", result, success: true };
  }
  function fail(message: string): ToolExecutionResult {
    return { toolCallId: "", name: "", result: JSON.stringify({ error: message }), success: false };
  }

  return {
    async execute(call: LLMToolCall): Promise<ReagentToolOutcome & { activity: ReagentActivityEntry }> {
      const started = Date.now();
      let args: Record<string, unknown> = {};
      let outcome: ReagentToolOutcome;
      try {
        const parsed: unknown = JSON.parse(call.function.arguments || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("Arguments must be a JSON object.");
        args = parsed as Record<string, unknown>;
        const handler = handlers[call.function.name];
        if (!handler) throw new Error(`Unknown REagent tool: ${call.function.name}`);
        outcome = await handler(args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug("[reagent] %s failed: %s", call.function.name, message);
        outcome = { result: fail(message), media: [] };
      }
      outcome.result = { ...outcome.result, toolCallId: call.id, name: call.function.name };
      const activity: ReagentActivityEntry = {
        id: newId(),
        tool: call.function.name,
        args: clipArgs(args),
        result: clip(outcome.result.result, 4_000),
        ok: outcome.result.success,
        durationMs: Date.now() - started,
        ...(outcome.media.length ? { media: outcome.media.map(({ kind, name }) => ({ kind, name })) } : {}),
        ...(outcome.approval ? { approval: outcome.approval } : {}),
      };
      return { ...outcome, activity };
    },
  };
}

function clipArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === "string" && value.length > 1_500 ? `${value.slice(0, 1_500)}…` : value;
  }
  return out;
}
