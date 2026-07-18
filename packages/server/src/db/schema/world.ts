// ──────────────────────────────────────────────
// Schema: Living World (relationships + event history)
// ──────────────────────────────────────────────
import { fileTable, text } from "../file-schema.js";

/**
 * Append-only log of everything that happens in the character world:
 * noodle activity, character↔character DMs, plans, relationship milestones.
 * This is the "look back at how they met" record.
 */
export const worldEvents = fileTable("world_events", {
  id: text("id").primaryKey(),
  /** Open vocabulary: noodle_post, noodle_reply, dm, plan, relationship, memory, milestone, tick… */
  kind: text("kind").notNull(),
  /** Human-readable one-liner shown in the world feed. */
  summary: text("summary").notNull().default(""),
  /** Participant character ids (JSON array) for filtering. */
  characterIds: text("character_ids").notNull().default("[]"),
  /** JSON: refs (postId/chatId/messageIds/relationship pair), plan dueAt/done, etc. */
  detail: text("detail").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

/**
 * The upcoming timeline: actions the director has planned but that haven't
 * happened yet. A drip executor runs each one when its runAt arrives, so the
 * world accretes continuously instead of in bursts.
 */
export const worldActions = fileTable("world_actions", {
  id: text("id").primaryKey(),
  /** ISO timestamp this action should happen at. */
  runAt: text("run_at").notNull(),
  /** JSON action payload (same vocabulary the executors consume). */
  action: text("action").notNull().default("{}"),
  /** pending | done | failed | skipped */
  status: text("status").notNull().default("pending"),
  /** Director narration batch this action belongs to (for grouping/debug). */
  directorRunId: text("director_run_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * One row per character mind (minds mode): their private continuous state —
 * current intention, mood, wake clock, and read-cursors into the world.
 * Journal thoughts live in world_events (kind "thought") keyed to the character.
 */
export const characterMinds = fileTable("character_minds", {
  /** Character id (one mind per character). */
  id: text("id").primaryKey(),
  /** What they're currently up to / meaning to do, in their own words. */
  intention: text("intention").notNull().default(""),
  /** Their current inner mood, in their own words. */
  mood: text("mood").notNull().default(""),
  lastWakeAt: text("last_wake_at"),
  nextWakeAt: text("next_wake_at"),
  /** JSON: { seenPostsAt, seenDmsAt } — what they've already caught up on. */
  cursors: text("cursors").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Pairwise character relationship state. One row per unordered pair
 * (aCharacterId < bCharacterId lexicographically).
 */
export const characterRelationships = fileTable(
  "character_relationships",
  {
    id: text("id").primaryKey(),
    aCharacterId: text("a_character_id").notNull(),
    bCharacterId: text("b_character_id").notNull(),
    /** -100 (hatred) … 100 (devotion). */
    score: text("score").notNull().default("0"),
    /** "true" when the bond is romantic in nature. */
    romance: text("romance").notNull().default("false"),
    /** Optional freeform label overriding the derived stage ("situationship", "exes"…). */
    label: text("label"),
    /** LLM-maintained "how things stand between them" summary. */
    summary: text("summary").notNull().default(""),
    /** JSON array of { at, title, description, eventId } milestones. */
    milestones: text("milestones").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  {
    uniqueBy: [{ keys: ["aCharacterId", "bCharacterId"] }],
  },
);
