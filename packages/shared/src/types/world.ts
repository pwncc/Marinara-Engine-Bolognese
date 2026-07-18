// ──────────────────────────────────────────────
// Living World engine — config, events, relationships
// ──────────────────────────────────────────────

/**
 * How the world advances.
 * - "minds": every character is its own agent — private context, memory,
 *   journal, and clock. They wake, think, and freely choose to act. Emergent.
 * - "director": one cheap planning call per window writes a timeline. Authored.
 */
export type WorldEngineMode = "minds" | "director";

/** App-wide Living World engine configuration (app_settings key "worldEngine"). */
export interface WorldEngineConfig {
  /** Master switch — the world only simmers when this is on. */
  enabled: boolean;
  /** Simulation style. */
  mode: WorldEngineMode;
  /**
   * Minds mode: how often a character naturally checks in on their life, on
   * average (their own choices, presence, and events shift the real timing).
   */
  wakeIntervalMinutes: number;
  /**
   * LLM used to advance the world: an API connection id, "local" for the
   * local sidecar, or null (engine idle until configured).
   */
  connectionId: string | null;
  /** Minutes between autonomous world beats. */
  cadenceMinutes: number;
  /** Max actions the simulator may take per beat. */
  maxActionsPerTick: number;
  /** Hard daily cap on executed world actions (budget guard). 0 = unlimited. */
  dailyActionCap: number;
  /** Allow public noodle activity (posts, replies, likes, follows). */
  allowNoodle: boolean;
  /** Allow private character↔character DM threads. */
  allowDms: boolean;
  /** Allow characters to record memories about each other. */
  allowMemories: boolean;
  /** Sampling temperature for world beats. */
  temperature: number;
  /** Extra standing instructions appended to the simulator prompt. */
  userDirective: string;
  /** City for the world's real weather (Open-Meteo). Empty = clock/season only. */
  weatherLocation: string;
  /**
   * Who lives in the world: null = every character, otherwise only these ids
   * (noodle-invite style). An empty list pauses the world (nobody to simulate).
   */
  memberCharacterIds: string[] | null;
}

export const DEFAULT_WORLD_ENGINE_CONFIG: WorldEngineConfig = {
  enabled: false,
  mode: "minds",
  wakeIntervalMinutes: 90,
  connectionId: null,
  cadenceMinutes: 45,
  maxActionsPerTick: 5,
  dailyActionCap: 60,
  allowNoodle: true,
  allowDms: true,
  allowMemories: true,
  temperature: 0.9,
  userDirective: "",
  weatherLocation: "",
  memberCharacterIds: null,
};

/** Relationship stage derived from the numeric score. */
export type RelationshipStage =
  | "strangers"
  | "acquaintances"
  | "friendly"
  | "close"
  | "devoted"
  | "tense"
  | "hostile";

export function getRelationshipStage(score: number): RelationshipStage {
  if (score >= 75) return "devoted";
  if (score >= 45) return "close";
  if (score >= 15) return "friendly";
  if (score > -15) return score > 5 ? "acquaintances" : "strangers";
  if (score > -50) return "tense";
  return "hostile";
}

export interface RelationshipMilestoneEntry {
  at: string;
  title: string;
  description: string;
  eventId?: string;
}

export interface CharacterRelationshipRecord {
  id: string;
  aCharacterId: string;
  bCharacterId: string;
  score: number;
  romance: boolean;
  /** Freeform label overriding the derived stage when set. */
  label: string | null;
  stage: RelationshipStage;
  summary: string;
  milestones: RelationshipMilestoneEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface WorldEventRecord {
  id: string;
  kind: string;
  summary: string;
  characterIds: string[];
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Rolling scheduler state (app_settings key "worldEngineState"). */
export interface WorldEngineState {
  lastRunAt: string | null;
  dailyDate: string;
  dailyCount: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastNarration: string | null;
}
