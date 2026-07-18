// ──────────────────────────────────────────────
// Conversation character body / mood status (CONVO)
// ──────────────────────────────────────────────

/** Per-bar display and guidance (keyed by bar id in `bars`). */
export interface ConvoBarMeta {
  /** User-facing label override (e.g. "arousal (how close to the edge)"). */
  label?: string;
  /** What this meter measures — shown to the user and injected for the AI. */
  description?: string;
  /** Extra reminders or scene-specific notes for this bar. */
  notes?: string;
}

/** Per-character physical & emotional state tracked in conversation/roleplay chats. */
export interface ConvoCharacterStatus {
  /** Body temperature description (e.g. "warm", "feverish", "flushed"). */
  temperature?: string;
  /** Dominant felt emotion right now (e.g. "jealous", "giddy"). */
  emotion?: string;
  /**
   * Why they feel that way — one short clause (e.g. "saw you texting Mia").
   * A cause makes the emotion actionable for the model instead of decorative.
   */
  emotionCause?: string;
  /** Optional freeform bodily notes (shaking, tipsy, on period…). */
  notes?: string;
  /** Named percentage meters (0–100), e.g. happiness, hunger, arousal. */
  bars?: Record<string, number>;
  /** Labels and guidance per bar id (merged with `bars` keys). */
  barMeta?: Record<string, ConvoBarMeta>;
  /**
   * Per-body-part state: sensation, position, objects inside, or items held
   * (e.g. "sore, holding a beer can").
   */
  limbs?: Record<string, string>;
  /** Additional scalar fields the model may invent. */
  extras?: Record<string, string>;
}

/** Chat metadata map: characterId → status snapshot. */
export type ConvoCharacterStatusMap = Record<string, ConvoCharacterStatus>;

/**
 * Canonical semantics for the default bars. Single source of truth used by
 * BOTH the server prompt builder and the client editor tooltips, so the model
 * and the user always read the same definition (notably: `horny` is appetite,
 * `arousal` is physical closeness to climax).
 */
export interface ConvoStatusBarSpec {
  key: string;
  label: string;
  /** What the meter measures. */
  description: string;
  /** How it moves over time — injected so the model updates it believably. */
  dynamics: string;
}

export const CONVO_STATUS_BAR_SPECS = [
  {
    key: "happiness",
    label: "Happiness",
    description: "Overall contentment and positive mood right now.",
    dynamics: "Moves with emotional beats; drifts, rarely jumps more than ~20 points in one turn.",
  },
  {
    key: "hunger",
    label: "Hunger",
    description: "Need for food. 0 = completely full, 100 = starving.",
    dynamics: "Climbs slowly as hours pass; drops sharply after eating.",
  },
  {
    key: "horny",
    label: "Horny",
    description:
      "Sexual desire — how much they WANT intimacy right now. This is appetite, not physical build-up.",
    dynamics:
      "Builds with attraction, flirting, teasing, or denial; eases only partly after release. Slow-moving.",
  },
  {
    key: "arousal",
    label: "Arousal",
    description:
      "Physical build-up — how close their body is to orgasm RIGHT NOW. 0 = unaroused, 100 = on the edge / climaxing.",
    dynamics:
      "Fast-moving: rises quickly under direct stimulation, sinks during pauses, and resets to ~0 right after orgasm (horny may stay high).",
  },
  {
    key: "energy",
    label: "Energy",
    description: "Physical stamina. 0 = collapsing-exhausted, 100 = rested and wired.",
    dynamics: "Drains with exertion, late hours, and orgasms; recovers with rest, food, and sleep.",
  },
  {
    key: "stress",
    label: "Stress",
    description: "Tension, anxiety, or overwhelm.",
    dynamics: "Spikes with conflict, pressure, or embarrassment; eases with comfort, resolution, and release.",
  },
] as const satisfies readonly ConvoStatusBarSpec[];

export type ConvoStatusBarKey = (typeof CONVO_STATUS_BAR_SPECS)[number]["key"];

/** Default percentage bar keys suggested in prompts, in canonical order. */
export const DEFAULT_CONVO_STATUS_BARS: readonly string[] = CONVO_STATUS_BAR_SPECS.map((spec) => spec.key);

/** Default limb keys suggested in prompts and the status editor. */
export const DEFAULT_CONVO_STATUS_LIMBS = [
  "head",
  "neck",
  "torso",
  "leftArm",
  "rightArm",
  "leftHand",
  "rightHand",
  "leftLeg",
  "rightLeg",
  "groin",
] as const;

export function isDefaultConvoBarKey(key: string): boolean {
  return DEFAULT_CONVO_STATUS_BARS.includes(key);
}

export function isDefaultConvoLimbKey(key: string): boolean {
  return (DEFAULT_CONVO_STATUS_LIMBS as readonly string[]).includes(key);
}
