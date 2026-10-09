// ──────────────────────────────────────────────
// REagent: the roleplay-enhancing agent.
//
// The same model that writes the reply can use tools while it reasons: a
// per-chat workspace with a memory file, the transcript, lorebooks, the
// character status ledger, the web and (opt-in) a shell. Everything it writes
// into the workspace is journaled on the swipe that wrote it, so swiping,
// regenerating and deleting messages revert the workspace along with the text.
// ──────────────────────────────────────────────

export const REAGENT_TOOL_FAMILIES = [
  "files",
  "memory",
  "recall",
  "status",
  "lorebook",
  "web",
  "shell",
  "noodle",
  "images",
] as const;

export type ReagentToolFamily = (typeof REAGENT_TOOL_FAMILIES)[number];

/**
 * How a shell command gets to run.
 * - allowlist: only commands matching an allow pattern (and no deny pattern) run; everything else is refused.
 * - ask: deny patterns are refused, allow patterns run, and everything else waits for the user's answer.
 * - bypass: deny patterns are refused, everything else runs.
 */
export type ReagentShellPolicy = "allowlist" | "ask" | "bypass";

export interface ReagentSettings {
  enabled: boolean;
  tools: Record<ReagentToolFamily, boolean>;
  shellPolicy: ReagentShellPolicy;
  /** Regular expressions (one per entry) matched against the whole command line. */
  shellAllow: string[];
  shellDeny: string[];
  /** Keep file reads inside the chat workspace instead of the whole machine. */
  restrictReadsToWorkspace: boolean;
  /** Extra directories the model may write to, besides its workspace. */
  writableRoots: string[];
}

export const DEFAULT_REAGENT_SETTINGS: ReagentSettings = {
  enabled: false,
  tools: {
    files: true,
    memory: true,
    recall: true,
    status: true,
    lorebook: true,
    web: true,
    shell: false,
    noodle: false,
    images: false,
  },
  shellPolicy: "ask",
  shellAllow: [],
  shellDeny: [],
  restrictReadsToWorkspace: false,
  writableRoots: [],
};

export const REAGENT_MEMORY_FILE = "memory.md";

/** Chat metadata key holding the partial settings object. */
export const REAGENT_SETTINGS_METADATA_KEY = "reagent";
/** Chat metadata key holding the user's own workspace edits, anchored to the transcript. */
export const REAGENT_USER_EDITS_METADATA_KEY = "reagentUserFileEdits";

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The chat's REagent settings with every missing field filled from the defaults. */
export function readReagentSettings(chatMetadata: Record<string, unknown> | null | undefined): ReagentSettings {
  const raw = chatMetadata?.[REAGENT_SETTINGS_METADATA_KEY];
  const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const storedTools =
    stored.tools && typeof stored.tools === "object" && !Array.isArray(stored.tools)
      ? (stored.tools as Record<string, unknown>)
      : {};
  const tools = { ...DEFAULT_REAGENT_SETTINGS.tools };
  for (const family of REAGENT_TOOL_FAMILIES) {
    if (typeof storedTools[family] === "boolean") tools[family] = storedTools[family] as boolean;
  }
  const shellPolicy = stored.shellPolicy;
  return {
    enabled: stored.enabled === true,
    tools,
    shellPolicy:
      shellPolicy === "allowlist" || shellPolicy === "ask" || shellPolicy === "bypass"
        ? shellPolicy
        : DEFAULT_REAGENT_SETTINGS.shellPolicy,
    shellAllow: readStringList(stored.shellAllow),
    shellDeny: readStringList(stored.shellDeny),
    restrictReadsToWorkspace: stored.restrictReadsToWorkspace === true,
    writableRoots: readStringList(stored.writableRoots),
  };
}

/** One tool call the model made while writing a reply, kept on that swipe for the trace button. */
export interface ReagentActivityEntry {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** What the model was shown, trimmed for storage. */
  result: string;
  ok: boolean;
  durationMs: number;
  /** Files the model was shown as real inputs (images, videos) through this call. */
  media?: Array<{ kind: "image" | "video"; name: string }>;
  /** A shell command waited for the user; what they answered. */
  approval?: "approved" | "denied" | "timeout";
}

/**
 * Workspace files as this swipe left them: path → full content, or null when the
 * swipe deleted the file. Paths are workspace-relative with forward slashes.
 */
export type ReagentFileVersions = Record<string, string | null>;

/** A workspace edit made by the user, applied in transcript order after the message it is anchored to. */
export interface ReagentUserFileEdit {
  path: string;
  content: string | null;
  /** Null anchors the edit before the first message. A missing message applies the edit at the end. */
  afterMessageId: string | null;
  at: string;
}

export function readReagentUserFileEdits(
  chatMetadata: Record<string, unknown> | null | undefined,
): ReagentUserFileEdit[] {
  const raw = chatMetadata?.[REAGENT_USER_EDITS_METADATA_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ReagentUserFileEdit =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as ReagentUserFileEdit).path === "string" &&
      ((entry as ReagentUserFileEdit).content === null || typeof (entry as ReagentUserFileEdit).content === "string"),
  );
}

/** A shell command waiting for the user's answer, as sent to the client. */
export interface ReagentApprovalRequest {
  id: string;
  chatId: string;
  command: string;
  cwd: string;
  /** Why the model says it wants to run it, when it said. */
  reason?: string;
}
