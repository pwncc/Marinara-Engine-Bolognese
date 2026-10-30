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
  "roster",
  "notes",
  "simulation",
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
    roster: true,
    notes: true,
    simulation: true,
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
/** Workspace file holding the simulation ledger: the writer's own scene clock, recent events, loose threads and off-screen whereabouts. */
export const REAGENT_SIMULATION_FILE = "simulation.json";
/** Workspace folder holding one development dossier per character (`<slug>.md`). */
export const REAGENT_CHARACTER_NOTES_DIR = "characters";

export interface ReagentThread {
  id: string;
  what: string;
  /** When or on what condition it comes due, in the model's words. */
  when?: string;
  who?: string;
  /** What it costs if nobody acts on it. */
  stakes?: string;
  /** Scene time when it was opened, when known. */
  openedAt?: string;
}

export interface ReagentResolvedThread {
  id: string;
  what: string;
  outcome: string;
  at?: string;
}

export interface ReagentWhereabouts {
  where: string;
  doing?: string;
  /** Until when, or what ends it. */
  until?: string;
  updatedAt?: string;
}

/** The writer's own scene clock. It is not the World State tracker and never written there. */
export interface ReagentSceneState {
  date?: string;
  time?: string;
  location?: string;
  weather?: string;
  temperature?: string;
}

export const REAGENT_SCENE_FIELDS = ["date", "time", "location", "weather", "temperature"] as const;

/** The simulation ledger as stored in the workspace; every field is optional on disk. */
export interface ReagentSimulationState {
  scene: ReagentSceneState;
  /** Recent concrete happenings, oldest first. */
  events: string[];
  threads: ReagentThread[];
  resolved: ReagentResolvedThread[];
  offscreen: Record<string, ReagentWhereabouts>;
}

export const EMPTY_REAGENT_SIMULATION: ReagentSimulationState = {
  scene: {},
  events: [],
  threads: [],
  resolved: [],
  offscreen: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Parse the simulation file leniently; anything malformed becomes the empty ledger. */
export function parseReagentSimulation(raw: string | null | undefined): ReagentSimulationState {
  const empty = (): ReagentSimulationState => ({ scene: {}, events: [], threads: [], resolved: [], offscreen: {} });
  if (!raw?.trim()) return empty();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty();
  }
  if (!isRecord(parsed)) return empty();
  const scene: ReagentSceneState = {};
  if (isRecord(parsed.scene)) {
    for (const key of REAGENT_SCENE_FIELDS) {
      const value = parsed.scene[key];
      if (typeof value === "string" && value.trim()) scene[key] = value;
    }
  }
  const events = Array.isArray(parsed.events)
    ? parsed.events.filter((entry): entry is string => typeof entry === "string")
    : [];
  const threads = Array.isArray(parsed.threads)
    ? parsed.threads.filter(
        (entry): entry is ReagentThread =>
          isRecord(entry) && typeof entry.id === "string" && typeof entry.what === "string",
      )
    : [];
  const resolved = Array.isArray(parsed.resolved)
    ? parsed.resolved.filter(
        (entry): entry is ReagentResolvedThread =>
          isRecord(entry) && typeof entry.id === "string" && typeof entry.what === "string",
      )
    : [];
  const offscreen: Record<string, ReagentWhereabouts> = {};
  if (isRecord(parsed.offscreen)) {
    for (const [name, entry] of Object.entries(parsed.offscreen)) {
      if (isRecord(entry) && typeof entry.where === "string") offscreen[name] = entry as unknown as ReagentWhereabouts;
    }
  }
  return { scene, events, threads, resolved, offscreen };
}

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
