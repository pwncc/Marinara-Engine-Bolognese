// ──────────────────────────────────────────────
// 8-Ball Pool — State, Moves, Config, Table Constants
// ──────────────────────────────────────────────
// HYBRID model: real 2D ball positions on a real table. Each turn the ENGINE
// geometrically computes a finite candidate-shot menu (see geometry.ts); the
// LLM bot only PICKS a shot in character (personality surface = shot choice,
// not aim). Resolution is seeded-RNG vs. the candidate's difficulty. See
// packages/shared/src/features/turn-games/poker for the sibling this mirrors
// (seeded rng keyed on a counter, pendingAnnouncements queue, flat tool).

import { z } from "zod";
import type { GameEvent } from "../engine.types.js";

// ── Table geometry constants ────────────────────────────────────────────────
// A real 9-ft table expressed in inches: 100×50 playfield, origin top-left,
// ball radius 1.125 (a 2.25" ball). Every geometry/engine function measures
// distances in these units.

export const TABLE_WIDTH = 100;
export const TABLE_HEIGHT = 50;
export const BALL_R = 1.125;
/** Floating-point slack for vector-degeneracy checks (near-zero-length vectors,
 * near-parallel segments) — kept tight since it only guards division-by-zero. */
export const EPS = 1e-6;
/**
 * Slack for "touching" vs. "overlapping" ball positions. `resolveOverlaps`'s
 * pairwise relaxation converges asymptotically (not exactly) when 3+ balls are
 * mutually close — as on a fresh rack or right after a break scatter — so a
 * residual sub-thousandth-inch overlap after the fixed pass count is expected
 * numerical noise, not a real interpenetration. Two orders of magnitude looser
 * than EPS on purpose; this constant is ONLY for ball-vs-ball distance checks.
 */
export const OVERLAP_EPS = 1e-3;

export type PocketId = "NW" | "N" | "NE" | "SW" | "S" | "SE";
export const POCKET_IDS: readonly PocketId[] = ["NW", "N", "NE", "SW", "S", "SE"];

export interface Point {
  x: number;
  y: number;
}

export interface PocketDef {
  id: PocketId;
  pos: Point;
  /** Used ONLY for cue-scratch placement checks — pockets are aim points in
   * this hybrid model, not simulated jaws the ball physically falls into. */
  captureRadius: number;
}

export const POCKETS: Readonly<Record<PocketId, PocketDef>> = {
  NW: { id: "NW", pos: { x: 0, y: 0 }, captureRadius: 2.2 },
  N: { id: "N", pos: { x: 50, y: 0 }, captureRadius: 2.0 },
  NE: { id: "NE", pos: { x: 100, y: 0 }, captureRadius: 2.2 },
  SW: { id: "SW", pos: { x: 0, y: 50 }, captureRadius: 2.2 },
  S: { id: "S", pos: { x: 50, y: 50 }, captureRadius: 2.0 },
  SE: { id: "SE", pos: { x: 100, y: 50 }, captureRadius: 2.2 },
};

/** Apex-ball spot for every fresh rack (break is a MOVE — see engine.ts). */
export const FOOT_SPOT: Point = { x: 75, y: 25 };
/** Cue's resting spot at the start of every rack (behind the head string). */
export const KITCHEN_SPOT: Point = { x: 25, y: 25 };

// ── Ball identity ────────────────────────────────────────────────────────────

export const CUE_ID = 0;
export const EIGHT_ID = 8;
export const SOLID_IDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const STRIPE_IDS: readonly number[] = [9, 10, 11, 12, 13, 14, 15];
export const ALL_OBJECT_IDS: readonly number[] = [...SOLID_IDS, EIGHT_ID, ...STRIPE_IDS];

export type BallGroup = "solids" | "stripes";

export interface BallPos {
  id: number;
  pos: Point;
}

// ── Candidate shot menu (produced by geometry.ts, consumed by engine + client) ─

export type ShotTier = "easy" | "medium" | "hard" | "very_hard";
export type ShotKind = "pot" | "bank" | "safety" | "break";

export interface ShotCandidate {
  /** Deterministic: "pot-<ballId>-<pocketId>" | "bank-<ballId>-<pocketId>" | "safety-<ballId>" | "break". */
  id: string;
  kind: ShotKind;
  ballId?: number;
  pocketId?: PocketId;
  tier: ShotTier;
  successPct: number;
  /** Plain-English tactical color, generated from a deterministic phrase table. */
  desc: string;
  /**
   * Set ONLY for candidates generated while the shooter has ball-in-hand: the
   * optimal virtual cue placement this specific candidate assumes. Applied to
   * `state.cuePos` at resolution time if this candidate is the one chosen.
   * Internal to the engine — stripped from the client-facing public view.
   */
  virtualCuePos?: Point;
}

/** Base success chance per tier before style/hand modifiers — spec-fixed values. */
export const BASE_SUCCESS_PCT: Readonly<Record<ShotTier, number>> = {
  easy: 82,
  medium: 62,
  hard: 42,
  very_hard: 24,
};

export const BANK_SUCCESS_PCT = 18;
export const SAFETY_SUCCESS_PCT = 90;
export const BREAK_NOMINAL_SUCCESS_PCT = 35;

export const MAX_CUT_ANGLE_DEG = 80;
/** A ball this close to a pocket is a "hanger" — biases the difficulty score easier. */
export const HANGER_DISTANCE = 6;
export const HANGER_SCORE_BIAS = 0.15;
/** Obstruction test threshold: another ball's center within this distance of the
 * travel segment blocks the shot (2r would be "just touching", 0.9 leaves margin). */
export const OBSTRUCTION_FACTOR = 0.9;

export const MAX_POT_BANK_CANDIDATES = 12;
/** Banks are spice, not a strategy menu — never more than this many per menu. */
export const MAX_BANK_CANDIDATES = 2;
export const MAX_SAFETY_CANDIDATES = 3;

/** Shot-style resolution modifiers (spec: controlled = safer/shorter, aggressive =
 * riskier/longer with better position but higher scratch odds). */
export const CONTROLLED_SUCCESS_BONUS = 5;
export const AGGRESSIVE_SUCCESS_PENALTY = 8;

// ── Config ───────────────────────────────────────────────────────────────────

export interface EightBallConfig {
  /** First to this many rack wins takes the match. */
  raceTo: 1 | 3 | 5;
  /** Who breaks the FIRST rack. "random" resolves deterministically from the setup
   * seed (mirrors chess's `humanColor: "random"` pattern). Later racks alternate. */
  humanBreaks: "you" | "opponent" | "random";
  /** Character that voices break/foul/win narration — narration only, never affects
   * rules. `null` = silent. See `eightballEngine.announcerCharacterId`. */
  announcerCharacterId: string | null;
}

export const eightBallConfigSchema = z.object({
  raceTo: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  humanBreaks: z.enum(["you", "opponent", "random"]),
  announcerCharacterId: z.string().nullable(),
});

export const DEFAULT_EIGHTBALL_CONFIG: EightBallConfig = {
  raceTo: 1,
  humanBreaks: "random",
  announcerCharacterId: null,
};

/** Clamp an untrusted config into house-rule bounds. */
export function clampEightBallConfig(raw: Partial<EightBallConfig> | Record<string, unknown> | null | undefined): EightBallConfig {
  const r = (raw ?? {}) as Partial<EightBallConfig>;
  const raceTo = r.raceTo === 3 || r.raceTo === 5 ? r.raceTo : 1;
  const humanBreaks = r.humanBreaks === "you" || r.humanBreaks === "opponent" || r.humanBreaks === "random" ? r.humanBreaks : "random";
  const announcerCharacterId = typeof r.announcerCharacterId === "string" && r.announcerCharacterId.trim() ? r.announcerCharacterId : null;
  return { raceTo, humanBreaks, announcerCharacterId };
}

export const EIGHTBALL_MIN_PLAYERS = 2;
export const EIGHTBALL_MAX_PLAYERS = 2;
export const EIGHTBALL_LOG_CAP = 30;

// ── Moves ────────────────────────────────────────────────────────────────────

export type ShotStyle = "controlled" | "aggressive";

export type EightBallMove =
  /** Covers break AND every in-rack shot — `shotId` selects the candidate (see
   * `ShotCandidate.id`). Style defaults to "controlled" (see engine.ts). */
  | { type: "shoot"; shotId: string; style?: ShotStyle }
  /** Human-only pacing move: legal only in `rack_over`, only for `currentSeat`. */
  | { type: "next_rack" };

export const eightBallMoveSchema: z.ZodType<EightBallMove> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shoot"), shotId: z.string(), style: z.enum(["controlled", "aggressive"]).optional() }),
  z.object({ type: z.literal("next_rack") }),
]);

// ── State ────────────────────────────────────────────────────────────────────

export type EightBallStatus = "active" | "rack_over" | "finished";
export type EightBallPhase = "break" | "play";

export interface EightBallState {
  config: EightBallConfig;
  /** Seeded RNG root. Each shot's outcome is `deterministicRng(seed, shotCounter)`
   * — reproducible and rewind-safe without persisting any resolution rolls. */
  seed: number;
  /** Increments on every applyMove — the per-shot rng cursor (poker deck-cursor pattern). */
  shotCounter: number;
  seats: Array<{ seatId: string; displayName: string; kind: "human" | "bot" }>;
  seatOrder: string[];
  seatNames: Record<string, string>;
  status: EightBallStatus;
  phase: EightBallPhase;
  /** On-table OBJECT balls only (ids 1-15). The cue is tracked separately via
   * `cuePos` because ball-in-hand needs a "not currently anywhere" state that a
   * plain BallPos can't represent. */
  balls: BallPos[];
  /** Null while a ball-in-hand placement is pending (i.e. `ballInHandFor` is set). */
  cuePos: Point | null;
  /** ballId -> the pocket it dropped into. Never contains the cue (0) — a scratch
   * is represented by `cuePos: null` + `ballInHandFor`, not a "pocketed" cue. */
  pocketed: Partial<Record<number, PocketId>>;
  /** seatId -> assigned group. Both null = table open. */
  groups: Record<string, BallGroup | null>;
  /** seatId -> racks won this match. */
  rackScore: Record<string, number>;
  rackNumber: number;
  /** Who breaks the CURRENT (or, during rack_over, the NEXT) rack. Alternates every rack. */
  breakerSeatId: string;
  currentSeatId: string | null;
  /** seatId who must place the cue via their next shot's virtual placement, or null. */
  ballInHandFor: string | null;
  winnerSeatId: string | null;
  lastAction: { seatId: string; summary: string } | null;
  /** Queued narration events, drained by `drainAnnouncements`. */
  pendingAnnouncements: GameEvent[];
  /** Capped ring buffer of recent events (newest last) for the board log. */
  log: GameEvent[];
}

// ── Public (per-viewer) view rendered by the client board ───────────────────

export interface EightBallPublicSeat {
  seatId: string;
  displayName: string;
  kind: "human" | "bot";
  group: BallGroup | null;
  racksWon: number;
  isCurrent: boolean;
}

export interface EightBallPublicBall {
  id: number;
  x: number;
  y: number;
  pocketed: boolean;
}

/** Client/model-facing candidate — identical to `ShotCandidate` minus the
 * internal-only virtual cue placement (that's an engine resolution detail). */
export type EightBallPublicCandidate = Omit<ShotCandidate, "virtualCuePos">;

export interface EightBallPublicView {
  gameType: "eightball";
  status: EightBallStatus;
  phase: EightBallPhase;
  /** All 16 balls, cue included when it's on the table (omitted while ball-in-hand). */
  balls: EightBallPublicBall[];
  pocketedByGroup: Record<BallGroup, number>;
  groups: Record<string, BallGroup | null>;
  seats: EightBallPublicSeat[];
  currentSeatId: string | null;
  yourSeatId: string | null;
  ballInHandFor: string | null;
  /** Whether `currentSeatId`'s group is fully cleared, so the 8 is their legal target. */
  onTheEight: boolean;
  raceTo: number;
  rackNumber: number;
  winnerSeatId: string | null;
  lastAction: { seatId: string; summary: string } | null;
  /** The current shot menu, populated ONLY when the viewer is the current seat
   * (chess `legalMovesForYou` pattern). */
  yourShots: EightBallPublicCandidate[] | null;
  recentLog: GameEvent[];
  hasPendingAnnouncements: boolean;
  config: EightBallConfig;
}
