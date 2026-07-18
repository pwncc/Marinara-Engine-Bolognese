// ──────────────────────────────────────────────
// Living World engine — the simulator behind character life
// ──────────────────────────────────────────────
// Each "beat" (tick) snapshots the world — roster + presence, pairwise
// relationships, recent events, recent noodle activity, open plans — and asks
// an LLM to advance it by a handful of actions: public noodle activity,
// private character↔character DM threads, plans, relationship shifts, and
// memories. Executed actions become real rows (noodle posts, chat messages,
// character memories) plus append-only world_events, so every arc is
// observable after the fact.
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

import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { getLocalSidecarProvider } from "../llm/local-sidecar.js";
import type { BaseLLMProvider, ChatMessage } from "../llm/base-provider.js";
import { createAppSettingsStorage } from "../storage/app-settings.storage.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";
import { createWorldStorage, orderPair, type WorldStorage } from "../storage/world.storage.js";

const CONFIG_KEY = "worldEngine";
const STATE_KEY = "worldEngineState";
const LOCAL_SIDECAR_MODEL = "local-sidecar";
const MAX_DM_MESSAGES = 6;
const MAX_SNAPSHOT_EVENTS = 30;
const MAX_SNAPSHOT_POSTS = 15;
const MAX_OPEN_PLANS = 10;

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
    dailyActionCap: Math.round(num(data.dailyActionCap, DEFAULT_WORLD_ENGINE_CONFIG.dailyActionCap, 1, 1000)),
    allowNoodle: data.allowNoodle !== false,
    allowDms: data.allowDms !== false,
    allowMemories: data.allowMemories !== false,
    temperature: num(data.temperature, DEFAULT_WORLD_ENGINE_CONFIG.temperature, 0, 2),
    userDirective: typeof data.userDirective === "string" ? data.userDirective.slice(0, 2000) : "",
  };
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
    return { error: "No world connection configured. Set connectionId to an API connection id or \"local\"." };
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

function parseCharacterData(raw: unknown): Record<string, unknown> {
  return parseJson(raw);
}

function shortText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function buildWorldSnapshot(db: DB): Promise<{ snapshot: WorldSnapshot; nameById: Map<string, string> }> {
  const chars = createCharactersStorage(db);
  const chats = createChatsStorage(db);
  const noodle = createNoodleStorage(db);
  const world = createWorldStorage(db);

  const characterRows = (await chars.list()) as Array<{ id: string; data: unknown }>;
  const nameById = new Map<string, string>();
  const personaById = new Map<string, string>();
  for (const row of characterRows) {
    const data = parseCharacterData(row.data);
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
        /* schedules are user data — never let a malformed one kill a tick */
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

  const relationships = (await world.listRelationships()).slice(0, 60).map((rel) => {
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

// ── Prompt ──

function buildWorldTickMessages(snapshot: WorldSnapshot, config: WorldEngineConfig, now: Date): ChatMessage[] {
  const capabilities = [
    config.allowNoodle
      ? `- noodle_post {characterId, content} — public post on the Noodle timeline (only characters WITH a handle)\n- noodle_reply {characterId, postId, content} — public reply to a listed post\n- noodle_like {characterId, postId}\n- noodle_follow {characterId, targetCharacterId}`
      : null,
    config.allowDms
      ? `- dm {fromCharacterId, toCharacterId, messages: [{from: characterId, content}, …]} — a private DM exchange between two characters (1-${MAX_DM_MESSAGES} short messages, both voices allowed)`
      : null,
    `- plan {characterIds, title, detail, dueInHours?} — record an intention (meetup, date, collab, confrontation…) to follow up on in later beats\n- plan_done {planEventId, outcome} — resolve an open plan with what actually happened`,
    `- relationship {aCharacterId, bCharacterId, delta (-20..20), romance?, label?, summary, milestone?: {title, description}} — evolve how two characters stand; use milestones for firsts (first meeting, first fight, confession…)`,
    config.allowMemories
      ? `- memory {characterId, aboutCharacterId, summary} — something characterId will remember about the other`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    `You are the invisible life simulator behind a world of fictional characters. Between user sessions, their lives continue: they post publicly, message each other privately, make and keep plans, drift together or apart, fall in and out of love, hold grudges, and remember.`,
    ``,
    `Rules:`,
    `- Advance the world by ONE small beat: choose 1-${config.maxActionsPerTick} actions total.`,
    `- CONTINUITY IS EVERYTHING. Build on recent events, open plans, and relationship summaries. Do not reset or contradict them.`,
    `- Move arcs SLOWLY. Strangers don't confess love; escalate one believable step at a time. Not every beat needs drama — small mundane beats make the world feel alive.`,
    `- Respect presence: characters who are offline or dnd should rarely act; characters whose activity fits (e.g. "at the gym") should act in character with it.`,
    `- Voices must match each character's persona notes.`,
    `- When two characters interact meaningfully, usually include a relationship action reflecting it, and a memory when it's worth remembering.`,
    `- Anything can happen that fits these characters — friendships, romance, rivalries, group plans, creative projects, fallings-out, reconciliations. Surprise within plausibility.`,
    ``,
    `Available actions:`,
    capabilities,
    ``,
    `Output STRICT JSON only: {"narration": "one-line summary of this beat", "actions": [ … ]}. No markdown fences, no commentary.`,
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
    `Advance the world by one beat now.`,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── Action parsing & execution ──

export type WorldAction = Record<string, unknown> & { type: string };

export function parseWorldTickResponse(raw: string): { narration: string; actions: WorldAction[] } {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("World tick response contained no JSON object");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.filter(
        (action): action is WorldAction =>
          !!action && typeof action === "object" && typeof (action as WorldAction).type === "string",
      )
    : [];
  return { narration: shortText(parsed.narration, 300), actions };
}

export interface ExecuteDeps {
  db: DB;
  world: WorldStorage;
  nameById: Map<string, string>;
  snapshot: WorldSnapshot;
  config: WorldEngineConfig;
}

export async function executeWorldAction(deps: ExecuteDeps, action: WorldAction): Promise<WorldEventRecord | null> {
  const { db, world, nameById, snapshot, config } = deps;
  const noodle = createNoodleStorage(db);
  const chats = createChatsStorage(db);
  const chars = createCharactersStorage(db);
  const name = (id: unknown) => (typeof id === "string" ? (nameById.get(id) ?? null) : null);
  const accountFor = (characterId: unknown) =>
    snapshot.roster.find((entry) => entry.id === characterId)?.noodleAccountId ?? null;

  switch (action.type) {
    case "noodle_post": {
      if (!config.allowNoodle) return null;
      const characterId = String(action.characterId ?? "");
      const content = shortText(action.content, 500);
      const accountId = accountFor(characterId);
      if (!accountId || !content) return null;
      const post = await noodle.createPost({ authorAccountId: accountId, content, source: "generated", metadata: { worldEngine: true } });
      if (!post) return null;
      return world.appendEvent({
        kind: "noodle_post",
        summary: `${name(characterId)} posted on noodle: "${shortText(content, 100)}"`,
        characterIds: [characterId],
        detail: { postId: post.id },
      });
    }
    case "noodle_reply": {
      if (!config.allowNoodle) return null;
      const characterId = String(action.characterId ?? "");
      const postId = String(action.postId ?? "");
      const content = shortText(action.content, 400);
      const accountId = accountFor(characterId);
      if (!accountId || !content || !snapshot.recentPosts.some((post) => post.id === postId)) return null;
      const interaction = await noodle.createInteraction(postId, { actorAccountId: accountId, type: "reply", content });
      if (!interaction) return null;
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
      const accountId = accountFor(characterId);
      if (!accountId || !snapshot.recentPosts.some((post) => post.id === postId)) return null;
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
      const accountId = accountFor(characterId);
      const targetAccountId = accountFor(targetCharacterId);
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
      const rawMessages = Array.isArray(action.messages) ? action.messages.slice(0, MAX_DM_MESSAGES) : [];
      const messages = rawMessages
        .map((msg) => {
          const record = parseJson(msg);
          const from = String(record.from ?? "");
          const content = shortText(record.content, 600);
          return (from === fromId || from === toId) && content ? { from, content } : null;
        })
        .filter((msg): msg is { from: string; content: string } => msg !== null);
      if (!messages.length) return null;

      const [a, b] = orderPair(fromId, toId);
      const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown; characterIds?: unknown }>;
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
        });
        dmChatId = created.id;
      }
      const messageIds: string[] = [];
      for (const msg of messages) {
        const saved = await chats.createMessage({
          chatId: dmChatId,
          role: "assistant",
          characterId: msg.from,
          content: msg.content,
        });
        if (saved?.id) messageIds.push(saved.id);
      }
      return world.appendEvent({
        kind: "dm",
        summary: `${name(fromId)} and ${name(toId)} exchanged DMs (${messages.length} messages)`,
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
      const dueInHours = Number.isFinite(action.dueInHours as number) ? Math.max(1, Math.min(24 * 14, action.dueInHours as number)) : null;
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
      const plan = snapshot.openPlans.find((entry) => entry.eventId === planEventId);
      if (!plan) return null;
      const outcome = shortText(action.outcome, 300) || "It happened.";
      await world.updateEventDetail(planEventId, { done: true, outcome });
      const planEvents = await world.listEvents({ kind: "plan", limit: 200 });
      const planEvent = planEvents.find((event) => event.id === planEventId);
      return world.appendEvent({
        kind: "plan_completed",
        summary: `Plan resolved: ${shortText(planEvent?.summary.replace(/^Plan: /, ""), 100)} — ${outcome}`,
        characterIds: planEvent?.characterIds ?? [],
        detail: { planEventId, outcome },
      });
    }
    case "relationship": {
      const aId = String(action.aCharacterId ?? "");
      const bId = String(action.bCharacterId ?? "");
      if (!nameById.has(aId) || !nameById.has(bId) || aId === bId) return null;
      const milestoneRaw = parseJson(action.milestone);
      const milestone = typeof milestoneRaw.title === "string" && milestoneRaw.title.trim()
        ? { title: shortText(milestoneRaw.title, 120), description: shortText(milestoneRaw.description, 400) }
        : undefined;
      const rel = await world.upsertRelationship(aId, bId, {
        delta: Number.isFinite(action.delta as number) ? (action.delta as number) : 0,
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
      memories.push({
        from: nameById.get(aboutCharacterId),
        fromCharId: aboutCharacterId,
        summary,
        createdAt: new Date().toISOString(),
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

// ── Tick orchestration ──

export interface WorldTickResult {
  ok: boolean;
  ran: boolean;
  narration: string | null;
  actionsProposed: number;
  actionsExecuted: number;
  events: WorldEventRecord[];
  error: string | null;
}

export async function runWorldTick(db: DB, options: { manual?: boolean } = {}): Promise<WorldTickResult> {
  const config = await loadWorldEngineConfig(db);
  const state = await loadWorldEngineState(db);
  const result: WorldTickResult = {
    ok: true,
    ran: false,
    narration: null,
    actionsProposed: 0,
    actionsExecuted: 0,
    events: [],
    error: null,
  };

  if (!config.enabled && !options.manual) {
    return result;
  }
  if (state.dailyCount >= config.dailyActionCap) {
    result.error = "Daily world action cap reached";
    return result;
  }

  const resolved = await resolveWorldProvider(db, config);
  if ("error" in resolved) {
    result.ok = false;
    result.error = resolved.error;
    return result;
  }

  try {
    const world = createWorldStorage(db);
    const { snapshot, nameById } = await buildWorldSnapshot(db);
    if (nameById.size < 2) {
      result.error = "The world needs at least two characters";
      return result;
    }

    const messages = buildWorldTickMessages(snapshot, config, new Date());
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
    result.actionsProposed = actions.length;

    const budgetLeft = Math.max(0, config.dailyActionCap - state.dailyCount);
    const runnable = actions.slice(0, Math.min(config.maxActionsPerTick, budgetLeft));
    for (const action of runnable) {
      try {
        const event = await executeWorldAction({ db, world, nameById, snapshot, config }, action);
        if (event) {
          result.events.push(event);
          result.actionsExecuted += 1;
        }
      } catch (error) {
        logger.warn(error, "[world] Failed to execute %s action", action.type);
      }
    }

    state.lastRunAt = new Date().toISOString();
    state.dailyCount += result.actionsExecuted;
    state.consecutiveFailures = 0;
    state.lastError = null;
    state.lastNarration = result.narration;
    await saveWorldEngineState(db, state);

    logger.info(
      "[world] Beat complete via %s: %d/%d action(s) executed%s",
      resolved.label,
      result.actionsExecuted,
      result.actionsProposed,
      result.narration ? ` — ${result.narration}` : "",
    );
    return result;
  } catch (error) {
    state.lastRunAt = new Date().toISOString();
    state.consecutiveFailures += 1;
    state.lastError = error instanceof Error ? error.message : String(error);
    await saveWorldEngineState(db, state);
    logger.error(error, "[world] World tick failed");
    result.ok = false;
    result.error = state.lastError;
    return result;
  }
}
