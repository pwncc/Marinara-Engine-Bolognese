// ──────────────────────────────────────────────
// Character status patches → present-character tracker rows.
//
// The tracker's `presentCharacters` is the one ledger for how a character is
// doing. A status patch (from the REagent tool or a legacy body/mood map)
// becomes an incremental row update merged by characterId.
// ──────────────────────────────────────────────

import type { CharacterStat, PresentCharacter } from "../types/game-state.js";

/** Fields a status patch may carry, in the loose form models produce. */
export interface CharacterStatusPatchInput {
  emotion?: unknown;
  mood?: unknown;
  emotionCause?: unknown;
  emotion_cause?: unknown;
  temperature?: unknown;
  notes?: unknown;
  bars?: unknown;
  stats?: unknown;
  limbs?: unknown;
  extras?: unknown;
  customFields?: unknown;
}

export type PresentCharacterUpdate = Partial<PresentCharacter> & Pick<PresentCharacter, "characterId" | "name">;

/**
 * The standard meters every tracked character starts with. Shared by the status tool's
 * description (so the model keeps the names and meanings) and by row seeding.
 */
export const CHARACTER_STATUS_BAR_SPECS = [
  {
    name: "happiness",
    initial: 60,
    description: "Overall contentment and positive mood right now.",
    dynamics: "Moves with emotional beats; drifts, rarely jumps more than ~20 points in one turn.",
  },
  {
    name: "hunger",
    initial: 30,
    description: "Need for food. 0 = completely full, 100 = starving.",
    dynamics: "Climbs slowly as hours pass; drops sharply after eating.",
  },
  {
    name: "horny",
    initial: 20,
    description: "Sexual desire: how much they WANT intimacy right now. Appetite, not physical build-up.",
    dynamics: "Builds with attraction, flirting, teasing or denial; eases only partly after release. Slow-moving.",
  },
  {
    name: "arousal",
    initial: 0,
    description: "Physical build-up: how close their body is to orgasm RIGHT NOW. 0 = unaroused, 100 = on the edge.",
    dynamics: "Fast-moving: rises under direct stimulation, sinks during pauses, resets to ~0 right after orgasm.",
  },
  {
    name: "energy",
    initial: 70,
    description: "Physical stamina. 0 = collapsing-exhausted, 100 = rested and wired.",
    dynamics: "Drains with exertion, late hours and orgasms; recovers with rest, food and sleep.",
  },
  {
    name: "stress",
    initial: 20,
    description: "Tension, anxiety or overwhelm.",
    dynamics: "Spikes with conflict, pressure or embarrassment; eases with comfort, resolution and release.",
  },
] as const;

/** Limb keys every tracked character starts with (empty until something is worth noting). */
export const DEFAULT_STATUS_LIMBS = [
  "head",
  "neck",
  "torso",
  "left arm",
  "right arm",
  "left hand",
  "right hand",
  "left leg",
  "right leg",
  "groin",
] as const;

const STAT_COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa", "#f472b6", "#2dd4bf"];

/** A stable colour per stat name so the same bar looks the same across characters. */
export function statColorForName(name: string): string {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return STAT_COLORS[hash % STAT_COLORS.length]!;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function stringRecord(value: unknown, max = 200): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim().slice(0, 60);
    if (!name) continue;
    out[name] = typeof raw === "string" ? raw.trim().slice(0, max) : String(raw ?? "").slice(0, max);
  }
  return Object.keys(out).length ? out : undefined;
}

function clampPercent(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number.parseFloat(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return undefined;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function statsFromInput(bars: unknown, stats: unknown): CharacterStat[] | undefined {
  const out: CharacterStat[] = [];
  if (bars && typeof bars === "object" && !Array.isArray(bars)) {
    for (const [name, raw] of Object.entries(bars as Record<string, unknown>)) {
      const value = clampPercent(raw);
      const label = name.trim().slice(0, 40);
      if (value === undefined || !label) continue;
      out.push({ name: label, value, max: 100, color: statColorForName(label) });
    }
  }
  if (Array.isArray(stats)) {
    for (const entry of stats) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const name = text(row.name, 40);
      const value = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : undefined;
      if (!name || value === undefined) continue;
      const max = typeof row.max === "number" && Number.isFinite(row.max) && row.max > 0 ? row.max : 100;
      out.push({
        name,
        value: Math.max(0, Math.min(max, value)),
        max,
        color: text(row.color, 32) ?? statColorForName(name),
      });
    }
  }
  return out.length ? out : undefined;
}

/**
 * Turn a loose status patch into an incremental present-character row. Only the
 * fields present in the patch are set, so the tracker merge keeps the rest.
 */
export function buildPresentCharacterUpdate(
  characterId: string,
  name: string,
  input: CharacterStatusPatchInput,
): PresentCharacterUpdate | null {
  const update: PresentCharacterUpdate = { characterId, name };
  let touched = false;
  const mood = text(input.emotion, 120) ?? text(input.mood, 120);
  if (mood !== undefined) {
    update.mood = mood;
    touched = true;
  }
  const emotionCause = text(input.emotionCause, 200) ?? text(input.emotion_cause, 200);
  if (emotionCause !== undefined) {
    update.emotionCause = emotionCause;
    touched = true;
  } else if (mood !== undefined) {
    // A new mood without a reason must not keep the old reason.
    update.emotionCause = null;
  }
  const temperature = text(input.temperature, 120);
  if (temperature !== undefined) {
    update.temperature = temperature;
    touched = true;
  }
  const notes = text(input.notes, 500);
  if (notes !== undefined) {
    update.notes = notes;
    touched = true;
  }
  const stats = statsFromInput(input.bars, input.stats);
  if (stats) {
    update.stats = stats;
    touched = true;
  }
  const limbs = stringRecord(input.limbs);
  if (limbs) {
    update.limbs = limbs;
    touched = true;
  }
  const customFields = stringRecord(input.extras) ?? stringRecord(input.customFields);
  if (customFields) {
    update.customFields = customFields;
    touched = true;
  }
  return touched ? update : null;
}

/**
 * Fill in the standard meters and limb keys a row is missing, keeping whatever it
 * already has. Used when a row is first created (migration, the status tool, the
 * conversation strip) so every character shows the same ledger.
 */
export function withDefaultStatusFields<T extends Partial<PresentCharacter>>(row: T): T {
  const stats: CharacterStat[] = Array.isArray(row.stats) ? [...row.stats] : [];
  const have = new Set(stats.map((stat) => stat.name.trim().toLowerCase()));
  for (const spec of CHARACTER_STATUS_BAR_SPECS) {
    if (have.has(spec.name)) continue;
    stats.push({ name: spec.name, value: spec.initial, max: 100, color: statColorForName(spec.name) });
  }
  const limbs: Record<string, string> = { ...(row.limbs ?? {}) };
  const haveLimbs = new Set(Object.keys(limbs).map((limb) => limb.trim().toLowerCase()));
  for (const limb of DEFAULT_STATUS_LIMBS) {
    if (!haveLimbs.has(limb)) limbs[limb] = "";
  }
  return { ...row, stats, limbs };
}

/** Everything a present-character row says about how the character is doing, for a one-line summary. */
export function summarizePresentCharacterStatus(character: Partial<PresentCharacter>): string[] {
  const parts: string[] = [];
  if (character.mood)
    parts.push(character.emotionCause ? `${character.mood} (${character.emotionCause})` : character.mood);
  if (character.temperature) parts.push(`temperature: ${character.temperature}`);
  if (character.notes) parts.push(character.notes);
  return parts;
}
