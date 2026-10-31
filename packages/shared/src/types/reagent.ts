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
  "minds",
  "affect",
  "speech",
  "ambient",
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
    minds: true,
    affect: true,
    speech: true,
    ambient: true,
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

/** One thing a person knows, was told or wrongly concluded. Nobody acts on what is not in their ledger. */
export interface ReagentBelief {
  id: string;
  fact: string;
  /** How they came to know it: saw it, was told by X, guessed. */
  source?: string;
  /** They believe it, and it is not true. */
  wrong?: boolean;
  /** They keep it from others. */
  secret?: boolean;
  at?: string;
}

/** What a person wants right now, what is in the way, and how they are going about it. */
export interface ReagentObjective {
  want: string;
  obstacle?: string;
  tactic?: string;
  /** Tactics that visibly failed, oldest first. */
  tried?: string[];
  since?: string;
}

/** How a person is playing their standing toward someone else in this exchange. */
export interface ReagentStatusRelation {
  toward: string;
  level: "high" | "low" | "equal";
  note?: string;
}

/** The result of an appraisal; intensity decays with the scene clock, the valence lingers as mood. */
export interface ReagentMood {
  emotion: string;
  /** 0-100 when set; decays by scene ticks. */
  intensity: number;
  /** -1..1 */
  valence: number;
  /** What the emotion pushes them to do. */
  tendency: string;
  cause?: string;
  /** Scene tick (set_scene calls) when set. */
  atTick: number;
  atTime?: string;
}

/** How a person talks: a budget the writer follows, not a style to perform. */
export interface ReagentVoice {
  register?: string;
  sentences?: string;
  fillers?: string;
  avoids?: string;
  /** 0-1: how often they hesitate, restart or trail off. */
  disfluency?: number;
  quirks?: string;
}

/** The gap between what a person means and what they say; only the said part is written. */
export interface ReagentSubtext {
  means: string;
  says: string;
  at?: string;
}

/** The simulation ledger as stored in the workspace; every field is optional on disk. */
export interface ReagentSimulationState {
  scene: ReagentSceneState;
  /** Counts set_scene calls: the scene clock moods decay against. */
  tick: number;
  /** Recent concrete happenings, oldest first. */
  events: string[];
  threads: ReagentThread[];
  resolved: ReagentResolvedThread[];
  offscreen: Record<string, ReagentWhereabouts>;
  beliefs: Record<string, ReagentBelief[]>;
  objectives: Record<string, ReagentObjective>;
  status: Record<string, ReagentStatusRelation[]>;
  moods: Record<string, ReagentMood>;
  voices: Record<string, ReagentVoice>;
  subtext: Record<string, ReagentSubtext>;
}

export const EMPTY_REAGENT_SIMULATION: ReagentSimulationState = {
  scene: {},
  tick: 0,
  events: [],
  threads: [],
  resolved: [],
  offscreen: {},
  beliefs: {},
  objectives: {},
  status: {},
  moods: {},
  voices: {},
  subtext: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Parse the simulation file leniently; anything malformed becomes the empty ledger. */
export function parseReagentSimulation(raw: string | null | undefined): ReagentSimulationState {
  const empty = (): ReagentSimulationState => ({
    scene: {},
    tick: 0,
    events: [],
    threads: [],
    resolved: [],
    offscreen: {},
    beliefs: {},
    objectives: {},
    status: {},
    moods: {},
    voices: {},
    subtext: {},
  });
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
  const tick =
    typeof parsed.tick === "number" && Number.isFinite(parsed.tick) ? Math.max(0, Math.floor(parsed.tick)) : 0;
  /** A record of per-person entries, keeping the ones that pass `keep`. */
  const byPerson = <T>(value: unknown, keep: (entry: unknown) => entry is T): Record<string, T> => {
    const out: Record<string, T> = {};
    if (!isRecord(value)) return out;
    for (const [name, entry] of Object.entries(value)) if (name.trim() && keep(entry)) out[name] = entry;
    return out;
  };
  const beliefs: Record<string, ReagentBelief[]> = {};
  if (isRecord(parsed.beliefs)) {
    for (const [name, list] of Object.entries(parsed.beliefs)) {
      if (!name.trim() || !Array.isArray(list)) continue;
      const kept = list.filter(
        (entry): entry is ReagentBelief =>
          isRecord(entry) && typeof entry.id === "string" && typeof entry.fact === "string",
      );
      if (kept.length) beliefs[name] = kept;
    }
  }
  const objectives = byPerson(
    parsed.objectives,
    (entry): entry is ReagentObjective => isRecord(entry) && typeof entry.want === "string" && !!entry.want.trim(),
  );
  const status: Record<string, ReagentStatusRelation[]> = {};
  if (isRecord(parsed.status)) {
    for (const [name, list] of Object.entries(parsed.status)) {
      if (!name.trim() || !Array.isArray(list)) continue;
      const kept = list.filter(
        (entry): entry is ReagentStatusRelation =>
          isRecord(entry) &&
          typeof entry.toward === "string" &&
          (entry.level === "high" || entry.level === "low" || entry.level === "equal"),
      );
      if (kept.length) status[name] = kept;
    }
  }
  const moods = byPerson(
    parsed.moods,
    (entry): entry is ReagentMood =>
      isRecord(entry) &&
      typeof entry.emotion === "string" &&
      typeof entry.intensity === "number" &&
      typeof entry.valence === "number" &&
      typeof entry.tendency === "string" &&
      typeof entry.atTick === "number",
  );
  const voices = byPerson(parsed.voices, (entry): entry is ReagentVoice => isRecord(entry));
  const subtext = byPerson(
    parsed.subtext,
    (entry): entry is ReagentSubtext =>
      isRecord(entry) && typeof entry.means === "string" && typeof entry.says === "string",
  );
  return { scene, tick, events, threads, resolved, offscreen, beliefs, objectives, status, moods, voices, subtext };
}

/** Half the intensity goes every two scene ticks; under 10 the feeling has settled into mood. */
export function decayedReagentMood(mood: ReagentMood, tick: number): ReagentMood {
  const elapsed = Math.max(0, tick - mood.atTick);
  const intensity = Math.round(mood.intensity * Math.pow(0.5, elapsed / 2));
  return { ...mood, intensity };
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
