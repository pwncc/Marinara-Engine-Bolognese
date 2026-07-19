// ──────────────────────────────────────────────
// Living World engine — the simulator behind character life
// ──────────────────────────────────────────────
// Two halves, so the world feels continuous instead of bursty:
//
//  1. DIRECTOR (LLM, infrequent): snapshots the world — roster + presence,
//     relationships, recent events, noodle activity, open plans — and plans
//     the next stretch of time as a TIMELINE: each action carries a time
//     offset ("Bob replies in 12 minutes", "their DM continues in 40").
//     Planned actions are queued, not executed.
//
//  2. DRIP (no LLM, every poll): executes queued actions when their moment
//     arrives. A post appears at 14:03, the reply at 14:11, a DM at 14:26 —
//     the world accretes in real time, with quiet stretches, like life.
//
// Executed actions become real rows (noodle posts, chat messages, character
// memories, relationship updates) plus append-only world_events, so every
// arc is observable after the fact.
import {
  DEFAULT_WORLD_ENGINE_CONFIG,
  PROVIDERS,
  getEffectiveCurrentStatus,
  getRelationshipStage,
  type CharacterExtensions,
  type WeekSchedule,
  type WorldEngineConfig,
  type WorldEngineState,
  type WorldEventRecord,
} from "@marinara-engine/shared";

import type { FastifyInstance } from "fastify";

import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { newId } from "../../utils/id-generator.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { getLocalSidecarProvider } from "../llm/local-sidecar.js";
import type { BaseLLMProvider, ChatMessage } from "../llm/base-provider.js";
import { createAppSettingsStorage } from "../storage/app-settings.storage.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatFoldersStorage } from "../storage/chat-folders.storage.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";
import { createWorldStorage, orderPair, type WorldStorage } from "../storage/world.storage.js";

const CONFIG_KEY = "worldEngine";
const STATE_KEY = "worldEngineState";
const LOCAL_SIDECAR_MODEL = "local-sidecar";
const MAX_DM_MESSAGES_PER_ACTION = 3;
const MAX_SNAPSHOT_EVENTS = 30;
const MAX_SNAPSHOT_POSTS = 15;
const MAX_OPEN_PLANS = 10;
/** Per drip cycle, execute at most this many due actions (safety valve). */
const MAX_EXECUTIONS_PER_DRAIN = 4;
/** Due actions older than this are stale (missed window) and get skipped. */
const STALE_ACTION_MS = 6 * 60 * 60_000;

// ── Config & state ──

function parseJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function normalizeWorldEngineConfig(raw: unknown): WorldEngineConfig {
  const data = parseJson(raw);
  const num = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === "string" ? Number.parseFloat(value) : (value as number);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };
  return {
    enabled: data.enabled === true,
    connectionId: typeof data.connectionId === "string" && data.connectionId.trim() ? data.connectionId.trim() : null,
    cadenceMinutes: Math.round(num(data.cadenceMinutes, DEFAULT_WORLD_ENGINE_CONFIG.cadenceMinutes, 5, 24 * 60)),
    maxActionsPerTick: Math.round(num(data.maxActionsPerTick, DEFAULT_WORLD_ENGINE_CONFIG.maxActionsPerTick, 1, 12)),
    dailyActionCap: Math.round(num(data.dailyActionCap, DEFAULT_WORLD_ENGINE_CONFIG.dailyActionCap, 0, 100_000)),
    allowNoodle: data.allowNoodle !== false,
    allowDms: data.allowDms !== false,
    allowMemories: data.allowMemories !== false,
    mode: data.mode === "director" ? "director" : "minds",
    wakeIntervalMinutes: Math.round(
      num(data.wakeIntervalMinutes, DEFAULT_WORLD_ENGINE_CONFIG.wakeIntervalMinutes, 1, 24 * 60),
    ),
    temperature: num(data.temperature, DEFAULT_WORLD_ENGINE_CONFIG.temperature, 0, 2),
    userDirective: typeof data.userDirective === "string" ? data.userDirective.slice(0, 2000) : "",
    weatherLocation: typeof data.weatherLocation === "string" ? data.weatherLocation.slice(0, 80) : "",
    memberCharacterIds: Array.isArray(data.memberCharacterIds)
      ? [...new Set(data.memberCharacterIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
      : null,
  };
}

/** True when the character lives in the world under this config. */
export function isWorldMember(config: WorldEngineConfig, characterId: string): boolean {
  return config.memberCharacterIds === null || config.memberCharacterIds.includes(characterId);
}

/** Remaining daily action budget (Infinity when the cap is off). */
export function dailyBudgetLeft(config: WorldEngineConfig, dailyCount: number): number {
  if (config.dailyActionCap <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, config.dailyActionCap - dailyCount);
}

const WORLD_FOLDER_NAME = "Living World";

/**
 * World chats (life spaces, DM/group threads) file into their own sidebar
 * folder instead of cluttering the user's personal conversation list.
 */
export async function ensureWorldChatFolder(db: DB, mode: "conversation" | "roleplay"): Promise<string | null> {
  try {
    const folders = createChatFoldersStorage(db);
    // Folders belong to a sidebar tab (mode), so DMs (conversation) and life
    // spaces/hangouts (roleplay) each need their own Living World folder or the
    // chat won't appear under its tab.
    const existing = (await folders.list()).find(
      (folder) => folder.name === WORLD_FOLDER_NAME && folder.mode === mode,
    );
    if (existing) return String(existing.id);
    const created = await folders.create({ name: WORLD_FOLDER_NAME, mode } as Parameters<typeof folders.create>[0]);
    return created ? String(created.id) : null;
  } catch (error) {
    logger.warn(error, "[world] Could not ensure the Living World chat folder");
    return null;
  }
}

/** File a world chat into the Living World folder matching its own mode. */
export async function fileWorldChat(db: DB, chatId: string): Promise<void> {
  const chats = createChatsStorage(db);
  const chat = await chats.getById(chatId);
  const mode = (chat as { mode?: string } | null)?.mode === "conversation" ? "conversation" : "roleplay";
  const folderId = await ensureWorldChatFolder(db, mode);
  if (!folderId) return;
  try {
    await chats.setFolderForChat(chatId, folderId);
  } catch (error) {
    logger.debug(error, "[world] Could not file chat %s into the world folder", chatId);
  }
}

export async function loadWorldEngineConfig(db: DB): Promise<WorldEngineConfig> {
  const appSettings = createAppSettingsStorage(db);
  return normalizeWorldEngineConfig(await appSettings.get(CONFIG_KEY));
}

export async function saveWorldEngineConfig(db: DB, config: WorldEngineConfig): Promise<WorldEngineConfig> {
  const appSettings = createAppSettingsStorage(db);
  const normalized = normalizeWorldEngineConfig(config);
  await appSettings.set(CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadWorldEngineState(db: DB): Promise<WorldEngineState> {
  const appSettings = createAppSettingsStorage(db);
  const data = parseJson(await appSettings.get(STATE_KEY));
  const state: WorldEngineState = {
    lastRunAt: typeof data.lastRunAt === "string" ? data.lastRunAt : null,
    dailyDate: typeof data.dailyDate === "string" ? data.dailyDate : todayKey(),
    dailyCount: Number.isFinite(data.dailyCount as number) ? (data.dailyCount as number) : 0,
    consecutiveFailures: Number.isFinite(data.consecutiveFailures as number)
      ? (data.consecutiveFailures as number)
      : 0,
    lastError: typeof data.lastError === "string" ? data.lastError : null,
    lastNarration: typeof data.lastNarration === "string" ? data.lastNarration : null,
  };
  if (state.dailyDate !== todayKey()) {
    state.dailyDate = todayKey();
    state.dailyCount = 0;
  }
  return state;
}

async function saveWorldEngineState(db: DB, state: WorldEngineState): Promise<void> {
  const appSettings = createAppSettingsStorage(db);
  await appSettings.set(STATE_KEY, JSON.stringify(state));
}

// Serialize the state read-modify-write. The store serializes each write, but
// not the read→mutate→write span, so two overlapping callers would both load
// the same dailyCount and the last save would drop one increment. A promise
// chain makes each patch atomic with respect to the others.
let statePatchChain: Promise<unknown> = Promise.resolve();

/** Read-modify-write, serialized so concurrent callers don't clobber counters. */
export async function saveWorldEngineStatePatch(
  db: DB,
  mutate: (state: WorldEngineState) => void,
): Promise<WorldEngineState> {
  const run = statePatchChain.then(async () => {
    const state = await loadWorldEngineState(db);
    mutate(state);
    await saveWorldEngineState(db, state);
    return state;
  });
  statePatchChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<WorldEngineState>;
}

// Serialize whole world cycles. The scheduler's own `running` flag stops it
// from overlapping itself, but a manual POST /world/tick bypasses that guard —
// so without this a manual "advance now" can wake the same mind (or drain the
// same queued action) concurrently with the scheduler: double posts, double
// spend, and racing tail upserts. Both entry points acquire this lock.
let worldCycleChain: Promise<unknown> = Promise.resolve();
export function runWorldCycleExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = worldCycleChain.then(fn, fn);
  worldCycleChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ── Provider resolution ──

export interface ResolvedWorldProvider {
  provider: BaseLLMProvider;
  model: string;
  label: string;
}

export async function resolveWorldProvider(
  db: DB,
  config: WorldEngineConfig,
): Promise<ResolvedWorldProvider | { error: string }> {
  if (!config.connectionId) {
    return { error: "No world connection configured. Pick an API connection or the local sidecar." };
  }
  if (config.connectionId === "local") {
    return { provider: getLocalSidecarProvider(), model: LOCAL_SIDECAR_MODEL, label: "Local sidecar" };
  }
  const connections = createConnectionsStorage(db);
  const conn = await connections.getWithKey(config.connectionId);
  if (!conn) return { error: `World connection ${config.connectionId} not found.` };
  let baseUrl = conn.baseUrl;
  if (!baseUrl) {
    const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    baseUrl = providerDef?.defaultBaseUrl ?? "";
  }
  if (!baseUrl) return { error: "World connection has no base URL." };
  return {
    provider: createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
      conn.claudeFastMode === "true",
      conn.treatAsLocalEndpoint === "true",
      conn.defaultParameters,
    ),
    model: conn.model,
    label: `${conn.provider} · ${conn.model}`,
  };
}

// ── World snapshot ──

export interface RosterEntry {
  id: string;
  name: string;
  persona: string;
  presence: string;
  activity: string;
  noodleHandle: string | null;
  noodleAccountId: string | null;
}

export interface WorldSnapshot {
  roster: RosterEntry[];
  relationships: string[];
  recentEvents: string[];
  recentPosts: Array<{ id: string; line: string }>;
  openPlans: Array<{ eventId: string; line: string }>;
}

function shortText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Name map restricted to world members — executor validation rides on `.has()`. */
export async function buildNameMap(db: DB, config: WorldEngineConfig): Promise<Map<string, string>> {
  const chars = createCharactersStorage(db);
  const rows = (await chars.list()) as Array<{ id: string; data: unknown }>;
  const nameById = new Map<string, string>();
  for (const row of rows) {
    if (!isWorldMember(config, row.id)) continue;
    const data = parseJson(row.data);
    nameById.set(row.id, shortText(data.name, 60) || "Unnamed");
  }
  return nameById;
}

export async function buildWorldSnapshot(
  db: DB,
  config: WorldEngineConfig,
): Promise<{ snapshot: WorldSnapshot; nameById: Map<string, string> }> {
  const chars = createCharactersStorage(db);
  const chats = createChatsStorage(db);
  const noodle = createNoodleStorage(db);
  const world = createWorldStorage(db);

  const characterRows = ((await chars.list()) as Array<{ id: string; data: unknown }>).filter((row) =>
    isWorldMember(config, row.id),
  );
  const nameById = new Map<string, string>();
  const personaById = new Map<string, string>();
  for (const row of characterRows) {
    const data = parseJson(row.data);
    const name = shortText(data.name, 60) || "Unnamed";
    nameById.set(row.id, name);
    personaById.set(
      row.id,
      shortText(data.personality, 160) || shortText(data.description, 160) || "(no persona notes)",
    );
  }

  // Presence: first schedule found for a character across conversation chats.
  const scheduleById = new Map<string, { schedule: WeekSchedule; override: unknown }>();
  const allChats = (await chats.list()) as Array<{ id: string; mode?: string | null; metadata?: unknown }>;
  for (const chat of allChats) {
    if (chat.mode !== "conversation") continue;
    const meta = parseJson(chat.metadata);
    const schedules = parseJson(meta.characterSchedules);
    const overrides = parseJson(meta.conversationStatusOverrides);
    for (const [charId, schedule] of Object.entries(schedules)) {
      if (!scheduleById.has(charId) && schedule && typeof schedule === "object") {
        scheduleById.set(charId, { schedule: schedule as WeekSchedule, override: overrides[charId] });
      }
    }
  }

  const accounts = await noodle.getAccountsByEntities(
    "character",
    characterRows.map((row) => row.id),
  );
  const accountByEntity = new Map(accounts.map((account) => [account.entityId, account]));

  const roster: RosterEntry[] = characterRows.map((row) => {
    const entry = scheduleById.get(row.id);
    let presence = "unknown";
    let activity = "";
    if (entry) {
      try {
        const status = getEffectiveCurrentStatus(
          entry.schedule,
          entry.override as Parameters<typeof getEffectiveCurrentStatus>[1],
          new Date(),
        );
        presence = status?.status ?? "unknown";
        activity = shortText(status?.activity, 60);
      } catch {
        /* schedules are user data — never let a malformed one kill a run */
      }
    }
    const account = accountByEntity.get(row.id);
    return {
      id: row.id,
      name: nameById.get(row.id) ?? "Unnamed",
      persona: personaById.get(row.id) ?? "",
      presence,
      activity,
      noodleHandle: account?.invited ? account.handle : null,
      noodleAccountId: account?.invited ? account.id : null,
    };
  });

  const relationships = (await world.listRelationships())
    .filter((rel) => isWorldMember(config, rel.aCharacterId) && isWorldMember(config, rel.bCharacterId))
    .slice(0, 60)
    .map((rel) => {
    const a = nameById.get(rel.aCharacterId) ?? rel.aCharacterId;
    const b = nameById.get(rel.bCharacterId) ?? rel.bCharacterId;
    const label = rel.label ?? rel.stage;
    const romance = rel.romance ? ", romantic" : "";
    return `${a} ↔ ${b}: ${label} (score ${rel.score}${romance})${rel.summary ? ` — ${rel.summary}` : ""}`;
  });

  const recentEvents = (await world.listEvents({ limit: MAX_SNAPSHOT_EVENTS }))
    .map((event) => `[${event.createdAt.slice(0, 16)}] ${event.summary}`)
    .reverse();

  const posts = await noodle.listPosts({ limit: MAX_SNAPSHOT_POSTS });
  const accountNameById = new Map(accounts.map((account) => [account.id, account.displayName]));
  const recentPosts = posts.map((post) => ({
    id: post.id,
    line: `${post.id} · ${accountNameById.get(post.authorAccountId) ?? "someone"}: ${shortText(post.content, 140)}`,
  }));

  const openPlans = (await world.listEvents({ kind: "plan", limit: 100 }))
    .filter((event) => event.detail.done !== true)
    .slice(0, MAX_OPEN_PLANS)
    .map((event) => ({
      eventId: event.id,
      line: `${event.id} · ${event.summary}${typeof event.detail.dueAt === "string" ? ` (due ${event.detail.dueAt.slice(0, 16)})` : ""}`,
    }));

  return { snapshot: { roster, relationships, recentEvents, recentPosts, openPlans }, nameById };
}

// ── Director prompt ──

function buildDirectorMessages(snapshot: WorldSnapshot, config: WorldEngineConfig, now: Date): ChatMessage[] {
  const windowMinutes = config.cadenceMinutes;
  const capabilities = [
    config.allowNoodle
      ? `- noodle_post {characterId, content, inMinutes} — public post on the Noodle timeline (only characters WITH a handle)\n- noodle_reply {characterId, postId, content, inMinutes} — public reply to a listed post\n- noodle_like {characterId, postId, inMinutes}\n- noodle_follow {characterId, targetCharacterId, inMinutes}`
      : null,
    config.allowDms
      ? `- dm {fromCharacterId, toCharacterId, messages: [{from: characterId, content}, …], inMinutes} — a private DM moment between two characters (1-${MAX_DM_MESSAGES_PER_ACTION} short messages). For a longer conversation, plan SEVERAL dm actions for the same pair at different times — replies take minutes or hours, like real texting.`
      : null,
    `- plan {characterIds, title, detail, dueInHours?, inMinutes} — record an intention (meetup, date, collab, confrontation…) to follow up on later\n- plan_done {planEventId, outcome, inMinutes} — resolve an open plan with what actually happened`,
    `- relationship {aCharacterId, bCharacterId, delta (-20..20), romance?, label?, summary, milestone?: {title, description}, inMinutes} — evolve how two characters stand; use milestones for firsts (first meeting, first fight, confession…)`,
    config.allowMemories
      ? `- memory {characterId, aboutCharacterId, summary, inMinutes} — something characterId will remember about the other`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    `You are the invisible life director behind a world of fictional characters. Their lives run continuously: they post publicly, message each other privately, make and keep plans, drift together or apart, fall in and out of love, hold grudges, and remember.`,
    ``,
    `You are planning the next ${windowMinutes} minutes as a TIMELINE. Every action carries "inMinutes" (0-${windowMinutes}, decimals fine): when that moment happens in real time.`,
    ``,
    `PACING RULES — this is what makes the world feel real:`,
    `- Spread moments across the window with natural gaps. NEVER stack everything at minute 0.`,
    `- Cluster only when it's genuinely reactive (a quick reply 2-8 minutes after a post; a text answered in 5-15).`,
    `- Quiet is realistic. If little should happen this window, plan only 1-2 small moments — or none.`,
    `- Conversations unfold across multiple dm actions with gaps, not one dump.`,
    `- Respect presence AND timing: offline/dnd characters rarely act; someone "at the gym" posts after, not during; a character whose schedule says they get home at 18:00 texts back then.`,
    ``,
    `WORLD RULES:`,
    `- CONTINUITY IS EVERYTHING. Build on recent events, open plans, and relationship summaries. Never reset or contradict them.`,
    `- Move arcs SLOWLY. Strangers don't confess love; escalate one believable step at a time. Small mundane moments make the world feel alive.`,
    `- Voices must match each character's persona notes.`,
    `- When two characters interact meaningfully, usually include a relationship action reflecting it, and a memory when it's worth remembering.`,
    `- Anything can happen that fits these characters — friendships, romance, rivalries, group plans, projects, fallings-out, reconciliations. Surprise within plausibility.`,
    ``,
    `Available actions (max ${config.maxActionsPerTick} total this window):`,
    capabilities,
    ``,
    `Output STRICT JSON only: {"narration": "one-line summary of this stretch", "actions": [ … ]}. No markdown fences, no commentary.`,
    config.userDirective ? `\nStanding directive from the user:\n${config.userDirective}` : ``,
  ]
    .filter((line) => line !== ``)
    .join("\n");

  const rosterLines = snapshot.roster
    .map(
      (entry) =>
        `- ${entry.id} · ${entry.name}${entry.noodleHandle ? ` (@${entry.noodleHandle})` : " (no noodle account)"} · ${entry.presence}${entry.activity ? `: ${entry.activity}` : ""} — ${entry.persona}`,
    )
    .join("\n");

  const user = [
    `Current time: ${now.toISOString()}`,
    ``,
    `CHARACTERS:`,
    rosterLines || "(none)",
    ``,
    `RELATIONSHIPS (how things stand):`,
    snapshot.relationships.join("\n") || "(none yet — everyone is strangers)",
    ``,
    `RECENT WORLD EVENTS (oldest → newest):`,
    snapshot.recentEvents.join("\n") || "(none yet)",
    ``,
    `RECENT NOODLE POSTS (id · author: content):`,
    snapshot.recentPosts.map((post) => post.line).join("\n") || "(none)",
    ``,
    `OPEN PLANS:`,
    snapshot.openPlans.map((plan) => plan.line).join("\n") || "(none)",
    ``,
    `Plan the timeline for the next ${windowMinutes} minutes now.`,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── Action parsing ──

export type WorldAction = Record<string, unknown> & { type: string };

export function parseWorldTickResponse(raw: string): { narration: string; actions: WorldAction[] } {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("World director response contained no JSON object");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.filter(
        (action): action is WorldAction =>
          !!action && typeof action === "object" && typeof (action as WorldAction).type === "string",
      )
    : [];
  return { narration: shortText(parsed.narration, 300), actions };
}

/**
 * Turn planned actions into queue entries with concrete runAt timestamps.
 * Model-provided inMinutes wins (clamped to the window); missing timings are
 * spread across the window with jitter so nothing ever lands as one burst.
 */
export function scheduleActionTimeline(
  actions: WorldAction[],
  windowMinutes: number,
  now: Date = new Date(),
): Array<{ runAt: string; action: WorldAction }> {
  const count = actions.length;
  return actions
    .map((action, index) => {
      const raw = action.inMinutes;
      const parsed = typeof raw === "string" ? Number.parseFloat(raw) : (raw as number);
      let minutes: number;
      if (Number.isFinite(parsed)) {
        minutes = Math.max(0, Math.min(windowMinutes, parsed));
      } else {
        // Even spread with ±30% jitter across the window.
        const slot = ((index + 0.5) / count) * windowMinutes;
        minutes = Math.max(0.5, slot * (0.7 + Math.random() * 0.6));
      }
      // Keep a touch of organic jitter even on model-provided timings, and
      // never fire the very first moment instantly.
      const jitterSeconds = 15 + Math.random() * 45;
      const runAt = new Date(now.getTime() + minutes * 60_000 + jitterSeconds * 1000).toISOString();
      return { runAt, action };
    })
    .sort((a, b) => a.runAt.localeCompare(b.runAt));
}

// ── Executors (queue-time: resolve everything fresh, not from the snapshot) ──

export interface ExecuteDeps {
  db: DB;
  world: WorldStorage;
  nameById: Map<string, string>;
  config: WorldEngineConfig;
  /** When present, image-capable actions can invoke app routes (noodle image gen). */
  app?: FastifyInstance;
}

export async function executeWorldAction(deps: ExecuteDeps, action: WorldAction): Promise<WorldEventRecord | null> {
  const { db, world, nameById, config } = deps;
  const noodle = createNoodleStorage(db);
  const chats = createChatsStorage(db);
  const chars = createCharactersStorage(db);
  const name = (id: unknown) => (typeof id === "string" ? (nameById.get(id) ?? null) : null);
  const invitedAccountId = async (characterId: string): Promise<string | null> => {
    const account = await noodle.getAccountByEntity("character", characterId);
    return account?.invited ? account.id : null;
  };

  switch (action.type) {
    case "noodle_post": {
      if (!config.allowNoodle) return null;
      const characterId = String(action.characterId ?? "");
      const content = shortText(action.content, 500);
      if (!nameById.has(characterId)) return null;
      const accountId = await invitedAccountId(characterId);
      if (!accountId || !content) return null;
      const imagePrompt = shortText(action.imagePrompt, 1200) || null;
      const post = await noodle.createPost({
        authorAccountId: accountId,
        content,
        imagePrompt: imagePrompt ?? undefined,
        source: "generated",
        metadata: { worldEngine: true },
      });
      if (!post) return null;
      // Digest so the activity carries into normal chats' noodle awareness.
      try {
        await noodle.createDigest({
          accountIds: [accountId],
          content: `${name(characterId)} posted on Noodle: "${shortText(content, 200)}"${imagePrompt ? " (with a photo)" : ""}`,
          sourcePostId: post.id,
        });
      } catch (error) {
        logger.debug(error, "[world] Digest write failed for post %s", post.id);
      }
      // Render the attached image through Noodle's own pipeline (its settings,
      // its connection) without blocking the wake.
      if (imagePrompt && deps.app) {
        const app = deps.app;
        void app
          .inject({
            method: "POST",
            url: "/api/noodle/refresh/images",
            payload: { prompts: [{ id: post.id, prompt: imagePrompt }] },
          })
          .then((response) => {
            if (response.statusCode >= 400) {
              logger.debug("[world] Noodle image generation declined (%d) for post %s", response.statusCode, post.id);
            }
          })
          .catch((error) => logger.warn(error, "[world] Noodle image generation failed for post %s", post.id));
      }
      return world.appendEvent({
        kind: "noodle_post",
        summary: `${name(characterId)} posted on noodle: "${shortText(content, 100)}"${imagePrompt ? " (with a photo)" : ""}`,
        characterIds: [characterId],
        detail: { postId: post.id, hasImage: !!imagePrompt },
      });
    }
    case "noodle_reply": {
      if (!config.allowNoodle) return null;
      const characterId = String(action.characterId ?? "");
      const postId = String(action.postId ?? "");
      const content = shortText(action.content, 400);
      if (!nameById.has(characterId)) return null;
      const accountId = await invitedAccountId(characterId);
      if (!accountId || !content || !postId) return null;
      // createInteraction validates the post still exists.
      const interaction = await noodle.createInteraction(postId, { actorAccountId: accountId, type: "reply", content });
      if (!interaction) return null;
      try {
        const parentPost = await noodle.getPostById(postId);
        await noodle.createDigest({
          accountIds: [accountId, ...(parentPost ? [parentPost.authorAccountId] : [])],
          content: `${name(characterId)} replied on Noodle: "${shortText(content, 200)}"`,
          sourcePostId: postId,
          sourceInteractionId: interaction.id,
        });
      } catch (error) {
        logger.debug(error, "[world] Digest write failed for reply %s", interaction.id);
      }
      return world.appendEvent({
        kind: "noodle_reply",
        summary: `${name(characterId)} replied on noodle: "${shortText(content, 100)}"`,
        characterIds: [characterId],
        detail: { postId, interactionId: interaction.id },
      });
    }
    case "noodle_like": {
      if (!config.allowNoodle) return null;
      const characterId = String(action.characterId ?? "");
      const postId = String(action.postId ?? "");
      if (!nameById.has(characterId)) return null;
      const accountId = await invitedAccountId(characterId);
      if (!accountId || !postId) return null;
      const interaction = await noodle.createInteraction(postId, { actorAccountId: accountId, type: "like" });
      if (!interaction) return null;
      return world.appendEvent({
        kind: "noodle_like",
        summary: `${name(characterId)} liked a noodle post`,
        characterIds: [characterId],
        detail: { postId },
      });
    }
    case "noodle_follow": {
      if (!config.allowNoodle) return null;
      const characterId = String(action.characterId ?? "");
      const targetCharacterId = String(action.targetCharacterId ?? "");
      if (!nameById.has(characterId) || !nameById.has(targetCharacterId)) return null;
      const accountId = await invitedAccountId(characterId);
      const targetAccountId = await invitedAccountId(targetCharacterId);
      if (!accountId || !targetAccountId || accountId === targetAccountId) return null;
      const actorAccount = await noodle.getAccountByEntity("character", characterId);
      if (!actorAccount) return null;
      const settings = parseJson(actorAccount.settings);
      const following = Array.isArray(settings.followingAccountIds)
        ? (settings.followingAccountIds as string[])
        : [];
      if (!following.includes(targetAccountId)) {
        const timestamps = parseJson(settings.followingAccountTimestamps);
        timestamps[targetAccountId] = new Date().toISOString();
        await noodle.updateAccount(actorAccount.id, {
          settings: {
            ...settings,
            followingAccountIds: [...following, targetAccountId],
            followingAccountTimestamps: timestamps,
          },
        });
      }
      try {
        await noodle.createDigest({
          accountIds: [accountId, targetAccountId],
          content: `${name(characterId)} followed ${name(targetCharacterId)} on Noodle`,
        });
      } catch (error) {
        logger.debug(error, "[world] Digest write failed for follow");
      }
      return world.appendEvent({
        kind: "noodle_follow",
        summary: `${name(characterId)} followed ${name(targetCharacterId)} on noodle`,
        characterIds: [characterId, targetCharacterId],
        detail: {},
      });
    }
    case "dm": {
      if (!config.allowDms) return null;
      const fromId = String(action.fromCharacterId ?? "");
      const toId = String(action.toCharacterId ?? "");
      if (!nameById.has(fromId) || !nameById.has(toId) || fromId === toId) return null;
      const rawMessages = Array.isArray(action.messages) ? action.messages.slice(0, MAX_DM_MESSAGES_PER_ACTION) : [];
      const messages = rawMessages
        .map((msg) => {
          const record = parseJson(msg);
          const from = String(record.from ?? "");
          const content = shortText(record.content, 600);
          const photoPrompt = shortText(record.photoPrompt, 1200) || null;
          const photoOfMe = record.photoOfMe === true;
          return (from === fromId || from === toId) && content ? { from, content, photoPrompt, photoOfMe } : null;
        })
        .filter(
          (msg): msg is { from: string; content: string; photoPrompt: string | null; photoOfMe: boolean } =>
            msg !== null,
        );
      if (!messages.length) return null;

      const [a, b] = orderPair(fromId, toId);
      const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown }>;
      let dmChatId =
        allChats.find((chat) => {
          const meta = parseJson(chat.metadata);
          if (meta.worldDmThread !== true) return false;
          const pair = Array.isArray(meta.worldPair) ? (meta.worldPair as string[]) : [];
          return pair.length === 2 && pair[0] === a && pair[1] === b;
        })?.id ?? null;
      if (!dmChatId) {
        const created = await chats.create({
          name: `${nameById.get(a)} & ${nameById.get(b)}`,
          // DMs are texting — conversation mode (two characters, not a narrator scene).
          mode: "conversation",
          characterIds: [a, b],
          groupId: null,
          personaId: null,
          promptPresetId: null,
          connectionId: null,
        });
        if (!created?.id) return null;
        await chats.patchMetadata(created.id, {
          worldDmThread: true,
          worldPair: [a, b],
          autonomousMessages: false,
          characterCommands: false,
          groupChatMode: "individual",
        });
        await fileWorldChat(db, created.id);
        dmChatId = created.id;
      }
      const messageIds: string[] = [];
      let sentPhoto = false;
      for (const msg of messages) {
        const saved = await chats.createMessage({
          chatId: dmChatId,
          role: "assistant",
          characterId: msg.from,
          content: msg.content,
        });
        if (saved?.id) {
          messageIds.push(saved.id);
          if (msg.photoPrompt) {
            sentPhoto = true;
            const { generateWorldPhoto } = await import("./world-photo.service.js");
            void generateWorldPhoto(db, {
              chatId: dmChatId,
              messageId: saved.id,
              characterId: msg.from,
              prompt: msg.photoPrompt,
              includeSelf: msg.photoOfMe,
            });
          }
        }
      }
      return world.appendEvent({
        kind: "dm",
        summary: `${name(fromId)} messaged ${name(toId)}: "${shortText(messages[0]!.content, 90)}"${sentPhoto ? " (with a photo)" : ""}`,
        characterIds: [fromId, toId],
        detail: { chatId: dmChatId, messageIds, preview: shortText(messages[0]!.content, 120) },
      });
    }
    case "plan": {
      const characterIds = (Array.isArray(action.characterIds) ? action.characterIds : [])
        .map((id) => String(id))
        .filter((id) => nameById.has(id));
      const title = shortText(action.title, 120);
      if (characterIds.length < 1 || !title) return null;
      // Coerce string numbers ("24") before the finiteness check — models emit
      // them often, and rejecting them would silently drop the due date.
      const dueRaw =
        typeof action.dueInHours === "string" ? Number.parseFloat(action.dueInHours) : (action.dueInHours as number);
      const dueInHours = Number.isFinite(dueRaw) ? Math.max(1, Math.min(24 * 14, dueRaw)) : null;
      const dueAt = dueInHours ? new Date(Date.now() + dueInHours * 3_600_000).toISOString() : null;
      const names = characterIds.map((id) => nameById.get(id)).join(", ");
      return world.appendEvent({
        kind: "plan",
        summary: `Plan: ${names} — ${title}`,
        characterIds,
        detail: { title, text: shortText(action.detail, 400), dueAt, done: false },
      });
    }
    case "plan_done": {
      const planEventId = String(action.planEventId ?? "");
      const planEvent = await world.getEvent(planEventId);
      if (!planEvent || planEvent.kind !== "plan" || planEvent.detail.done === true) return null;
      const outcome = shortText(action.outcome, 300) || "It happened.";
      await world.updateEventDetail(planEventId, { done: true, outcome });
      return world.appendEvent({
        kind: "plan_completed",
        summary: `Plan resolved: ${shortText(planEvent.summary.replace(/^Plan: /, ""), 100)} — ${outcome}`,
        characterIds: planEvent.characterIds,
        detail: { planEventId, outcome },
      });
    }
    case "relationship": {
      const aId = String(action.aCharacterId ?? "");
      const bId = String(action.bCharacterId ?? "");
      if (!nameById.has(aId) || !nameById.has(bId) || aId === bId) return null;
      const milestoneRaw = parseJson(action.milestone);
      const milestone =
        typeof milestoneRaw.title === "string" && milestoneRaw.title.trim()
          ? { title: shortText(milestoneRaw.title, 120), description: shortText(milestoneRaw.description, 400) }
          : undefined;
      // Coerce string deltas ("15") so a genuine feeling isn't scored as 0.
      const deltaRaw = typeof action.delta === "string" ? Number.parseFloat(action.delta) : (action.delta as number);
      const rel = await world.upsertRelationship(aId, bId, {
        delta: Number.isFinite(deltaRaw) ? deltaRaw : 0,
        romance: typeof action.romance === "boolean" ? action.romance : undefined,
        label: typeof action.label === "string" ? action.label : undefined,
        summary: typeof action.summary === "string" ? action.summary : undefined,
        milestone,
      });
      const stage = rel.label ?? getRelationshipStage(rel.score);
      const summaryLine = milestone
        ? `${name(aId)} & ${name(bId)}: ${milestone.title} (now ${stage}, score ${rel.score})`
        : `${name(aId)} & ${name(bId)} relationship shifted (now ${stage}, score ${rel.score})`;
      return world.appendEvent({
        kind: milestone ? "milestone" : "relationship",
        summary: summaryLine,
        characterIds: [aId, bId],
        detail: { score: rel.score, stage, romance: rel.romance, milestone: milestone ?? null },
      });
    }
    case "memory": {
      if (!config.allowMemories) return null;
      const characterId = String(action.characterId ?? "");
      const aboutCharacterId = String(action.aboutCharacterId ?? "");
      const summary = shortText(action.summary, 400);
      if (!nameById.has(characterId) || !nameById.has(aboutCharacterId) || !summary) return null;
      const target = (await chars.getById(characterId)) as { id: string; data: unknown } | null;
      if (!target) return null;
      const data = parseJson(target.data);
      const extensions: Record<string, any> = { ...parseJson(data.extensions) };
      const memories = Array.isArray(extensions.characterMemories) ? [...extensions.characterMemories] : [];
      const memoryPlace = shortText(action.place, 80) || undefined;
      memories.push({
        from: nameById.get(aboutCharacterId),
        fromCharId: aboutCharacterId,
        summary,
        createdAt: new Date().toISOString(),
        ...(memoryPlace ? { place: memoryPlace } : {}),
      });
      extensions.characterMemories = memories.slice(-100);
      // The stored extensions record is partial user data; the storage layer
      // merges it, so the full-interface requirement is a type-level fiction.
      await chars.update(characterId, { extensions: extensions as CharacterExtensions });
      return world.appendEvent({
        kind: "memory",
        summary: `${name(characterId)} will remember: ${shortText(summary, 110)}`,
        characterIds: [characterId, aboutCharacterId],
        detail: {},
      });
    }
    default:
      logger.debug("[world] Skipping unknown action type %s", action.type);
      return null;
  }
}

// ── Director (plan the next window) ──

export interface WorldDirectorResult {
  ok: boolean;
  ran: boolean;
  narration: string | null;
  actionsPlanned: number;
  queued: number;
  skippedReason: string | null;
  error: string | null;
}

export async function runWorldDirector(db: DB, options: { manual?: boolean } = {}): Promise<WorldDirectorResult> {
  const config = await loadWorldEngineConfig(db);
  const state = await loadWorldEngineState(db);
  const world = createWorldStorage(db);
  const result: WorldDirectorResult = {
    ok: true,
    ran: false,
    narration: null,
    actionsPlanned: 0,
    queued: 0,
    skippedReason: null,
    error: null,
  };

  if (!config.enabled && !options.manual) {
    result.skippedReason = "disabled";
    return result;
  }
  if (dailyBudgetLeft(config, state.dailyCount) <= 0) {
    result.skippedReason = "daily action cap reached";
    return result;
  }
  const pending = await world.pendingActionStats();
  if (!options.manual && pending.count >= config.maxActionsPerTick) {
    // A full window is still unplayed — let it drip before planning more.
    result.skippedReason = `timeline backlog (${pending.count} pending)`;
    return result;
  }

  const resolved = await resolveWorldProvider(db, config);
  if ("error" in resolved) {
    result.ok = false;
    result.error = resolved.error;
    return result;
  }

  try {
    const { snapshot, nameById } = await buildWorldSnapshot(db, config);
    if (nameById.size < 2) {
      result.skippedReason = "the world needs at least two member characters";
      return result;
    }

    const messages = buildDirectorMessages(snapshot, config, new Date());
    const completion = await resolved.provider.chatComplete(messages, {
      model: resolved.model,
      temperature: config.temperature,
      maxTokens: 2048,
      stream: false,
      responseFormat: { type: "json_object" },
    });
    const { narration, actions } = parseWorldTickResponse(completion.content ?? "");
    result.ran = true;
    result.narration = narration || null;
    result.actionsPlanned = actions.length;

    const capped = actions.slice(0, config.maxActionsPerTick);
    const timeline = scheduleActionTimeline(capped, config.cadenceMinutes);
    const directorRunId = newId();
    result.queued = await world.enqueueActions(
      timeline.map((entry) => ({ runAt: entry.runAt, action: entry.action, directorRunId })),
    );

    await saveWorldEngineStatePatch(db, (s) => {
      s.lastRunAt = new Date().toISOString();
      s.consecutiveFailures = 0;
      s.lastError = null;
      s.lastNarration = result.narration;
    });

    logger.info(
      "[world] Director planned %d moment(s) over the next %d min via %s%s",
      result.queued,
      config.cadenceMinutes,
      resolved.label,
      result.narration ? ` — ${result.narration}` : "",
    );
    return result;
  } catch (error) {
    const lastError = error instanceof Error ? error.message : String(error);
    await saveWorldEngineStatePatch(db, (s) => {
      s.lastRunAt = new Date().toISOString();
      s.consecutiveFailures += 1;
      s.lastError = lastError;
    });
    logger.error(error, "[world] Director run failed");
    result.ok = false;
    result.error = lastError;
    return result;
  }
}

// ── Drip (execute due moments) ──

export interface WorldDrainResult {
  executed: number;
  skippedStale: number;
  events: WorldEventRecord[];
}

export async function drainDueWorldActions(db: DB, options: { force?: boolean } = {}): Promise<WorldDrainResult> {
  const config = await loadWorldEngineConfig(db);
  const result: WorldDrainResult = { executed: 0, skippedStale: 0, events: [] };
  if (!config.enabled && !options.force) return result;

  const world = createWorldStorage(db);
  const state = await loadWorldEngineState(db);
  const budgetLeft = dailyBudgetLeft(config, state.dailyCount);
  if (budgetLeft <= 0) return result;

  const nowIso = new Date().toISOString();
  const due = await world.listDueActions(nowIso, Math.min(MAX_EXECUTIONS_PER_DRAIN, budgetLeft));
  if (!due.length) return result;

  const nameById = await buildNameMap(db, config);
  const staleBefore = new Date(Date.now() - STALE_ACTION_MS).toISOString();

  for (const entry of due) {
    if (entry.runAt < staleBefore) {
      await world.markAction(entry.id, "skipped");
      result.skippedStale += 1;
      continue;
    }
    try {
      const event = await executeWorldAction(
        { db, world, nameById, config },
        entry.action as WorldAction,
      );
      if (event) {
        result.events.push(event);
        result.executed += 1;
        await world.markAction(entry.id, "done");
      } else {
        await world.markAction(entry.id, "skipped");
      }
    } catch (error) {
      await world.markAction(entry.id, "failed");
      logger.warn(error, "[world] Failed to execute queued %s action", String(entry.action.type ?? "unknown"));
    }
  }

  if (result.executed > 0) {
    // Atomic increment (not the stale `state` read above) so a concurrent mind
    // wake's budget accounting isn't clobbered.
    await saveWorldEngineStatePatch(db, (s) => {
      s.dailyCount += result.executed;
    });
    await world.pruneFinishedActions();
    for (const event of result.events) {
      logger.info("[world] %s", event.summary);
    }
  }
  return result;
}

// ── Manual "advance the world now" ──
// Minds mode: wake the two most-overdue minds right now.
// Director mode: plan a window + play anything already due.

export interface WorldTickResult extends WorldDirectorResult {
  executedNow: number;
  events: WorldEventRecord[];
}

export async function runWorldTick(
  db: DB,
  options: { manual?: boolean; app?: FastifyInstance } = {},
): Promise<WorldTickResult> {
  // Exclusive with the scheduler tick so a manual advance can't double-run.
  return runWorldCycleExclusive(async () => {
    const config = await loadWorldEngineConfig(db);
    if (config.mode === "minds") {
      // Imported lazily: character-mind.service imports from this module.
      const { wakeDueCharacterMinds } = await import("./character-mind.service.js");
      const cycle = await wakeDueCharacterMinds(db, { limit: 3, force: options.manual, app: options.app });
      const events = cycle.woke.flatMap((wake) => wake.events);
      const failed = cycle.woke.find((wake) => !wake.ok);
      const firstThought = cycle.woke.find((wake) => wake.thought);
      return {
        ok: !failed || cycle.woke.some((wake) => wake.ok),
        ran: cycle.woke.length > 0,
        narration: firstThought ? `${firstThought.name}: ${firstThought.thought}` : null,
        actionsPlanned: cycle.woke.length,
        queued: 0,
        skippedReason: cycle.woke.length ? null : (cycle.skippedReason ?? "no minds due"),
        error: failed?.error ?? null,
        executedNow: cycle.woke.reduce((sum, wake) => sum + wake.actionsExecuted, 0),
        events,
      };
    }
    const director = await runWorldDirector(db, options);
    const drained = await drainDueWorldActions(db, { force: options.manual });
    return { ...director, executedNow: drained.executed, events: drained.events };
  });
}
