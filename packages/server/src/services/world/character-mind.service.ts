// ──────────────────────────────────────────────
// Character Minds — every character is its own agent
// ──────────────────────────────────────────────
// No narrator. Each world member has a persistent mind (intention, mood,
// journal, read-cursors, wake clock). On their own schedule — pulled earlier
// by events like receiving a DM — they wake in a PRIVATE first-person context:
// their card, their journal, their relationships, and only what's new TO THEM
// (their noodle feed, reactions to their posts, their DM threads). They think
// (journaled as a world event), and freely choose small actions or nothing.
// Interaction emerges: Alice's message is just something Bob finds, in his own
// head, when he next checks his phone.
import {
  getEffectiveCurrentStatus,
  type WeekSchedule,
  type WorldEngineConfig,
  type WorldEventRecord,
} from "@marinara-engine/shared";

import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";
import { createWorldStorage, type CharacterMindRow } from "../storage/world.storage.js";
import type { ChatMessage } from "../llm/base-provider.js";
import {
  buildNameMap,
  executeWorldAction,
  isWorldMember,
  loadWorldEngineConfig,
  loadWorldEngineState,
  resolveWorldProvider,
  saveWorldEngineStatePatch,
  type ResolvedWorldProvider,
  type WorldAction,
} from "./world-engine.service.js";

const MAX_ACTIONS_PER_WAKE = 3;
const MAX_JOURNAL_LINES = 8;
const MAX_FEED_ITEMS = 10;
const MAX_DM_THREADS = 4;
const MIN_CHECKIN_MINUTES = 15;

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

function shortText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ── Presence ──

export async function resolvePresenceMap(
  db: DB,
  characterIds: string[],
): Promise<Map<string, { status: string; activity: string }>> {
  const chats = createChatsStorage(db);
  const wanted = new Set(characterIds);
  const result = new Map<string, { status: string; activity: string }>();
  const allChats = (await chats.list()) as Array<{ mode?: string | null; metadata?: unknown }>;
  for (const chat of allChats) {
    if (chat.mode !== "conversation") continue;
    const meta = parseJson(chat.metadata);
    const schedules = parseJson(meta.characterSchedules);
    const overrides = parseJson(meta.conversationStatusOverrides);
    for (const [charId, schedule] of Object.entries(schedules)) {
      if (!wanted.has(charId) || result.has(charId) || !schedule || typeof schedule !== "object") continue;
      try {
        const status = getEffectiveCurrentStatus(
          schedule as WeekSchedule,
          overrides[charId] as Parameters<typeof getEffectiveCurrentStatus>[1],
          new Date(),
        );
        result.set(charId, { status: status?.status ?? "unknown", activity: shortText(status?.activity, 60) });
      } catch {
        /* user data; skip */
      }
    }
  }
  return result;
}

/** How long someone plausibly takes to notice a ping, given their presence. */
export function noticeDelayMinutes(presence: string): number {
  const jitter = (min: number, max: number) => min + Math.random() * (max - min);
  switch (presence) {
    case "online":
      return jitter(2, 8);
    case "idle":
      return jitter(10, 30);
    case "dnd":
      return jitter(45, 90);
    case "offline":
      return jitter(60, 180);
    default:
      return jitter(10, 45);
  }
}

// ── Wake context ──

interface MindContext {
  self: { id: string; name: string; persona: string };
  mind: CharacterMindRow;
  presence: { status: string; activity: string };
  hasNoodle: boolean;
  relationships: string[];
  memories: string[];
  journal: string[];
  feed: string[];
  reactions: string[];
  dmThreads: Array<{ chatId: string; withId: string; withName: string; lines: string[]; hasNew: boolean }>;
  openPlans: Array<{ eventId: string; line: string }>;
  recentAboutMe: string[];
}

async function buildMindContext(
  db: DB,
  config: WorldEngineConfig,
  characterId: string,
  nameById: Map<string, string>,
): Promise<MindContext | null> {
  const chars = createCharactersStorage(db);
  const chats = createChatsStorage(db);
  const noodle = createNoodleStorage(db);
  const world = createWorldStorage(db);

  const row = (await chars.getById(characterId)) as { id: string; data: unknown } | null;
  if (!row) return null;
  const data = parseJson(row.data);
  const name = nameById.get(characterId) ?? (shortText(data.name, 60) || "Unnamed");
  const persona = [shortText(data.description, 400), shortText(data.personality, 300)].filter(Boolean).join("\n");

  const mind =
    (await world.getMind(characterId)) ?? (await world.upsertMind(characterId, { nextWakeAt: null }));
  const sinceIso =
    (typeof mind.cursors.seenPostsAt === "string" ? mind.cursors.seenPostsAt : null) ??
    mind.lastWakeAt ??
    new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const presence = (await resolvePresenceMap(db, [characterId])).get(characterId) ?? {
    status: "unknown",
    activity: "",
  };

  const account = await noodle.getAccountByEntity("character", characterId);
  const hasNoodle = !!account?.invited;

  // Relationships from my side of the table.
  const relationships = (await world.listRelationships(characterId))
    .filter((rel) => isWorldMember(config, rel.aCharacterId) && isWorldMember(config, rel.bCharacterId))
    .slice(0, 20)
    .map((rel) => {
      const otherId = rel.aCharacterId === characterId ? rel.bCharacterId : rel.aCharacterId;
      const other = nameById.get(otherId) ?? "someone";
      const label = rel.label ?? rel.stage;
      return `${otherId} · ${other}: ${label} (${rel.score}${rel.romance ? ", romantic" : ""})${rel.summary ? ` — ${rel.summary}` : ""}`;
    });

  const memories = (Array.isArray(parseJson(data.extensions).characterMemories)
    ? (parseJson(data.extensions).characterMemories as Array<Record<string, unknown>>)
    : []
  )
    .slice(-8)
    .map((memory) => `About ${shortText(memory.from, 40) || "someone"}: ${shortText(memory.summary, 160)}`);

  const journal = (await world.listEvents({ kind: "thought", characterId, limit: MAX_JOURNAL_LINES }))
    .map((event) => `[${event.createdAt.slice(5, 16)}] ${String(event.detail.text ?? event.summary)}`)
    .reverse();

  // Noodle: what's new in my feed + reactions to my posts.
  const feed: string[] = [];
  const reactions: string[] = [];
  if (hasNoodle) {
    const posts = await noodle.listPosts({ limit: 25 });
    const myAccountId = account!.id;
    for (const post of posts) {
      const authorName = shortText(parseJson(post.authorSnapshot).displayName, 40) || "someone";
      if (post.authorAccountId !== myAccountId && post.createdAt > sinceIso && feed.length < MAX_FEED_ITEMS) {
        feed.push(`${post.id} · ${authorName}: ${shortText(post.content, 140)}`);
      }
    }
    const myPostIds = posts.filter((post) => post.authorAccountId === myAccountId).slice(0, 5);
    if (myPostIds.length) {
      const interactions = await noodle.listInteractions(myPostIds.map((post) => post.id));
      for (const interaction of interactions) {
        if (interaction.actorAccountId === myAccountId || interaction.createdAt <= sinceIso) continue;
        const actor = shortText(parseJson(interaction.actorSnapshot).displayName, 40) || "someone";
        const myPost = myPostIds.find((post) => post.id === interaction.postId);
        const postRef = shortText(myPost?.content, 60);
        if (interaction.type === "reply") {
          reactions.push(`${actor} replied to your post ("${postRef}"): ${shortText(interaction.content, 120)}`);
        } else if (interaction.type === "like") {
          reactions.push(`${actor} liked your post ("${postRef}")`);
        }
      }
    }
  }

  // My world DM threads (tail + unread flag).
  const dmThreads: MindContext["dmThreads"] = [];
  const seenDmsAt = typeof mind.cursors.seenDmsAt === "string" ? mind.cursors.seenDmsAt : sinceIso;
  const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown; updatedAt?: string }>;
  const myThreads = allChats
    .filter((chat) => {
      const meta = parseJson(chat.metadata);
      if (meta.worldDmThread !== true) return false;
      const pair = Array.isArray(meta.worldPair) ? (meta.worldPair as string[]) : [];
      return pair.includes(characterId) && pair.every((id) => isWorldMember(config, id));
    })
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_DM_THREADS);
  for (const thread of myThreads) {
    const pair = (parseJson(thread.metadata).worldPair as string[]) ?? [];
    const withId = pair.find((id) => id !== characterId) ?? "";
    const messages = (await chats.listMessages(thread.id)) as Array<{
      characterId?: string | null;
      content: string;
      createdAt: string;
    }>;
    const tail = messages.slice(-6);
    const hasNew = tail.some((msg) => msg.characterId !== characterId && msg.createdAt > seenDmsAt);
    dmThreads.push({
      chatId: thread.id,
      withId,
      withName: nameById.get(withId) ?? "someone",
      hasNew,
      lines: tail.map(
        (msg) =>
          `${msg.characterId === characterId ? "you" : (nameById.get(msg.characterId ?? "") ?? "them")}${
            msg.characterId !== characterId && msg.createdAt > seenDmsAt ? " (new)" : ""
          }: ${shortText(msg.content, 150)}`,
      ),
    });
  }

  const openPlans = (await world.listEvents({ kind: "plan", limit: 60 }))
    .filter((event) => event.detail.done !== true && event.characterIds.includes(characterId))
    .slice(0, 6)
    .map((event) => ({ eventId: event.id, line: event.summary }));

  const recentAboutMe = (await world.listEvents({ characterId, limit: 12 }))
    .filter((event) => event.kind !== "thought")
    .slice(0, 6)
    .map((event) => `[${event.createdAt.slice(5, 16)}] ${event.summary}`)
    .reverse();

  return {
    self: { id: characterId, name, persona },
    mind,
    presence,
    hasNoodle,
    relationships,
    memories,
    journal,
    feed,
    reactions,
    dmThreads,
    openPlans,
    recentAboutMe,
  };
}

// ── Wake prompt ──

function buildMindMessages(ctx: MindContext, config: WorldEngineConfig, now: Date): ChatMessage[] {
  const noodleActions = ctx.hasNoodle
    ? `  {"type":"post","content":"…"} — post on Noodle
  {"type":"reply","postId":"…","content":"…"} — reply to a feed post
  {"type":"like","postId":"…"}
  {"type":"follow","characterId":"…"} — follow someone on Noodle\n`
    : ``;

  const system = [
    `You are ${ctx.self.name}.`,
    ctx.self.persona,
    ``,
    `This is not a story and nobody is watching. It's simply your life, continuing. You just found a quiet moment to think and maybe check your phone.`,
    `Be yourself. Feelings move slowly. Most check-ins are uneventful: a thought, maybe one small action, often nothing at all — that's honest living, not laziness. Reply to people only when YOU would. You may reach out, make plans, let things slide, hold grudges, catch feelings — whatever is true to you.`,
    config.userDirective ? `\nWorld ground rules (from the person hosting this world):\n${config.userDirective}` : ``,
    ``,
    `Respond with STRICT JSON only (no fences, no commentary):`,
    `{`,
    `  "thought": "your private journal line for this moment (always; first person)",`,
    `  "mood": "1-4 words (optional)",`,
    `  "intention": "what you're up to / meaning to do next (optional, replaces the old one)",`,
    `  "nextCheckInMinutes": ${MIN_CHECKIN_MINUTES}-${config.wakeIntervalMinutes * 4} — when you'd naturally check in again,`,
    `  "actions": [ 0-${MAX_ACTIONS_PER_WAKE} of:`,
    noodleActions +
      `  {"type":"message","toCharacterId":"…","content":"…"} — DM someone (one text; you can send a second with another action)
  {"type":"make_plan","withCharacterIds":["…"],"title":"…","detail":"…","dueInHours":24}
  {"type":"resolve_plan","planEventId":"…","outcome":"what actually happened"}
  {"type":"feel","aboutCharacterId":"…","delta":-20..20,"romance":true|false,"summary":"how things stand between you now","milestone":{"title":"…","description":"…"} (milestone only for real firsts)}
  {"type":"remember","aboutCharacterId":"…","summary":"something you'll keep about them"}`,
    `  ]`,
    `}`,
  ]
    .filter((line) => line !== ``)
    .join("\n");

  const user = [
    `It's ${now.toISOString()} (${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()]}).`,
    `Your schedule right now: ${ctx.presence.status}${ctx.presence.activity ? ` — ${ctx.presence.activity}` : ""}.`,
    ctx.mind.mood ? `Your mood lately: ${ctx.mind.mood}.` : ``,
    ctx.mind.intention ? `You had meant to: ${ctx.mind.intention}` : ``,
    ``,
    `PEOPLE IN YOUR LIFE (id · name: where you stand):`,
    ctx.relationships.join("\n") || "(you don't really know anyone yet)",
    ``,
    ctx.memories.length ? `THINGS YOU REMEMBER:\n${ctx.memories.join("\n")}\n` : ``,
    ctx.journal.length ? `YOUR RECENT JOURNAL:\n${ctx.journal.join("\n")}\n` : ``,
    ctx.hasNoodle
      ? `NEW ON YOUR NOODLE FEED (id · author: content):\n${ctx.feed.join("\n") || "(nothing new)"}\n`
      : `(You don't have a Noodle account.)\n`,
    ctx.reactions.length ? `ON YOUR POSTS:\n${ctx.reactions.join("\n")}\n` : ``,
    ctx.dmThreads.length
      ? `YOUR DMS:\n${ctx.dmThreads
          .map(
            (thread) =>
              `— with ${thread.withId} · ${thread.withName}${thread.hasNew ? " (NEW)" : ""}:\n${thread.lines.map((line) => `   ${line}`).join("\n")}`,
          )
          .join("\n")}\n`
      : ``,
    ctx.openPlans.length
      ? `YOUR OPEN PLANS (id · plan):\n${ctx.openPlans.map((plan) => `${plan.eventId} · ${plan.line}`).join("\n")}\n`
      : ``,
    ctx.recentAboutMe.length ? `RECENTLY IN YOUR LIFE:\n${ctx.recentAboutMe.join("\n")}\n` : ``,
    `Take your moment.`,
  ]
    .filter((line) => line !== ``)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// ── Wake output ──

interface MindOutput {
  thought: string;
  mood: string | null;
  intention: string | null;
  nextCheckInMinutes: number | null;
  actions: WorldAction[];
}

export function parseMindResponse(raw: string): MindOutput {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Mind response contained no JSON object");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const nextRaw = parsed.nextCheckInMinutes;
  const next = typeof nextRaw === "string" ? Number.parseFloat(nextRaw) : (nextRaw as number);
  return {
    thought: shortText(parsed.thought, 400),
    mood: typeof parsed.mood === "string" && parsed.mood.trim() ? shortText(parsed.mood, 60) : null,
    intention:
      typeof parsed.intention === "string" && parsed.intention.trim() ? shortText(parsed.intention, 240) : null,
    nextCheckInMinutes: Number.isFinite(next) ? next : null,
    actions: Array.isArray(parsed.actions)
      ? parsed.actions
          .filter(
            (action): action is WorldAction =>
              !!action && typeof action === "object" && typeof (action as WorldAction).type === "string",
          )
          .slice(0, MAX_ACTIONS_PER_WAKE)
      : [],
  };
}

/** Map first-person mind actions to engine actions, forcing the actor to be self. */
export function toEngineAction(selfId: string, action: WorldAction): WorldAction | null {
  switch (action.type) {
    case "post":
      return { type: "noodle_post", characterId: selfId, content: action.content };
    case "reply":
      return { type: "noodle_reply", characterId: selfId, postId: action.postId, content: action.content };
    case "like":
      return { type: "noodle_like", characterId: selfId, postId: action.postId };
    case "follow":
      return { type: "noodle_follow", characterId: selfId, targetCharacterId: action.characterId };
    case "message":
      return {
        type: "dm",
        fromCharacterId: selfId,
        toCharacterId: action.toCharacterId,
        messages: [{ from: selfId, content: action.content }],
      };
    case "make_plan": {
      const withIds = Array.isArray(action.withCharacterIds) ? action.withCharacterIds.map(String) : [];
      return {
        type: "plan",
        characterIds: [selfId, ...withIds],
        title: action.title,
        detail: action.detail,
        dueInHours: action.dueInHours,
      };
    }
    case "resolve_plan":
      return { type: "plan_done", planEventId: action.planEventId, outcome: action.outcome };
    case "feel":
      return {
        type: "relationship",
        aCharacterId: selfId,
        bCharacterId: action.aboutCharacterId,
        delta: action.delta,
        romance: action.romance,
        summary: action.summary,
        milestone: action.milestone,
      };
    case "remember":
      return { type: "memory", characterId: selfId, aboutCharacterId: action.aboutCharacterId, summary: action.summary };
    default:
      return null;
  }
}

// ── Wake execution ──

export interface MindWakeResult {
  characterId: string;
  name: string;
  ok: boolean;
  thought: string | null;
  actionsExecuted: number;
  events: WorldEventRecord[];
  error: string | null;
}

export async function wakeCharacterMind(
  db: DB,
  characterId: string,
  options: { provider?: ResolvedWorldProvider } = {},
): Promise<MindWakeResult> {
  const config = await loadWorldEngineConfig(db);
  const world = createWorldStorage(db);
  const nameById = await buildNameMap(db, config);
  const result: MindWakeResult = {
    characterId,
    name: nameById.get(characterId) ?? "Unknown",
    ok: true,
    thought: null,
    actionsExecuted: 0,
    events: [],
    error: null,
  };
  if (!nameById.has(characterId)) {
    result.ok = false;
    result.error = "not a world member";
    return result;
  }

  const resolved = options.provider ?? (await resolveWorldProvider(db, config));
  if ("error" in resolved) {
    result.ok = false;
    result.error = resolved.error;
    return result;
  }

  const nowDate = new Date();
  try {
    const ctx = await buildMindContext(db, config, characterId, nameById);
    if (!ctx) {
      result.ok = false;
      result.error = "character not found";
      return result;
    }

    const completion = await resolved.provider.chatComplete(buildMindMessages(ctx, config, nowDate), {
      model: resolved.model,
      temperature: config.temperature,
      maxTokens: 1024,
      stream: false,
      responseFormat: { type: "json_object" },
    });
    const output = parseMindResponse(completion.content ?? "");
    result.thought = output.thought || null;

    // Journal the thought (free — observability, not an action).
    if (output.thought) {
      const thoughtEvent = await world.appendEvent({
        kind: "thought",
        summary: `${ctx.self.name}: “${shortText(output.thought, 140)}”`,
        characterIds: [characterId],
        detail: { text: output.thought },
      });
      result.events.push(thoughtEvent);
    }

    // Execute chosen actions (budget-gated), bumping DM recipients' wakes.
    const state = await loadWorldEngineState(db);
    let budgetLeft = Math.max(0, config.dailyActionCap - state.dailyCount);
    const dmRecipients = new Set<string>();
    for (const rawAction of output.actions) {
      if (budgetLeft <= 0) break;
      const engineAction = toEngineAction(characterId, rawAction);
      if (!engineAction) continue;
      try {
        const event = await executeWorldAction({ db, world, nameById, config }, engineAction);
        if (event) {
          result.events.push(event);
          result.actionsExecuted += 1;
          budgetLeft -= 1;
          if (engineAction.type === "dm" && typeof engineAction.toCharacterId === "string") {
            dmRecipients.add(engineAction.toCharacterId);
          }
        }
      } catch (error) {
        logger.warn(error, "[world/mind] %s failed a %s action", ctx.self.name, String(rawAction.type));
      }
    }
    if (result.actionsExecuted > 0) {
      await saveWorldEngineStatePatch(db, (current) => {
        current.dailyCount += result.actionsExecuted;
      });
    }

    // They noticed a text: pull the recipient's next check-in earlier.
    if (dmRecipients.size) {
      const presence = await resolvePresenceMap(db, [...dmRecipients]);
      for (const recipientId of dmRecipients) {
        if (!nameById.has(recipientId)) continue;
        const delay = noticeDelayMinutes(presence.get(recipientId)?.status ?? "unknown");
        await world.bumpMindWake(recipientId, new Date(nowDate.getTime() + delay * 60_000).toISOString());
      }
    }

    // Update the mind: cursors, mood, intention, and their own next check-in.
    const requested = output.nextCheckInMinutes;
    const maxGap = config.wakeIntervalMinutes * 4;
    let gap = Number.isFinite(requested as number)
      ? Math.max(MIN_CHECKIN_MINUTES, Math.min(maxGap, requested as number))
      : config.wakeIntervalMinutes * (0.6 + Math.random() * 0.8);
    if (ctx.presence.status === "offline") gap = Math.max(gap, 90 + Math.random() * 120);
    else if (ctx.presence.status === "dnd") gap = Math.max(gap, 60 + Math.random() * 60);
    const nowIso = nowDate.toISOString();
    await world.upsertMind(characterId, {
      mood: output.mood ?? undefined,
      intention: output.intention ?? undefined,
      lastWakeAt: nowIso,
      nextWakeAt: new Date(nowDate.getTime() + gap * 60_000).toISOString(),
      cursors: { seenPostsAt: nowIso, seenDmsAt: nowIso },
    });

    logger.info(
      "[world/mind] %s woke: %d action(s)%s — next check-in ~%dm",
      ctx.self.name,
      result.actionsExecuted,
      result.thought ? ` — “${shortText(result.thought, 80)}”` : "",
      Math.round(gap),
    );
    return result;
  } catch (error) {
    result.ok = false;
    result.error = error instanceof Error ? error.message : String(error);
    // Back off this mind so one broken wake can't hot-loop.
    await world.upsertMind(characterId, {
      lastWakeAt: nowDate.toISOString(),
      nextWakeAt: new Date(nowDate.getTime() + config.wakeIntervalMinutes * 60_000).toISOString(),
    });
    logger.error(error, "[world/mind] Wake failed for %s", result.name);
    return result;
  }
}

// ── Scheduling ──

/** Ensure every member has a mind row; stagger brand-new minds' first wakes. */
export async function ensureMindsInitialized(db: DB, config: WorldEngineConfig): Promise<void> {
  const world = createWorldStorage(db);
  const nameById = await buildNameMap(db, config);
  const existing = new Set((await world.listMinds()).map((mind) => mind.id));
  for (const characterId of nameById.keys()) {
    if (existing.has(characterId)) continue;
    const stagger = Math.random() * config.wakeIntervalMinutes;
    await world.upsertMind(characterId, {
      nextWakeAt: new Date(Date.now() + stagger * 60_000).toISOString(),
    });
  }
}

export interface MindsCycleResult {
  woke: MindWakeResult[];
}

/** Wake the due minds (up to limit). force=true wakes the most overdue regardless. */
export async function wakeDueCharacterMinds(
  db: DB,
  options: { limit?: number; force?: boolean } = {},
): Promise<MindsCycleResult> {
  const config = await loadWorldEngineConfig(db);
  const limit = Math.max(1, options.limit ?? 2);
  const result: MindsCycleResult = { woke: [] };

  const state = await loadWorldEngineState(db);
  if (state.dailyCount >= config.dailyActionCap && !options.force) return result;

  await ensureMindsInitialized(db, config);
  const world = createWorldStorage(db);
  const nameById = await buildNameMap(db, config);
  const nowIso = new Date().toISOString();
  const due = (await world.listMinds())
    .filter((mind) => nameById.has(mind.id))
    .filter((mind) => options.force || !mind.nextWakeAt || mind.nextWakeAt <= nowIso)
    .sort((a, b) => String(a.nextWakeAt ?? "").localeCompare(String(b.nextWakeAt ?? "")))
    .slice(0, limit);
  if (!due.length) return result;

  const resolved = await resolveWorldProvider(db, config);
  if ("error" in resolved) {
    logger.debug("[world/mind] No provider: %s", resolved.error);
    return result;
  }

  for (const mind of due) {
    result.woke.push(await wakeCharacterMind(db, mind.id, { provider: resolved }));
  }
  return result;
}
