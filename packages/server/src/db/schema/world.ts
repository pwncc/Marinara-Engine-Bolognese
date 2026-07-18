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
