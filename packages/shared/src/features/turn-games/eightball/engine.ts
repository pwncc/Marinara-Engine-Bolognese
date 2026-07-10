// ──────────────────────────────────────────────
// 8-Ball Pool — deterministic engine (server-authoritative)
// ──────────────────────────────────────────────
// HYBRID model: real 2D ball positions on a real table (geometry.ts). Every
// turn the engine computes a finite, difficulty-scored candidate shot menu
// from those positions; the LLM bot only PICKS a shot in character — it never
// aims. Resolution (pot / miss / scratch / break scatter) is seeded-RNG vs.
// the chosen candidate's difficulty, via `deterministicRng(seed, shotCounter)`
// — the same per-shot-cursor pattern poker uses for its deck (rng.ts).
//
// DOCUMENTED SIMPLIFICATIONS (bar-rules, not tournament rules — see the design
// spec for the full list):
//  - Fouls = cue scratch only. No rail-after-contact fouls.
//  - A shot can only pocket its OWN target ball — misses never pocket an
//    unintended ball, so a shot's outcome is always exactly "target potted"
//    or "target not potted", never a surprise multi-ball result.
//  - The 8 is never a legal target until the shooter's group is fully
//    cleared, so "early 8" fouls/losses can't occur — the only modeled 8-loss
//    is scratching on the shot that legally pots the 8.
//  - Break scratch gives ball-in-hand ANYWHERE (not "behind the head string").
//  - The 8 never drops on the break in this model.
//
// ACCOUNTING INVARIANT (read before touching resolution code): every object
// ball (1-15) is in EXACTLY ONE of `state.balls` (on table) or `state.pocketed`
// (fell in a pocket) at all times. The cue is in EXACTLY ONE of `state.cuePos`
// (non-null, on table) or `state.ballInHandFor` (non-null, awaiting the next
// shot's virtual placement) — never both, never neither. This is what "all 16
// balls accounted for" means in the test suite, and every resolution path
// below must preserve it.

import type { GameEvent, ModelTurnView, MoveResult, Seat, TerminalResult, TurnGameEngine } from "../engine.types.js";
import {
  add,
  ballLabel,
  clampToBounds,
  distance,
  generateCandidates,
  ghostBallPoint,
  pocketLabel,
  pointScratches,
  resolveOverlaps,
  scale,
  segmentScratches,
  standardRackPositions,
  sub,
  unit,
  zoneName,
} from "./geometry.js";
import { deterministicRng } from "./rng.js";
import { EIGHTBALL_TOOL_MANIFESTS, parseEightBallToolCall } from "./tools.js";
import {
  AGGRESSIVE_SUCCESS_PENALTY,
  BALL_R,
  BREAK_NOMINAL_SUCCESS_PCT,
  CONTROLLED_SUCCESS_BONUS,
  CUE_ID,
  DEFAULT_EIGHTBALL_CONFIG,
  EIGHTBALL_LOG_CAP,
  EIGHTBALL_MAX_PLAYERS,
  EIGHTBALL_MIN_PLAYERS,
  EIGHT_ID,
  FOOT_SPOT,
  KITCHEN_SPOT,
  POCKETS,
  POCKET_IDS,
  SOLID_IDS,
  STRIPE_IDS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  clampEightBallConfig,
  eightBallConfigSchema,
  type BallGroup,
  type BallPos,
  type EightBallConfig,
  type EightBallMove,
  type EightBallPublicBall,
  type EightBallPublicCandidate,
  type EightBallPublicSeat,
  type EightBallPublicView,
  type EightBallState,
  type PocketId,
  type Point,
  type ShotCandidate,
  type ShotStyle,
  type ShotTier,
} from "./types.js";

// ── small helpers ───────────────────────────────────────────────────────────

function clone(state: EightBallState): EightBallState {
  return JSON.parse(JSON.stringify(state)) as EightBallState;
}

function nameOf(state: EightBallState, seatId: string): string {
  return state.seatNames[seatId] ?? seatId;
}

/** The only other seat — 8-ball is strictly 2-player. */
function otherSeat(state: EightBallState, seatId: string): string {
  return state.seatOrder.find((id) => id !== seatId) ?? seatId;
}

function fail(error: string, legalMoves: EightBallMove[] = []): MoveResult<EightBallState, EightBallMove> {
  return { ok: false, error, legalMoves };
}

/** Append `event` to both the returned move-events list and the capped board log. */
function record(state: EightBallState, events: GameEvent[], event: GameEvent): void {
  events.push(event);
  state.log.push(event);
  if (state.log.length > EIGHTBALL_LOG_CAP) state.log.splice(0, state.log.length - EIGHTBALL_LOG_CAP);
}

/** Like `record`, but also queues the event for the announcer. Used ONLY for the
 * milestone categories: break, group assignment, foul, on-the-8, great shot, rack over, game over. */
function announce(state: EightBallState, events: GameEvent[], event: GameEvent): void {
  record(state, events, event);
  state.pendingAnnouncements.push(event);
}

function setLast(state: EightBallState, seatId: string, summary: string): void {
  state.lastAction = { seatId, summary };
}

function clampPct(n: number): number {
  return Math.min(99, Math.max(1, n));
}

// ── group / ball-count helpers ───────────────────────────────────────────────

function remainingIdsForGroup(state: EightBallState, group: BallGroup): number[] {
  const ids = group === "solids" ? SOLID_IDS : STRIPE_IDS;
  return state.balls.filter((b) => ids.includes(b.id)).map((b) => b.id).sort((a, b) => a - b);
}

/** The shooter's legal target set right now (empty during break — that's a single
 * fixed candidate, not a ball-target menu). Table-open rule and group-cleared ->
 * 8-only rule live here, matching the design spec exactly. */
function legalTargetIdsFor(state: EightBallState, seatId: string): number[] {
  if (state.phase === "break") return [];
  const group = state.groups[seatId] ?? null;
  if (!group) {
    return state.balls.filter((b) => b.id !== EIGHT_ID).map((b) => b.id).sort((a, b) => a - b);
  }
  const remaining = remainingIdsForGroup(state, group);
  if (remaining.length > 0) return remaining;
  return state.balls.some((b) => b.id === EIGHT_ID) ? [EIGHT_ID] : [];
}

const BREAK_CANDIDATE: ShotCandidate = {
  id: "break",
  kind: "break",
  tier: "medium",
  successPct: BREAK_NOMINAL_SUCCESS_PCT,
  desc: "Break the rack open.",
};

/** The current shot menu for `seatId`, or [] if it isn't their turn. Pure
 * function of state — regenerated fresh on every call rather than cached, so
 * it can never drift from the live ball positions. */
function buildCandidateMenu(state: EightBallState, seatId: string): ShotCandidate[] {
  if (state.status !== "active" || state.currentSeatId !== seatId) return [];
  if (state.phase === "break") return [BREAK_CANDIDATE];
  const legalTargets = legalTargetIdsFor(state, seatId);
  return generateCandidates({ cuePos: state.cuePos, balls: state.balls, legalTargets });
}

function legalMovesFor(state: EightBallState, seatId: string): EightBallMove[] {
  if (state.status === "rack_over") {
    return state.currentSeatId === seatId ? [{ type: "next_rack" }] : [];
  }
  const candidates = buildCandidateMenu(state, seatId);
  const moves: EightBallMove[] = [];
  for (const c of candidates) {
    moves.push({ type: "shoot", shotId: c.id, style: "controlled" });
    moves.push({ type: "shoot", shotId: c.id, style: "aggressive" });
  }
  return moves;
}

// ── cue placement / physics-lite helpers ────────────────────────────────────

/** One-rail reflection + clamp — the simplified "cue went long" recovery from the spec. */
function reflectOnce(p: Point): Point {
  let x = p.x;
  let y = p.y;
  if (x < BALL_R) x = 2 * BALL_R - x;
  else if (x > TABLE_WIDTH - BALL_R) x = 2 * (TABLE_WIDTH - BALL_R) - x;
  if (y < BALL_R) y = 2 * BALL_R - y;
  else if (y > TABLE_HEIGHT - BALL_R) y = 2 * (TABLE_HEIGHT - BALL_R) - y;
  return clampToBounds({ x, y });
}

/** Nudges `proposedCuePos` (plus everything in `balls`) apart via the shared
 * overlap resolver, then splits the cue back out. Used by every resolution
 * path that places the cue (pot, miss, break, safety). */
function settleCuePosition(balls: BallPos[], proposedCuePos: Point): { cuePos: Point; balls: BallPos[] } {
  const combined = resolveOverlaps([{ id: CUE_ID, pos: clampToBounds(proposedCuePos) }, ...balls]);
  const cueEntry = combined.find((b) => b.id === CUE_ID)!;
  const rest = combined.filter((b) => b.id !== CUE_ID);
  return { cuePos: cueEntry.pos, balls: rest };
}

/** Push a point out of every pocket's capture radius. Used for every placement
 * that must never READ as "in the pocket" without actually being pocketed:
 * safety hide/gift spots (which never scratch in this simplified engine),
 * missed object balls (a real ball can't rest inside the pocket mouth — it
 * would fall in), and the post-break cue (its scratch was already decided by
 * the break's own roll, so it can't be left LOOKING sunk). */
function avoidPockets(p: Point): Point {
  for (const id of POCKET_IDS) {
    const pocket = POCKETS[id];
    const d = distance(p, pocket.pos);
    if (d < pocket.captureRadius + BALL_R) {
      const dir = unit(sub(p, pocket.pos));
      const safeDir = dir.x === 0 && dir.y === 0 ? { x: 1, y: 0 } : dir;
      return clampToBounds(add(pocket.pos, scale(safeDir, pocket.captureRadius + BALL_R + 0.5)));
    }
  }
  return p;
}

function nearestRailPoint(pos: Point): Point {
  const options: Point[] = [
    { x: pos.x, y: 0 },
    { x: pos.x, y: TABLE_HEIGHT },
    { x: 0, y: pos.y },
    { x: TABLE_WIDTH, y: pos.y },
  ];
  return options.reduce((best, cur) => (distance(cur, pos) < distance(best, pos) ? cur : best));
}

function nearestPocketId(pos: Point): PocketId {
  let best: PocketId = "NW";
  let bestDist = Infinity;
  for (const id of POCKET_IDS) {
    const d = distance(pos, POCKETS[id].pos);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/**
 * Cue travel direction off the ghost point: perpendicular-ish to the impact
 * line, side chosen by which way the cut bent (the sign of the cross product
 * between the cue's approach and the object ball's departure); near-straight
 * shots follow through roughly along the shot line instead, matching a real
 * stop/follow shot. `rng` adds a small seeded wobble either way.
 */
function tangentDirection(cuePos: Point, ghost: Point, ballPos: Point, pocketPos: Point, rng: () => number): Point {
  const travel = unit(sub(pocketPos, ballPos));
  const perp = { x: -travel.y, y: travel.x };
  const cueToGhost = unit(sub(ghost, cuePos));
  const cross = cueToGhost.x * travel.y - cueToGhost.y * travel.x;
  if (Math.abs(cross) < 0.05) {
    return unit(add(scale(travel, 0.8), scale(perp, (rng() - 0.5) * 0.4)));
  }
  const side = cross > 0 ? 1 : -1;
  return unit(add(scale(perp, side * 0.85), scale(travel, (rng() - 0.5) * 0.5)));
}

// ── group assignment / narration triggers ───────────────────────────────────

/** First potted ball on an OPEN table (non-break, both groups still null)
 * assigns the shooter that group and the opponent the other. No-op once
 * groups are set, and unreachable for the 8 (it's never a legal target while
 * the table is open — see `legalTargetIdsFor`). DELIBERATE bar-rules choice:
 * a pot that also scratches STILL assigns ("you got what you made" — the foul
 * costs the inning, not the group). Besides matching common bar play, this
 * guarantees the table can't stay open indefinitely, which is what keeps the
 * "candidate menu is never empty while a rack is active" invariant trivially
 * true (an open table with zero non-8 balls left is impossible). */
function maybeAssignGroups(s: EightBallState, events: GameEvent[], seatId: string, ballId: number): void {
  const bothOpen = s.seatOrder.every((id) => s.groups[id] === null);
  if (!bothOpen) return;
  const group: BallGroup = SOLID_IDS.includes(ballId) ? "solids" : "stripes";
  const opp = otherSeat(s, seatId);
  s.groups[seatId] = group;
  s.groups[opp] = group === "solids" ? "stripes" : "solids";
  announce(s, events, {
    type: "group_assignment",
    seatId,
    message: `${nameOf(s, seatId)} is ${group.toUpperCase()}, ${nameOf(s, opp)} is ${(group === "solids" ? "stripes" : "solids").toUpperCase()}.`,
  });
}

function maybeAnnounceGreatShot(s: EightBallState, events: GameEvent[], seatId: string, candidate: ShotCandidate): void {
  if (candidate.tier === "very_hard" || candidate.kind === "bank") {
    announce(s, events, {
      type: "great_shot",
      seatId,
      message: `${nameOf(s, seatId)} nails ${candidate.kind === "bank" ? "the bank" : "a brutal cut"} — incredible shot!`,
    });
  }
}

/** Fires exactly once — the shot that pots the shooter's LAST non-8 ball — since
 * every subsequent shot for that seat targets the 8 (a different resolution path). */
function maybeAnnounceOnTheEight(s: EightBallState, events: GameEvent[], seatId: string): void {
  const group = s.groups[seatId];
  if (group && remainingIdsForGroup(s, group).length === 0) {
    announce(s, events, { type: "on_the_8", seatId, message: `${nameOf(s, seatId)} is on the 8!` });
  }
}

// ── rack lifecycle ──────────────────────────────────────────────────────────

/** Awards the rack, checks the raceTo, and either ends the match or hands
 * pacing to the human for `next_rack` (poker `hand_over` pattern). */
function finishRack(s: EightBallState, events: GameEvent[], winnerSeatId: string, wasScratch: boolean): void {
  s.rackScore[winnerSeatId] = (s.rackScore[winnerSeatId] ?? 0) + 1;
  const loserSeatId = otherSeat(s, winnerSeatId);
  s.currentSeatId = null;

  const reachedRaceTo = (s.rackScore[winnerSeatId] ?? 0) >= s.config.raceTo;
  if (reachedRaceTo) {
    s.status = "finished";
    s.winnerSeatId = winnerSeatId;
    announce(s, events, {
      type: "game_over",
      seatId: winnerSeatId,
      message: `${nameOf(s, winnerSeatId)} wins the match ${s.rackScore[winnerSeatId]}-${s.rackScore[loserSeatId] ?? 0}!`,
    });
    return;
  }

  s.status = "rack_over";
  s.breakerSeatId = otherSeat(s, s.breakerSeatId); // alternate breaks every rack
  const humanSeatId = s.seats.find((x) => x.kind === "human")?.seatId ?? s.seatOrder[0]!;
  s.currentSeatId = humanSeatId;
  announce(s, events, {
    type: "rack_over",
    seatId: winnerSeatId,
    message:
      `${nameOf(s, winnerSeatId)} takes rack ${s.rackNumber}${wasScratch ? " — opponent scratched on the 8" : ""}. ` +
      `Score: ${s.rackScore[winnerSeatId]}-${s.rackScore[loserSeatId] ?? 0}.`,
  });
}

function startNewRack(s: EightBallState, events: GameEvent[]): void {
  s.rackNumber += 1;
  s.phase = "break";
  s.status = "active";
  s.balls = standardRackPositions(FOOT_SPOT);
  s.cuePos = { ...KITCHEN_SPOT };
  s.pocketed = {};
  for (const id of s.seatOrder) s.groups[id] = null;
  s.ballInHandFor = null;
  s.currentSeatId = s.breakerSeatId; // already toggled by finishRack for the upcoming rack
  announce(s, events, {
    type: "rack_started",
    seatId: s.breakerSeatId,
    message: `Rack ${s.rackNumber} — ${nameOf(s, s.breakerSeatId)} breaks.`,
  });
}

// ── resolution: break ────────────────────────────────────────────────────────

/** Clamp to the "foot half" of the table (x in [50, 100], per the design spec's
 * break scatter — the rack lives entirely on the foot side, so a break shouldn't
 * fling balls back across the head string into the kitchen). */
function clampToFootHalf(p: Point): Point {
  const clamped = clampToBounds(p);
  return { x: Math.max(TABLE_WIDTH / 2 + BALL_R, clamped.x), y: clamped.y };
}

function resolveBreak(s: EightBallState, seatId: string, style: ShotStyle, rng: () => number, events: GameEvent[]): void {
  const rack = standardRackPositions(FOOT_SPOT);
  const aggressive = style === "aggressive";
  // A real break sends balls flying across the whole foot half, not just a small
  // jitter from their rack slot — magnitudes here are tuned so the post-scatter
  // menu reliably includes clear direct pots (verified by the engine fuzz/scenario
  // tests), not just banks/safeties every time.
  const magMin = aggressive ? 6 : 4;
  const magRange = aggressive ? 24 : 16;
  const driftScale = aggressive ? 0.6 : 0.3;
  const center: Point = { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2 };

  let scattered: BallPos[] = rack.map((b) => {
    const angle = rng() * Math.PI * 2;
    const mag = magMin + rng() * magRange;
    const jitter = { x: Math.cos(angle) * mag, y: Math.sin(angle) * mag };
    const towardCenter = scale(unit(sub(center, b.pos)), driftScale);
    // avoidPockets AFTER the foot-half clamp: a surviving scattered ball must not
    // rest inside a pocket mouth (whether balls actually dropped is a separate,
    // dedicated roll below). Pockets reachable from the foot half all push back
    // toward the foot half, so the clamp is never undone.
    return { id: b.id, pos: avoidPockets(clampToFootHalf(add(add(b.pos, jitter), towardCenter))) };
  });
  scattered = resolveOverlaps(scattered);

  const dropRoll = rng();
  const p0 = aggressive ? 0.45 : 0.65; // P(0 balls drop)
  const p1 = aggressive ? 0.75 : 0.9; // P(<= 1 ball drops)
  const dropCount = dropRoll < p0 ? 0 : dropRoll < p1 ? 1 : 2;

  // The 8 never drops on the break in this model — see file header.
  const droppable = scattered.filter((b) => b.id !== EIGHT_ID).sort((a, b) => a.id - b.id);
  const droppedIds: number[] = [];
  for (let i = 0; i < dropCount && droppable.length > 0; i++) {
    const idx = Math.floor(rng() * droppable.length);
    const [chosen] = droppable.splice(idx, 1);
    droppedIds.push(chosen!.id);
  }
  for (const id of droppedIds) {
    const b = scattered.find((x) => x.id === id)!;
    s.pocketed[id] = nearestPocketId(b.pos);
  }
  s.balls = scattered.filter((b) => !droppedIds.includes(b.id));
  s.phase = "play";
  // Table stays OPEN after every break regardless of what dropped — break pots
  // never assign groups (spec, explicit).

  const scratchChance = aggressive ? 0.12 : 0.04;
  const scratched = rng() < scratchChance;
  const opp = otherSeat(s, seatId);

  if (scratched) {
    s.cuePos = null;
    s.ballInHandFor = opp;
    s.currentSeatId = opp;
  } else {
    const cueAngle = rng() * Math.PI * 2;
    const cueMag = 8 + rng() * 20;
    const proposedCue = avoidPockets(clampToBounds(add(KITCHEN_SPOT, { x: Math.cos(cueAngle) * cueMag, y: Math.sin(cueAngle) * cueMag })));
    const settled = settleCuePosition(s.balls, proposedCue);
    s.balls = settled.balls;
    s.cuePos = settled.cuePos;
    s.ballInHandFor = null;
    s.currentSeatId = droppedIds.length > 0 ? seatId : opp;
  }

  const dropText = droppedIds.length === 0 ? "nothing drops" : droppedIds.length === 1 ? "1 ball drops" : `${droppedIds.length} balls drop`;
  setLast(s, seatId, `breaks${scratched ? " and scratches" : ""}`);
  announce(s, events, {
    type: "break_result",
    seatId,
    message: `${nameOf(s, seatId)} breaks — ${dropText}${scratched ? ", but scratches" : ""}.`,
    data: { droppedIds, scratched },
  });
  if (scratched) {
    announce(s, events, { type: "foul", seatId, message: `${nameOf(s, seatId)} scratches on the break — ${nameOf(s, opp)} gets ball in hand.` });
  }
}

// ── resolution: pot / bank ───────────────────────────────────────────────────

// NOTE: banks resolve with DIRECT-pocket geometry (ghost point + tangent travel
// + miss slide all aim at the real pocket, not the rail-mirrored virtual one).
// Rules-wise a bank is just a very_hard pot — only the resulting ball placement
// is slightly idealized, a deliberate cosmetic simplification.
function resolvePotOrBank(s: EightBallState, seatId: string, candidate: ShotCandidate, style: ShotStyle, rng: () => number, events: GameEvent[]): void {
  const ballId = candidate.ballId!;
  const pocketId = candidate.pocketId!;
  const pocket = POCKETS[pocketId];
  const startCuePos = candidate.virtualCuePos ?? s.cuePos!;
  const ball = s.balls.find((b) => b.id === ballId)!;
  const ghost = ghostBallPoint(ball.pos, pocket.pos);

  const adjustedPct = clampPct(candidate.successPct + (style === "controlled" ? CONTROLLED_SUCCESS_BONUS : -AGGRESSIVE_SUCCESS_PENALTY));
  const potted = rng() * 100 < adjustedPct;

  if (potted) {
    const remainingBalls = s.balls.filter((b) => b.id !== ballId);
    s.pocketed[ballId] = pocketId;

    const travelDist = (style === "aggressive" ? 18 : 9) * (0.6 + rng() * 0.8);
    const dir = tangentDirection(startCuePos, ghost, ball.pos, pocket.pos, rng);
    const rawTravel = add(ghost, scale(dir, travelDist));
    // Check the PRE-reflection straight-line path for a pocket crossing before
    // bouncing it off a rail: reflectOnce's single-axis bounce can send a
    // corner-overshooting cue far from the corner it just passed through,
    // which would silently make corner scratches unreachable (see
    // `segmentScratches`'s doc for why the raw path is checked first).
    const inFlightScratch = segmentScratches(ghost, rawTravel);
    const proposed = reflectOnce(rawTravel);
    const settled = settleCuePosition(remainingBalls, proposed);
    s.balls = settled.balls;
    const scratched = inFlightScratch || pointScratches(settled.cuePos);

    if (ballId === EIGHT_ID) {
      s.cuePos = settled.cuePos;
      s.ballInHandFor = null;
      const winner = scratched ? otherSeat(s, seatId) : seatId;
      setLast(s, seatId, scratched ? "pots the 8 but scratches" : "pots the 8 clean");
      record(s, events, {
        type: scratched ? "foul" : "eight_ball_win",
        seatId,
        message: scratched
          ? `${nameOf(s, seatId)} scratches while potting the 8 — rack goes to ${nameOf(s, winner)}!`
          : `${nameOf(s, seatId)} pots the 8 clean — racks it up!`,
      });
      finishRack(s, events, winner, scratched);
      return;
    }

    maybeAssignGroups(s, events, seatId, ballId);
    setLast(s, seatId, `pots ${ballLabel(ballId)} into ${pocketLabel(pocketId)}${scratched ? ", but scratches" : ""}`);
    record(s, events, {
      type: scratched ? "foul" : "pot",
      seatId,
      message: `${nameOf(s, seatId)} pots ${ballLabel(ballId)}${scratched ? " but scratches — foul!" : "."}`,
      data: { ballId, pocketId },
    });

    if (scratched) {
      const opp = otherSeat(s, seatId);
      s.cuePos = null;
      s.ballInHandFor = opp;
      s.currentSeatId = opp;
      announce(s, events, { type: "foul", seatId, message: `${nameOf(s, seatId)} scratches — ${nameOf(s, opp)} gets ball in hand.` });
    } else {
      s.cuePos = settled.cuePos;
      s.ballInHandFor = null;
      maybeAnnounceGreatShot(s, events, seatId, candidate);
      maybeAnnounceOnTheEight(s, events, seatId);
      // currentSeatId unchanged — continue shooting on any clean pot.
    }
    return;
  }

  // MISS: the object ball slides partway toward the pocket and stops short; the
  // cue resolves via the same tangent logic with its own small scratch chance.
  const d2 = distance(ball.pos, pocket.pos);
  const frac = 0.55 + rng() * 0.35;
  const travel = unit(sub(pocket.pos, ball.pos));
  const perp = { x: -travel.y, y: travel.x };
  const missedPos = avoidPockets(clampToBounds(add(add(ball.pos, scale(travel, d2 * frac)), scale(perp, (rng() - 0.5) * 6))));
  const movedBalls = resolveOverlaps(s.balls.map((b) => (b.id === ballId ? { id: ballId, pos: missedPos } : b)));

  const dir = tangentDirection(startCuePos, ghost, ball.pos, pocket.pos, rng);
  const travelDist = (style === "aggressive" ? 14 : 7) * (0.6 + rng() * 0.8);
  const rawTravel = add(ghost, scale(dir, travelDist));
  const inFlightScratch = segmentScratches(ghost, rawTravel); // see the pot branch's note on why the raw path is checked
  const proposed = reflectOnce(rawTravel);
  const settled = settleCuePosition(movedBalls, proposed);
  s.balls = settled.balls;

  const missScratchChance = style === "aggressive" ? 0.08 : 0.03;
  const scratched = inFlightScratch || pointScratches(settled.cuePos) || rng() < missScratchChance;
  const opp = otherSeat(s, seatId);

  setLast(s, seatId, `misses ${ballLabel(ballId)}${scratched ? " and scratches" : ""}`);
  record(s, events, {
    type: scratched ? "foul" : "miss",
    seatId,
    message: `${nameOf(s, seatId)} misses ${ballLabel(ballId)}${scratched ? " and scratches — foul!" : "."}`,
  });

  if (scratched) {
    s.cuePos = null;
    s.ballInHandFor = opp;
    announce(s, events, { type: "foul", seatId, message: `${nameOf(s, seatId)} scratches — ${nameOf(s, opp)} gets ball in hand.` });
  } else {
    s.cuePos = settled.cuePos;
    s.ballInHandFor = null;
  }
  s.currentSeatId = opp;
}

// ── resolution: safety ───────────────────────────────────────────────────────

function resolveSafety(s: EightBallState, seatId: string, candidate: ShotCandidate, rng: () => number, events: GameEvent[]): void {
  const ballId = candidate.ballId!;
  const ball = s.balls.find((b) => b.id === ballId);
  const success = rng() * 100 < candidate.successPct;
  const opp = otherSeat(s, seatId);

  if (success && ball) {
    // Tuck the cue near whichever rail is closest to the target ball and nudge
    // that ball slightly rail-ward too — a deterministic "hide" heuristic.
    // Safety placements never scratch in this model (see file header).
    const railPoint = nearestRailPoint(ball.pos);
    const hideDir = unit(sub(railPoint, ball.pos));
    const hidePos = avoidPockets(clampToBounds(add(ball.pos, scale(hideDir, 2 * BALL_R + rng() * 3))));
    const nudgedBallPos = clampToBounds(add(ball.pos, scale(hideDir, rng() * 8)));
    const settled = settleCuePosition(
      s.balls.map((b) => (b.id === ballId ? { id: ballId, pos: nudgedBallPos } : b)),
      hidePos,
    );
    s.balls = settled.balls;
    s.cuePos = settled.cuePos;
  } else {
    // Fail: cue left open near the table center — opponent inherits a gift.
    // Real difficulty emerges from geometry on their next turn; no ad-hoc penalty flag.
    const jitter = { x: (rng() - 0.5) * 16, y: (rng() - 0.5) * 10 };
    const giftPos = avoidPockets(clampToBounds(add({ x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2 }, jitter)));
    const settled = settleCuePosition(s.balls, giftPos);
    s.balls = settled.balls;
    s.cuePos = settled.cuePos;
  }

  s.ballInHandFor = null;
  s.currentSeatId = opp; // safeties never pot — turn always passes
  setLast(s, seatId, success ? "plays a safety" : "attempts a safety and leaves it open");
  record(s, events, {
    type: success ? "safety" : "safety_fail",
    seatId,
    message: `${nameOf(s, seatId)} ${success ? "plays a nice safety, tucking the cue away" : "tries a safety but leaves the cue exposed"}.`,
  });
}

// ── prompt + summary builders ────────────────────────────────────────────────

function recentActionLines(state: EightBallState, max: number): string[] {
  return state.log
    .filter((e) => typeof e.message === "string" && e.message.trim().length > 0)
    .slice(-max)
    .map((e) => `  • ${e.message}`);
}

function buildBoardSummary(state: EightBallState, seatId: string): string {
  const opp = otherSeat(state, seatId);
  const lines: string[] = [
    `8-Ball Pool — rack #${state.rackNumber}, race to ${state.config.raceTo}. ` +
      `Score: ${nameOf(state, seatId)} ${state.rackScore[seatId] ?? 0} - ${state.rackScore[opp] ?? 0} ${nameOf(state, opp)}.`,
  ];

  if (state.phase === "break") {
    lines.push("It's the break — the rack is fresh, all 15 object balls on the table.");
  } else {
    const myGroup = state.groups[seatId];
    if (!myGroup) {
      lines.push("Table is OPEN — no groups assigned yet. Pot anything except the 8 to claim your group.");
    } else {
      const remaining = remainingIdsForGroup(state, myGroup);
      const oppGroup: BallGroup = myGroup === "solids" ? "stripes" : "solids";
      const oppRemaining = remainingIdsForGroup(state, oppGroup);
      if (remaining.length === 0) {
        lines.push(`You are ${myGroup.toUpperCase()} — cleared! You're shooting for the 8.`);
      } else {
        const zones = remaining.map((id) => `${ballLabel(id)} (${zoneName(state.balls.find((b) => b.id === id)!.pos)})`).join(", ");
        lines.push(`You are ${myGroup.toUpperCase()} — ${remaining.length} left: ${zones}.`);
      }
      lines.push(`${nameOf(state, opp)} is ${oppGroup.toUpperCase()} with ${oppRemaining.length} left.`);
    }
    if (state.ballInHandFor === seatId) lines.push("You have BALL IN HAND — your shot choice places it for you.");
  }

  const recent = recentActionLines(state, 5);
  if (recent.length) lines.push("What just happened:", ...recent);
  return lines.join("\n");
}

function buildInstructions(state: EightBallState, seatId: string, candidates: ShotCandidate[]): string {
  const header = state.ballInHandFor === seatId ? "Ball in hand — your shot menu (each choice places the cue for you):" : "Your shot menu:";
  const menuLines = candidates.map((c) => `  • ${c.id} [${c.tier}, ${c.successPct}% honest odds]: ${c.desc}`);
  return [
    header,
    ...menuLines,
    "",
    'Call eightball_action with `shotId` copied EXACTLY from the menu above (plus optional `style`: "controlled" or "aggressive").',
    "Pick like YOUR character, not like a pro solver. Daredevils attempt the showoff bank; cold tacticians play the " +
      "safety and leave them nothing; hotheads smash aggressive. successPct is honest — personality decides what's " +
      "worth the risk. Trash-talk is chat, not moves.",
  ].join("\n");
}

function buildSpectatorSummary(state: EightBallState): string {
  const [a, b] = state.seatOrder as [string, string];
  if (state.status === "finished") {
    const winner = state.winnerSeatId;
    const loser = winner ? otherSeat(state, winner) : null;
    return winner && loser
      ? `The 8-ball match just finished — ${nameOf(state, winner)} won it ${state.rackScore[winner]}-${state.rackScore[loser] ?? 0}.`
      : "The 8-ball match just finished.";
  }
  const lines: string[] = [
    `A game of 8-ball pool is in progress — rack #${state.rackNumber}, race to ${state.config.raceTo}. ` +
      `Score: ${nameOf(state, a)} ${state.rackScore[a] ?? 0} - ${state.rackScore[b] ?? 0} ${nameOf(state, b)}.`,
  ];
  if (state.phase === "break") {
    lines.push("The table is freshly racked, about to break.");
  } else {
    for (const id of state.seatOrder) {
      const group = state.groups[id];
      lines.push(group ? `${nameOf(state, id)} is ${group}.` : `${nameOf(state, id)}'s group is not yet decided.`);
    }
  }
  if (state.status === "rack_over") lines.push("The rack just ended — waiting on the next rack.");
  else if (state.currentSeatId) lines.push(`It's currently ${nameOf(state, state.currentSeatId)}'s shot.`);
  const recent = recentActionLines(state, 6);
  if (recent.length) lines.push("Recent action:", ...recent);
  return lines.join("\n");
}

function buildParticipantSummary(state: EightBallState, seatId: string): string {
  const base = buildSpectatorSummary(state);
  if (!state.seatOrder.includes(seatId)) return base;
  const lines: string[] = [base, `You are ${nameOf(state, seatId)} in this game.`];
  if (state.status !== "finished") {
    const group = state.groups[seatId];
    if (group) lines.push(`Your group: ${group}, ${remainingIdsForGroup(state, group).length} left.`);
    if (state.currentSeatId === seatId) {
      lines.push(state.status === "rack_over" ? "It's your turn to start the next rack." : "It's YOUR shot.");
    }
  }
  return lines.join("\n");
}

// ── deterministic fallback ──────────────────────────────────────────────────

const TIER_ORDER: Readonly<Record<ShotTier, number>> = { easy: 0, medium: 1, hard: 2, very_hard: 3 };

function pickFallback(state: EightBallState, seatId: string): EightBallMove {
  if (state.status === "rack_over") return { type: "next_rack" };
  const candidates = buildCandidateMenu(state, seatId);
  if (candidates.length === 0) return { type: "next_rack" }; // unreachable while active + it's their turn; total fallback
  const nonSafety = candidates.filter((c) => c.kind !== "safety");
  const pool = nonSafety.length ? nonSafety : candidates;
  const best = [...pool].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.successPct - a.successPct || a.id.localeCompare(b.id))[0]!;
  return { type: "shoot", shotId: best.id, style: "controlled" };
}

// ── the engine object ────────────────────────────────────────────────────────

export const eightBallEngine: TurnGameEngine<EightBallState, EightBallMove, EightBallConfig, EightBallPublicView> = {
  gameType: "eightball",
  schemaVersion: 1,
  label: "8-Ball Pool",
  minPlayers: EIGHTBALL_MIN_PLAYERS,
  maxPlayers: EIGHTBALL_MAX_PLAYERS,
  hiddenInformation: false,

  defaultConfig() {
    return { ...DEFAULT_EIGHTBALL_CONFIG };
  },

  normalizeConfig(config) {
    const direct = eightBallConfigSchema.safeParse(config);
    const merged = direct.success
      ? direct.data
      : { ...DEFAULT_EIGHTBALL_CONFIG, ...(config && typeof config === "object" ? (config as object) : {}) };
    return clampEightBallConfig(merged as Partial<EightBallConfig>);
  },

  setup(config, seatsIn: Seat[], seed) {
    const seatOrder = seatsIn.map((s) => s.seatId);
    const seatNames: Record<string, string> = {};
    for (const s of seatsIn) seatNames[s.seatId] = s.displayName;

    const humanSeat = seatsIn.find((s) => s.kind === "human") ?? seatsIn[0]!;
    const otherSeatObj = seatsIn.find((s) => s.seatId !== humanSeat.seatId) ?? seatsIn[seatsIn.length - 1]!;
    const breakerSeatId =
      config.humanBreaks === "you"
        ? humanSeat.seatId
        : config.humanBreaks === "opponent"
          ? otherSeatObj.seatId
          : Math.abs(seed) % 2 === 0
            ? humanSeat.seatId
            : otherSeatObj.seatId;

    const state: EightBallState = {
      config,
      seed,
      shotCounter: 0,
      seats: seatsIn.map((s) => ({ seatId: s.seatId, displayName: s.displayName, kind: s.kind })),
      seatOrder,
      seatNames,
      status: "active",
      phase: "break",
      balls: standardRackPositions(FOOT_SPOT),
      cuePos: { ...KITCHEN_SPOT },
      pocketed: {},
      groups: Object.fromEntries(seatOrder.map((id) => [id, null])),
      rackScore: Object.fromEntries(seatOrder.map((id) => [id, 0])),
      rackNumber: 1,
      breakerSeatId,
      currentSeatId: breakerSeatId,
      ballInHandFor: null,
      winnerSeatId: null,
      lastAction: null,
      pendingAnnouncements: [],
      log: [],
    };

    const events: GameEvent[] = [];
    announce(state, events, {
      type: "game_started",
      seatId: breakerSeatId,
      message: `Rack 1 — ${nameOf(state, breakerSeatId)} breaks. Race to ${config.raceTo}.`,
    });
    return state;
  },

  currentSeat(state) {
    return state.status === "finished" ? null : state.currentSeatId;
  },

  interruptibleSeats() {
    return [];
  },

  legalMoves(state, seatId) {
    return legalMovesFor(state, seatId);
  },

  applyMove(state, seatId, move): MoveResult<EightBallState, EightBallMove> {
    if (state.status === "finished") return fail("The match is already over.");

    if (move?.type === "next_rack") {
      if (state.status !== "rack_over" || state.currentSeatId !== seatId) {
        return { ok: false, error: "It's not time for the next rack yet.", legalMoves: legalMovesFor(state, seatId) };
      }
      const s = clone(state);
      s.shotCounter += 1; // keeps the rng cursor consistent across every applyMove, even non-random ones
      const events: GameEvent[] = [];
      startNewRack(s, events);
      return { ok: true, state: s, events };
    }

    if (state.status !== "active" || state.currentSeatId !== seatId) {
      return { ok: false, error: "It's not your turn.", legalMoves: legalMovesFor(state, seatId) };
    }
    if (!move || move.type !== "shoot") {
      return { ok: false, error: "Unknown move.", legalMoves: legalMovesFor(state, seatId) };
    }

    const candidates = buildCandidateMenu(state, seatId);
    const candidate = candidates.find((c) => c.id === move.shotId);
    if (!candidate) {
      return { ok: false, error: `Unknown or no-longer-legal shot "${move.shotId}".`, legalMoves: legalMovesFor(state, seatId) };
    }
    const style: ShotStyle = move.style === "aggressive" ? "aggressive" : "controlled";

    const s = clone(state);
    const events: GameEvent[] = [];
    const rng = deterministicRng(s.seed, s.shotCounter);
    s.shotCounter += 1;

    switch (candidate.kind) {
      case "break":
        resolveBreak(s, seatId, style, rng, events);
        break;
      case "pot":
      case "bank":
        resolvePotOrBank(s, seatId, candidate, style, rng, events);
        break;
      case "safety":
        resolveSafety(s, seatId, candidate, rng, events);
        break;
    }

    return { ok: true, state: s, events };
  },

  isTerminal(state): TerminalResult {
    return state.status === "finished"
      ? { done: true, ...(state.winnerSeatId ? { winnerSeatId: state.winnerSeatId } : {}) }
      : { done: false };
  },

  describeForModel(state, seatId): ModelTurnView<EightBallMove> {
    const candidates = buildCandidateMenu(state, seatId);
    return {
      boardSummary: buildBoardSummary(state, seatId),
      legalMoves: legalMovesFor(state, seatId),
      instructions: buildInstructions(state, seatId, candidates),
    };
  },

  spectatorSummary(state): string {
    return buildSpectatorSummary(state);
  },

  participantSummary(state, seatId): string {
    return buildParticipantSummary(state, seatId);
  },

  publicView(state, viewerSeatId): EightBallPublicView {
    const seats: EightBallPublicSeat[] = state.seatOrder.map((id) => {
      const seat = state.seats.find((x) => x.seatId === id)!;
      return {
        seatId: id,
        displayName: nameOf(state, id),
        kind: seat.kind,
        group: state.groups[id] ?? null,
        racksWon: state.rackScore[id] ?? 0,
        isCurrent: state.currentSeatId === id,
      };
    });

    const balls: EightBallPublicBall[] = [];
    for (const b of state.balls) balls.push({ id: b.id, x: b.pos.x, y: b.pos.y, pocketed: false });
    for (const key of Object.keys(state.pocketed)) {
      const id = Number(key);
      const pocketId = state.pocketed[id]!;
      const pos = POCKETS[pocketId].pos;
      balls.push({ id, x: pos.x, y: pos.y, pocketed: true });
    }
    if (state.cuePos) balls.push({ id: CUE_ID, x: state.cuePos.x, y: state.cuePos.y, pocketed: false });
    balls.sort((a, b) => a.id - b.id);

    const pocketedByGroup: Record<BallGroup, number> = { solids: 0, stripes: 0 };
    for (const key of Object.keys(state.pocketed)) {
      const id = Number(key);
      if (SOLID_IDS.includes(id)) pocketedByGroup.solids += 1;
      else if (STRIPE_IDS.includes(id)) pocketedByGroup.stripes += 1;
    }

    let yourShots: EightBallPublicCandidate[] | null = null;
    if (viewerSeatId && viewerSeatId === state.currentSeatId && state.status === "active") {
      yourShots = buildCandidateMenu(state, viewerSeatId).map(({ virtualCuePos: _virtualCuePos, ...rest }) => rest);
    }

    const onTheEightSeat = state.currentSeatId;
    const onTheEightGroup = onTheEightSeat ? state.groups[onTheEightSeat] : null;
    const onTheEight = !!onTheEightGroup && remainingIdsForGroup(state, onTheEightGroup).length === 0;

    return {
      gameType: "eightball",
      status: state.status,
      phase: state.phase,
      balls,
      pocketedByGroup,
      groups: { ...state.groups },
      seats,
      currentSeatId: state.currentSeatId,
      yourSeatId: viewerSeatId,
      ballInHandFor: state.ballInHandFor,
      onTheEight,
      raceTo: state.config.raceTo,
      rackNumber: state.rackNumber,
      winnerSeatId: state.winnerSeatId,
      lastAction: state.lastAction,
      yourShots,
      recentLog: state.log.slice(-8),
      hasPendingAnnouncements: state.pendingAnnouncements.length > 0,
      config: state.config,
    };
  },

  pickFallbackMove(state, seatId) {
    return pickFallback(state, seatId);
  },

  toolManifests() {
    return [...EIGHTBALL_TOOL_MANIFESTS];
  },

  parseToolCall(name, args) {
    return parseEightBallToolCall(name, args);
  },

  announcerCharacterId(state) {
    return state.config.announcerCharacterId;
  },

  drainAnnouncements(state) {
    if (state.pendingAnnouncements.length === 0) return null;
    const s = clone(state);
    const announcements = s.pendingAnnouncements;
    s.pendingAnnouncements = [];
    return { state: s, announcements };
  },
};
