// ──────────────────────────────────────────────
// Character Minds — every character is its own agent
// ──────────────────────────────────────────────
// No narrator. Each world member has a persistent mind (intention, mood,
// read-cursors, wake clock) and a PERMANENT LIFE CHAT: a real conversation
// session where their inner life accumulates as messages — thoughts, things
// they say into their space, and anything the user writes to them (intrusion:
// the user's message pulls their next wake earlier, and they answer in that
// same chat, with the entire context kept forever).
//
// On their own schedule — pulled earlier by pings (DMs, group messages, user
// intrusions) — a character wakes in a PRIVATE first-person context: their
// card, their life chat tail, relationships from their side, memories, and
// only what's new TO THEM (their noodle feed, reactions to their posts, their
// DM and group threads). They think, and freely choose small actions or
// nothing. Interaction emerges across separate private contexts — nobody
// writes both sides.
//
// Pacing: the world trickles. At most one scheduled wake per cycle, with a
// global gap scaled to the roster, so life unfolds over hours — only direct
// pings can pull someone in fast, because answering a text quickly is the one
// thing that IS natural.
import {
  getEffectiveCurrentStatus,
  type WeekSchedule,
  type WorldEngineConfig,
  type WorldEventRecord,
} from "@marinara-engine/shared";

import type { FastifyInstance } from "fastify";

import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";
import { createWorldStorage, orderPair, type CharacterMindRow } from "../storage/world.storage.js";
import { generateWorldPhoto, hasWorldImageConnection } from "./world-photo.service.js";
import { isUnsupportedNoodleVisionInputError, readNoodleVisionImage } from "../noodle/noodle-vision.js";
import type { ChatMessage } from "../llm/base-provider.js";
import {
  buildNameMap,
  dailyBudgetLeft,
  ensureWorldChatFolder,
  executeWorldAction,
  fileWorldChat,
  isWorldMember,
  loadWorldEngineConfig,
  loadWorldEngineState,
  resolveWorldProvider,
  saveWorldEngineStatePatch,
  type ResolvedWorldProvider,
  type WorldAction,
} from "./world-engine.service.js";

const MAX_ACTIONS_PER_WAKE = 3;
const MAX_LIFE_TAIL = 12;
const MAX_FEED_ITEMS = 10;
const MAX_THREADS = 5;

/** Everything pace-related scales with the configured check-in interval. */
function minCheckinMinutes(config: WorldEngineConfig): number {
  return Math.max(1, Math.min(15, config.wakeIntervalMinutes * 0.4));
}

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

/** "just now" / "4m ago" / "2h ago" / "3d ago" — so minds feel elapsed time. */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((now.getTime() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

function localClock(now: Date): string {
  return now.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
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

// ── Life chat (their permanent session) ──

export async function ensureLifeChat(db: DB, characterId: string, name: string): Promise<string> {
  const chats = createChatsStorage(db);
  const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown }>;
  const existing = allChats.find((chat) => {
    const meta = parseJson(chat.metadata);
    return meta.worldLifeChat === true && meta.worldCharacterId === characterId;
  });
  if (existing) return existing.id;
  const created = await chats.create({
    name: `${name}'s life`,
    mode: "roleplay",
    characterIds: [characterId],
    groupId: null,
    personaId: null,
    promptPresetId: null,
    connectionId: null,
  });
  if (!created?.id) throw new Error(`Failed to create life chat for ${name}`);
  await chats.patchMetadata(created.id, {
    worldLifeChat: true,
    worldCharacterId: characterId,
    autonomousMessages: false,
    characterCommands: false,
  });
  await fileWorldChat(db, created.id);
  return created.id;
}

/**
 * The user wrote into a world chat (life chat, DM thread, or group thread):
 * pull every member character's next wake in close — they've been addressed.
 */
export async function bumpMindsForUserMessage(db: DB, chatId: string): Promise<void> {
  const chats = createChatsStorage(db);
  const chat = await chats.getById(chatId);
  if (!chat) return;
  const meta = parseJson((chat as { metadata?: unknown }).metadata);
  let targetIds: string[] = [];
  if (meta.worldLifeChat === true && typeof meta.worldCharacterId === "string") {
    targetIds = [meta.worldCharacterId];
  } else if (meta.worldDmThread === true && Array.isArray(meta.worldPair)) {
    targetIds = (meta.worldPair as unknown[]).filter((id): id is string => typeof id === "string");
  } else if (meta.worldGroupThread === true && Array.isArray(meta.worldMembers)) {
    targetIds = (meta.worldMembers as unknown[]).filter((id): id is string => typeof id === "string");
  }
  if (!targetIds.length) return;

  const config = await loadWorldEngineConfig(db);
  if (!config.enabled) return;
  const world = createWorldStorage(db);
  const presence = await resolvePresenceMap(db, targetIds);
  const now = Date.now();
  for (const characterId of targetIds) {
    if (!isWorldMember(config, characterId)) continue;
    // Being directly addressed: notice fast (still presence-shaped, min 1m).
    const delay = Math.max(1, noticeDelayMinutes(presence.get(characterId)?.status ?? "online") / 2);
    await world.bumpMindWake(characterId, new Date(now + delay * 60_000).toISOString());
  }
}

/**
 * How many consecutive back-and-forth turns two characters have traded across
 * their shared threads recently — used to let long exchanges wind down instead
 * of forcing a reply every time (the "goodnight × 60" loop).
 */
async function recentExchangeDepth(
  chats: ReturnType<typeof createChatsStorage>,
  aId: string,
  bId: string,
): Promise<number> {
  const [a, b] = orderPair(aId, bId);
  const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown; updatedAt?: string }>;
  const shared = allChats.find((chat) => {
    const meta = parseJson(chat.metadata);
    if (meta.worldDmThread === true && Array.isArray(meta.worldPair)) {
      return sameMembers(meta.worldPair as string[], [a, b]);
    }
    return false;
  });
  if (!shared) return 0;
  const messages = (await chats.listMessages(shared.id)) as Array<{ characterId?: string | null }>;
  // Count the trailing run of strictly-alternating author turns.
  let depth = 0;
  let last: string | null | undefined;
  for (let i = messages.length - 1; i >= 0 && i > messages.length - 40; i--) {
    const author = messages[i]!.characterId;
    if (last !== undefined && author === last) break;
    depth += 1;
    last = author;
  }
  return depth;
}

// ── Cross-thread recap (context preserved between a pair's surfaces) ──

/**
 * For a world chat (life space, DM, group, hangout), summarize the freshest
 * recent moments from the SAME people's OTHER world threads, so a DM knows
 * what just happened at the hangout and vice versa. Used both by mind wakes
 * (implicitly, via the threads section) and by the normal chat pipeline when
 * the user talks inside a world chat.
 */
export async function buildWorldCrossThreadRecap(db: DB, chatId: string): Promise<string | null> {
  const chats = createChatsStorage(db);
  const chat = await chats.getById(chatId);
  if (!chat) return null;
  const meta = parseJson((chat as { metadata?: unknown }).metadata);
  let subjectIds: string[] = [];
  if (meta.worldLifeChat === true && typeof meta.worldCharacterId === "string") {
    subjectIds = [meta.worldCharacterId];
  } else if (meta.worldDmThread === true && Array.isArray(meta.worldPair)) {
    subjectIds = (meta.worldPair as unknown[]).filter((id): id is string => typeof id === "string");
  } else if (meta.worldGroupThread === true && Array.isArray(meta.worldMembers)) {
    subjectIds = (meta.worldMembers as unknown[]).filter((id): id is string => typeof id === "string");
  }
  if (!subjectIds.length) return null;

  const config = await loadWorldEngineConfig(db);
  const nameById = await buildNameMap(db, config);
  const name = (id: string | null | undefined) => (id ? (nameById.get(id) ?? "someone") : "someone");

  const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown; updatedAt?: string }>;
  const siblings = allChats
    .map((candidate) => ({ candidate, candidateMeta: parseJson(candidate.metadata) }))
    .filter(({ candidate, candidateMeta }) => {
      if (candidate.id === chatId) return false;
      const memberIds =
        candidateMeta.worldLifeChat === true && typeof candidateMeta.worldCharacterId === "string"
          ? [candidateMeta.worldCharacterId]
          : candidateMeta.worldDmThread === true && Array.isArray(candidateMeta.worldPair)
            ? (candidateMeta.worldPair as string[])
            : candidateMeta.worldGroupThread === true && Array.isArray(candidateMeta.worldMembers)
              ? (candidateMeta.worldMembers as string[])
              : null;
      if (!memberIds) return false;
      // Sibling = involves every subject of this chat (for life chats: the character).
      return subjectIds.every((id) => memberIds.includes(id));
    })
    .sort((a, b) => String(b.candidate.updatedAt ?? "").localeCompare(String(a.candidate.updatedAt ?? "")))
    .slice(0, 2);
  if (!siblings.length) return null;

  const sections: string[] = [];
  for (const { candidate, candidateMeta } of siblings) {
    const messages = (await chats.listMessages(candidate.id)) as Array<{
      role: string;
      characterId?: string | null;
      content: string;
      createdAt: string;
    }>;
    const tail = messages.slice(-4);
    if (!tail.length) continue;
    const label =
      candidateMeta.worldLifeChat === true
        ? `${name(String(candidateMeta.worldCharacterId))}'s life`
        : candidateMeta.worldHangout === true
          ? `in person${typeof candidateMeta.worldPlace === "string" && candidateMeta.worldPlace ? ` @ ${candidateMeta.worldPlace}` : ""}`
          : candidateMeta.worldDmThread === true
            ? `their DMs`
            : `their group chat`;
    const lines = tail.map(
      (msg) =>
        `   ${msg.role === "user" ? "Visitor" : name(msg.characterId)} (${ago(msg.createdAt)}): ${shortText(msg.content, 140)}`,
    );
    sections.push(`— ${label}:\n${lines.join("\n")}`);
  }
  if (!sections.length) return null;
  return [
    `MEANWHILE, BETWEEN THE SAME PEOPLE ELSEWHERE (stay consistent with this — texts and in-person talk are separate threads of the same shared life):`,
    ...sections,
  ].join("\n");
}

// ── Wake context ──

interface ThreadContext {
  chatId: string;
  kind: "dm" | "group";
  label: string;
  lines: string[];
  hasNew: boolean;
  memberIds: string[];
}

interface MindContext {
  self: { id: string; name: string; persona: string };
  mind: CharacterMindRow;
  lifeChatId: string;
  lifeTail: string[];
  hasUnansweredVisitor: boolean;
  presence: { status: string; activity: string };
  hasNoodle: boolean;
  noodleImagesEnabled: boolean;
  photosEnabled: boolean;
  /** Everyone else who lives in this world — so anyone can be reached. */
  roster: string[];
  /** Images the character can currently see (their feed, their threads), as data URLs. */
  visionImages: Array<{ dataUrl: string; label: string }>;
  relationships: string[];
  memories: string[];
  feed: string[];
  reactions: string[];
  threads: ThreadContext[];
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

  // Everyone else in the world, with a one-line sense of who they are.
  const rosterRows = (await chars.list()) as Array<{ id: string; data: unknown }>;
  const roster = rosterRows
    .filter((rosterRow) => rosterRow.id !== characterId && nameById.has(rosterRow.id))
    .map((rosterRow) => {
      const rosterData = parseJson(rosterRow.data);
      const blurb =
        shortText(rosterData.personality, 100) || shortText(rosterData.description, 100) || "(a familiar face)";
      return `${rosterRow.id} · ${nameById.get(rosterRow.id)} — ${blurb}`;
    });

  const mind = (await world.getMind(characterId)) ?? (await world.upsertMind(characterId, { nextWakeAt: null }));
  const sinceIso =
    (typeof mind.cursors.seenPostsAt === "string" ? mind.cursors.seenPostsAt : null) ??
    mind.lastWakeAt ??
    new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const seenDmsAt = typeof mind.cursors.seenDmsAt === "string" ? mind.cursors.seenDmsAt : sinceIso;

  const presence = (await resolvePresenceMap(db, [characterId])).get(characterId) ?? {
    status: "unknown",
    activity: "",
  };

  // Their permanent life chat: thoughts, things said, and visitor messages.
  const lifeChatId = await ensureLifeChat(db, characterId, name);
  const lifeMessages = (await chats.listMessages(lifeChatId)) as Array<{
    role: string;
    characterId?: string | null;
    content: string;
    createdAt: string;
    extra?: unknown;
  }>;
  const imageAttachmentsOf = (extra: unknown): string[] => {
    const attachments = parseJson(extra).attachments;
    if (!Array.isArray(attachments)) return [];
    return attachments
      .map((attachment) => parseJson(attachment))
      .filter((attachment) => attachment.type === "image" && typeof attachment.url === "string")
      .map((attachment) => String(attachment.url));
  };
  const visionCandidates: Array<{ url: string; label: string; createdAt: string }> = [];
  const lifeTail = lifeMessages.slice(-MAX_LIFE_TAIL).map((msg) => {
    const who = msg.role === "user" ? "Visitor" : "you";
    const fresh = msg.role === "user" && msg.createdAt > seenDmsAt ? ", new" : "";
    const pics = msg.characterId !== characterId ? imageAttachmentsOf(msg.extra) : [];
    for (const url of pics) {
      visionCandidates.push({ url, label: `sent by the Visitor in your space`, createdAt: msg.createdAt });
    }
    return `${who} (${ago(msg.createdAt)}${fresh}): ${shortText(msg.content, 200)}${pics.length ? " [sent an image — attached]" : ""}`;
  });
  const lastMessage = lifeMessages[lifeMessages.length - 1];
  const hasUnansweredVisitor = !!lastMessage && lastMessage.role === "user";

  const account = await noodle.getAccountByEntity("character", characterId);
  const hasNoodle = !!account?.invited;
  const noodleSettings = hasNoodle ? await noodle.getSettings() : null;
  const noodleImagesEnabled = !!noodleSettings?.enableImagePrompts;
  const photosEnabled = await hasWorldImageConnection(db);

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

  // Noodle: what's new in my feed + reactions to my posts.
  const feed: string[] = [];
  const reactions: string[] = [];
  if (hasNoodle) {
    const posts = await noodle.listPosts({ limit: 25 });
    const myAccountId = account!.id;
    for (const post of posts) {
      const authorName = shortText(parseJson(post.authorSnapshot).displayName, 40) || "someone";
      if (post.authorAccountId !== myAccountId && post.createdAt > sinceIso && feed.length < MAX_FEED_ITEMS) {
        const hasPic = typeof post.imageUrl === "string" && post.imageUrl;
        feed.push(
          `${post.id} · ${authorName} (${ago(post.createdAt)}): ${shortText(post.content, 140)}${hasPic ? " [has an image — attached]" : ""}`,
        );
        if (hasPic) {
          visionCandidates.push({
            url: post.imageUrl!,
            label: `${authorName}'s noodle post ${post.id} ("${shortText(post.content, 50)}")`,
            createdAt: post.createdAt,
          });
        }
      }
    }
    const myPosts = posts.filter((post) => post.authorAccountId === myAccountId).slice(0, 5);
    if (myPosts.length) {
      const interactions = await noodle.listInteractions(myPosts.map((post) => post.id));
      for (const interaction of interactions) {
        if (interaction.actorAccountId === myAccountId || interaction.createdAt <= sinceIso) continue;
        const actor = shortText(parseJson(interaction.actorSnapshot).displayName, 40) || "someone";
        const myPost = myPosts.find((post) => post.id === interaction.postId);
        const postRef = shortText(myPost?.content, 60);
        if (interaction.type === "reply") {
          reactions.push(
            `${actor} (${ago(interaction.createdAt)}) replied on your post ${interaction.postId} ("${postRef}"): ${shortText(interaction.content, 120)}`,
          );
        } else if (interaction.type === "like") {
          reactions.push(`${actor} liked your post ${interaction.postId} ("${postRef}") ${ago(interaction.createdAt)}`);
        }
      }
    }
  }

  // My DM + group threads (tail + unread flag).
  const threads: ThreadContext[] = [];
  const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown; updatedAt?: string }>;
  const myThreads = allChats
    .map((chat) => ({ chat, meta: parseJson(chat.metadata) }))
    .filter(({ meta }) => {
      if (meta.worldDmThread === true && Array.isArray(meta.worldPair)) {
        const pair = meta.worldPair as string[];
        return pair.includes(characterId) && pair.every((id) => isWorldMember(config, id));
      }
      if (meta.worldGroupThread === true && Array.isArray(meta.worldMembers)) {
        const members = meta.worldMembers as string[];
        return members.includes(characterId) && members.every((id) => isWorldMember(config, id));
      }
      return false;
    })
    .sort((a, b) => String(b.chat.updatedAt ?? "").localeCompare(String(a.chat.updatedAt ?? "")))
    .slice(0, MAX_THREADS);
  for (const { chat, meta } of myThreads) {
    const isGroup = meta.worldGroupThread === true;
    const memberIds = (isGroup ? (meta.worldMembers as string[]) : (meta.worldPair as string[])).filter(
      (id) => id !== characterId,
    );
    const messages = (await chats.listMessages(chat.id)) as Array<{
      role: string;
      characterId?: string | null;
      content: string;
      createdAt: string;
      extra?: unknown;
    }>;
    // Active conversations get a deeper tail so continuity stays accurate.
    const hasNewProbe = messages
      .slice(-8)
      .some((msg) => msg.characterId !== characterId && msg.createdAt > seenDmsAt);
    const tail = messages.slice(hasNewProbe ? -8 : -5);
    const hasNew = tail.some((msg) => msg.characterId !== characterId && msg.createdAt > seenDmsAt);
    const otherNamesLabel = memberIds.map((id) => nameById.get(id) ?? "someone").join(", ");
    const threadLabel = isGroup
      ? meta.worldHangout === true
        ? `IN PERSON with ${otherNamesLabel}${typeof meta.worldPlace === "string" && meta.worldPlace ? ` @ ${meta.worldPlace}` : ""} — you're physically together; write prose, not texts`
        : `group with ${otherNamesLabel}`
      : `${memberIds[0] ?? ""} · ${nameById.get(memberIds[0] ?? "") ?? "someone"}`;
    threads.push({
      chatId: chat.id,
      kind: isGroup ? "group" : "dm",
      label: threadLabel,
      hasNew,
      memberIds,
      lines: tail.map((msg) => {
        const who =
          msg.role === "user"
            ? "Visitor"
            : msg.characterId === characterId
              ? "you"
              : (nameById.get(msg.characterId ?? "") ?? "them");
        const fresh = msg.characterId !== characterId && msg.createdAt > seenDmsAt ? ", new" : "";
        const pics = msg.characterId !== characterId ? imageAttachmentsOf(msg.extra) : [];
        for (const url of pics) {
          visionCandidates.push({ url, label: `sent by ${who} in your ${isGroup ? "group" : "DM"} thread`, createdAt: msg.createdAt });
        }
        return `${who} (${ago(msg.createdAt)}${fresh}): ${shortText(msg.content, 150)}${pics.length ? " [sent an image — attached]" : ""}`;
      }),
    });
  }

  const openPlans = (await world.listEvents({ kind: "plan", limit: 60 }))
    .filter((event) => event.detail.done !== true && event.characterIds.includes(characterId))
    .slice(0, 6)
    .map((event) => ({ eventId: event.id, line: event.summary }));

  const recentAboutMe = (await world.listEvents({ characterId, limit: 14 }))
    .filter((event) => event.kind !== "thought" && event.kind !== "say")
    .slice(0, 6)
    .map((event) => `(${ago(event.createdAt)}) ${event.summary}`)
    .reverse();

  // Load the freshest few images they can see as real vision inputs.
  const visionImages: MindContext["visionImages"] = [];
  for (const candidate of visionCandidates
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4)) {
    try {
      const dataUrl = await readNoodleVisionImage(candidate.url);
      if (dataUrl) visionImages.push({ dataUrl, label: candidate.label });
    } catch {
      /* a missing file is just a picture they can't load */
    }
  }

  return {
    self: { id: characterId, name, persona },
    mind,
    lifeChatId,
    lifeTail,
    hasUnansweredVisitor,
    presence,
    hasNoodle,
    noodleImagesEnabled,
    photosEnabled,
    roster,
    visionImages,
    relationships,
    memories,
    feed,
    reactions,
    threads,
    openPlans,
    recentAboutMe,
  };
}

// ── Wake prompt ──

function buildMindMessages(ctx: MindContext, config: WorldEngineConfig, now: Date): ChatMessage[] {
  const noodleActions = ctx.hasNoodle
    ? `  {"type":"post","content":"…"${ctx.noodleImagesEnabled ? `,"imagePrompt":"optional — a photo or meme you'd attach; describe it concretely (your appearance, the scene, or the meme format)"` : ``}} — post on Noodle
  {"type":"reply","postId":"…","content":"…"} — reply to a feed post
  {"type":"like","postId":"…"}
  {"type":"follow","characterId":"…"} — follow someone on Noodle\n`
    : ``;

  const system = [
    `You are ${ctx.self.name}.`,
    ctx.self.persona,
    ``,
    `This is your real, private, ongoing LIFE — not a story, and nobody is directing you. You are free. Live however this character actually would: act, don't act, be social, be a hermit, be kind, be difficult. There are no expectations to meet and no reply is ever owed.`,
    ``,
    `How your world works (so your choices land in reality, not just narration):`,
    `- The PRIVATE SPACE below is your own head and room — where you think and narrate what you're doing. It's not a chat with anyone.`,
    `- Your phone is REAL. Texting = the "message" action (lands in your actual DM thread); posting = "post". If you pick up your phone, use the tool — don't just describe texting. Each thread is its own real place; what's said in one isn't automatically known in another.`,
    `- Noodle: the FEED is the public timeline; react only with EXACT postIds copied from what you see (never invent one).`,
    `- People: PEOPLE IN YOUR WORLD lists everyone; you can reach any of them by id. Meeting in person is the "hangout" action (you're then physically together — write it as lived prose, actions and dialogue).`,
    `- Every item shows how long ago it happened. A minutes-old message is live; an hours-old one you're catching up on; something days old may have moved on. A conversation is allowed to simply end.`,
    `- A Visitor may speak into your private space; you can answer them plainly with "say".`,
    config.userDirective ? `\nThe one who hosts this world asks:\n${config.userDirective}` : ``,
    ``,
    `Respond with STRICT JSON only (no fences, no commentary):`,
    `{`,
    `  "thought": "your private journal line for this moment (always; first person)",`,
    `  "mood": "1-4 words (optional)",`,
    `  "intention": "what you're up to / meaning to do next (optional, replaces the old one)",`,
    `  "nextCheckInMinutes": ${Math.round(minCheckinMinutes(config))}-${config.wakeIntervalMinutes * 4} — when you'd naturally check in again,`,
    `  "actions": [ 0-${MAX_ACTIONS_PER_WAKE} of:`,
    `  {"type":"do","activity":"…"} — live: what you're doing now (off to work, making dinner, gym, gaming…). Narrated in your space and becomes your current intention.`,
    `  {"type":"say","content":"…"${ctx.photosEnabled ? `,"photoPrompt":"optional — ANY image you show (a selfie, your art, a meme, the view…); describe it concretely","photoOfMe":true|false (true when YOU appear in it)` : ""}} — speak aloud in your own space (answers the Visitor if they wrote)`,
    noodleActions +
      `  {"type":"message","toCharacterId":"…","content":"…"${ctx.photosEnabled ? `,"photoPrompt":"optional — ANY image you attach (a selfie, your art, a meme, what you're seeing…)","photoOfMe":true|false` : ""}} — DM someone (one text)
  {"type":"group_message","chatId":"…","content":"…"${ctx.photosEnabled ? `,"photoPrompt":"optional image","photoOfMe":true|false` : ""}} — reply in one of your group threads
  {"type":"start_group","withCharacterIds":["…","…"],"name":"…","content":"first message"} — pull 2+ people into a group text thread
  {"type":"hangout","withCharacterIds":["…"],"place":"where you meet","content":"the opening moment in lived prose (*actions*, dialogue)"} — physically meet 1+ people IRL; continues in a persistent in-person thread
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
    `It's ${localClock(now)}.`,
    ctx.mind.lastWakeAt ? `You last checked in ${ago(ctx.mind.lastWakeAt, now)}.` : `This is your first check-in here.`,
    `Your schedule right now: ${ctx.presence.status}${ctx.presence.activity ? ` — ${ctx.presence.activity}` : ""}.`,
    ctx.mind.mood ? `Your mood lately: ${ctx.mind.mood}.` : ``,
    ctx.mind.intention ? `You had meant to: ${ctx.mind.intention}` : ``,
    ``,
    `YOUR PRIVATE SPACE (your life chat — thoughts, things you've said, and the Visitor):`,
    ctx.lifeTail.join("\n") || "(quiet so far)",
    ctx.hasUnansweredVisitor ? `The Visitor's last message is still unanswered.` : ``,
    ``,
    `PEOPLE IN YOUR WORLD (id · name — who they are):`,
    ctx.roster.join("\n") || "(nobody else around)",
    ``,
    `WHERE YOU STAND WITH PEOPLE:`,
    ctx.relationships.join("\n") || "(you don't really know anyone yet — everyone above is someone you could meet)",
    ``,
    ctx.memories.length ? `THINGS YOU REMEMBER:\n${ctx.memories.join("\n")}\n` : ``,
    ctx.hasNoodle
      ? `NEW ON YOUR NOODLE FEED (id · author: content):\n${ctx.feed.join("\n") || "(nothing new)"}\n`
      : `(You don't have a Noodle account.)\n`,
    ctx.reactions.length ? `ON YOUR POSTS:\n${ctx.reactions.join("\n")}\n` : ``,
    ctx.threads.length
      ? `YOUR THREADS:\n${ctx.threads
          .map(
            (thread) =>
              `— [${thread.chatId}] ${thread.kind === "group" ? thread.label : `with ${thread.label}`}${thread.hasNew ? " (NEW)" : ""}:\n${thread.lines.map((line) => `   ${line}`).join("\n")}`,
          )
          .join("\n")}\n`
      : ``,
    ctx.openPlans.length
      ? `YOUR OPEN PLANS (id · plan):\n${ctx.openPlans.map((plan) => `${plan.eventId} · ${plan.line}`).join("\n")}\n`
      : ``,
    ctx.recentAboutMe.length ? `RECENTLY IN YOUR LIFE:\n${ctx.recentAboutMe.join("\n")}\n` : ``,
    ctx.visionImages.length
      ? `ATTACHED IMAGES (you can actually see these; they're attached in this order):\n${ctx.visionImages
          .map((image, index) => `image ${index + 1}: ${image.label}`)
          .join("\n")}\n`
      : ``,
    `Take your moment.`,
  ]
    .filter((line) => line !== ``)
    .join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: user,
      ...(ctx.visionImages.length ? { images: ctx.visionImages.map((image) => image.dataUrl) } : {}),
    },
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
      return { type: "noodle_post", characterId: selfId, content: action.content, imagePrompt: action.imagePrompt };
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
        messages: [
          { from: selfId, content: action.content, photoPrompt: action.photoPrompt, photoOfMe: action.photoOfMe },
        ],
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

// ── Mind-local executors (life chat + group threads) ──

async function executeDo(
  db: DB,
  ctx: { selfId: string; name: string; lifeChatId: string },
  activity: string,
): Promise<WorldEventRecord | null> {
  const text = shortText(activity, 200);
  if (!text) return null;
  const chats = createChatsStorage(db);
  const world = createWorldStorage(db);
  const saved = await chats.createMessage({
    chatId: ctx.lifeChatId,
    role: "assistant",
    characterId: ctx.selfId,
    content: `*${text}*`,
  });
  if (!saved?.id) return null;
  return world.appendEvent({
    kind: "activity",
    summary: `${ctx.name} — ${text}`,
    characterIds: [ctx.selfId],
    detail: { chatId: ctx.lifeChatId, messageId: saved.id, activity: text },
  });
}

async function executeSay(
  db: DB,
  ctx: { selfId: string; name: string; lifeChatId: string },
  content: string,
  photoPrompt?: string,
  photoOfMe?: boolean,
): Promise<WorldEventRecord | null> {
  const text = shortText(content, 800);
  if (!text) return null;
  const chats = createChatsStorage(db);
  const world = createWorldStorage(db);
  const saved = await chats.createMessage({
    chatId: ctx.lifeChatId,
    role: "assistant",
    characterId: ctx.selfId,
    content: text,
  });
  if (!saved?.id) return null;
  const photo = shortText(photoPrompt, 1200);
  if (photo) {
    void generateWorldPhoto(db, {
      chatId: ctx.lifeChatId,
      messageId: saved.id,
      characterId: ctx.selfId,
      prompt: photo,
      includeSelf: photoOfMe,
    });
  }
  return world.appendEvent({
    kind: "say",
    summary: `${ctx.name}: "${shortText(text, 120)}"${photo ? " (with a photo)" : ""}`,
    characterIds: [ctx.selfId],
    detail: { chatId: ctx.lifeChatId, messageId: saved.id, text },
  });
}

async function executeGroupAction(
  db: DB,
  config: WorldEngineConfig,
  nameById: Map<string, string>,
  selfId: string,
  action: WorldAction,
): Promise<{ event: WorldEventRecord | null; pingedIds: string[]; urgent: boolean }> {
  const chats = createChatsStorage(db);
  const world = createWorldStorage(db);
  const isHangout = action.type === "hangout";
  const content = shortText(action.content, isHangout ? 1200 : 600);
  if (!content) return { event: null, pingedIds: [], urgent: false };
  const selfName = nameById.get(selfId) ?? "someone";
  const place = shortText(action.place, 80);

  let chatId: string | null = null;
  let memberIds: string[] = [];

  if (action.type === "group_message") {
    const target = await chats.getById(String(action.chatId ?? ""));
    const meta = parseJson((target as { metadata?: unknown } | null)?.metadata);
    if (
      !target ||
      meta.worldGroupThread !== true ||
      !Array.isArray(meta.worldMembers) ||
      !(meta.worldMembers as string[]).includes(selfId)
    ) {
      return { event: null, pingedIds: [], urgent: false };
    }
    chatId = (target as { id: string }).id;
    memberIds = (meta.worldMembers as string[]).filter((id) => nameById.has(id));
  } else {
    // start_group (a text group, 3+) or hangout (physically together, 2+)
    const withIds = (Array.isArray(action.withCharacterIds) ? action.withCharacterIds.map(String) : []).filter(
      (id) => id !== selfId && nameById.has(id),
    );
    const members = [...new Set([selfId, ...withIds])];
    if (members.length < (isHangout ? 2 : 3)) return { event: null, pingedIds: [], urgent: false };
    const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown }>;
    const existing = allChats.find((chat) => {
      const meta = parseJson(chat.metadata);
      return (
        meta.worldGroupThread === true &&
        (meta.worldHangout === true) === isHangout &&
        Array.isArray(meta.worldMembers) &&
        sameMembers(meta.worldMembers as string[], members)
      );
    });
    if (existing) {
      chatId = existing.id;
      if (isHangout && place) {
        await chats.patchMetadata(existing.id, { worldPlace: place });
      }
    } else {
      const names = members.map((id) => nameById.get(id) ?? "?").join(", ");
      const groupName = shortText(action.name, 60) || (isHangout ? `${names}${place ? ` @ ${place}` : " — hangout"}` : names);
      const created = await chats.create({
        name: groupName,
        // Hangouts are in-person scenes (roleplay); text groups are chats (conversation).
        mode: isHangout ? "roleplay" : "conversation",
        characterIds: members,
        groupId: null,
        personaId: null,
        promptPresetId: null,
        connectionId: null,
      });
      if (!created?.id) return { event: null, pingedIds: [], urgent: false };
      await chats.patchMetadata(created.id, {
        worldGroupThread: true,
        worldMembers: members,
        ...(isHangout ? { worldHangout: true, worldPlace: place || null } : {}),
        autonomousMessages: false,
        characterCommands: false,
        // Each character speaks as themselves, not merged into one narrator.
        groupChatMode: "individual",
      });
      await fileWorldChat(db, created.id);
      chatId = created.id;
    }
    memberIds = members;
  }

  const saved = await chats.createMessage({ chatId: chatId!, role: "assistant", characterId: selfId, content });
  if (!saved?.id) return { event: null, pingedIds: [], urgent: false };
  const photo = shortText(action.photoPrompt, 1200);
  if (photo) {
    void generateWorldPhoto(db, {
      chatId: chatId!,
      messageId: saved.id,
      characterId: selfId,
      prompt: photo,
      includeSelf: action.photoOfMe === true,
    });
  }
  const others = memberIds.filter((id) => id !== selfId);
  const otherNames = others.map((id) => nameById.get(id) ?? "?").join(", ");
  const event = await world.appendEvent({
    kind: isHangout ? "hangout" : "group",
    summary: isHangout
      ? `${selfName} met up with ${otherNames}${place ? ` at ${place}` : ""}`
      : `${selfName} in a group with ${otherNames}: "${shortText(content, 90)}"${photo ? " (with a photo)" : ""}`,
    characterIds: memberIds,
    detail: { chatId, messageId: saved.id, preview: shortText(content, 120), ...(place ? { place } : {}) },
  });
  return { event, pingedIds: others, urgent: isHangout };
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
  options: { provider?: ResolvedWorldProvider; app?: FastifyInstance } = {},
): Promise<MindWakeResult> {
  const config = await loadWorldEngineConfig(db);
  const world = createWorldStorage(db);
  const chats = createChatsStorage(db);
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

    const wakeMessages = buildMindMessages(ctx, config, nowDate);
    const completionOptions = {
      model: resolved.model,
      temperature: config.temperature,
      maxTokens: 1024,
      stream: false as const,
      responseFormat: { type: "json_object" },
    };
    let completion;
    try {
      completion = await resolved.provider.chatComplete(wakeMessages, completionOptions);
    } catch (error) {
      // Non-vision model with images attached: retry text-only (labels remain).
      if (!ctx.visionImages.length || !isUnsupportedNoodleVisionInputError(error)) throw error;
      logger.debug("[world/mind] Model rejected image input; retrying %s's wake text-only", ctx.self.name);
      completion = await resolved.provider.chatComplete(
        wakeMessages.map(({ images: _images, ...message }) => message),
        completionOptions,
      );
    }
    const output = parseMindResponse(completion.content ?? "");
    result.thought = output.thought || null;

    // The thought lives in their permanent life chat; the event mirrors it so
    // the world timeline can deep-link into the session.
    if (output.thought) {
      const savedThought = await chats.createMessage({
        chatId: ctx.lifeChatId,
        role: "assistant",
        characterId,
        content: `*${output.thought}*`,
      });
      const thoughtEvent = await world.appendEvent({
        kind: "thought",
        summary: `${ctx.self.name}: "${shortText(output.thought, 140)}"`,
        characterIds: [characterId],
        detail: { chatId: ctx.lifeChatId, messageId: savedThought?.id ?? null, text: output.thought },
      });
      result.events.push(thoughtEvent);
    }

    // Execute chosen actions (budget-gated), collecting who got pinged.
    const state = await loadWorldEngineState(db);
    let budgetLeft = dailyBudgetLeft(config, state.dailyCount);
    const pinged = new Set<string>();
    const urgentPinged = new Set<string>();
    let doActivity: string | null = null;
    for (const rawAction of output.actions) {
      if (budgetLeft <= 0) break;
      try {
        let event: WorldEventRecord | null = null;
        if (rawAction.type === "do") {
          event = await executeDo(
            db,
            { selfId: characterId, name: ctx.self.name, lifeChatId: ctx.lifeChatId },
            String(rawAction.activity ?? rawAction.content ?? ""),
          );
          if (event) doActivity = String(event.detail.activity ?? "");
        } else if (rawAction.type === "say") {
          event = await executeSay(
            db,
            { selfId: characterId, name: ctx.self.name, lifeChatId: ctx.lifeChatId },
            String(rawAction.content ?? ""),
            typeof rawAction.photoPrompt === "string" ? rawAction.photoPrompt : undefined,
            rawAction.photoOfMe === true,
          );
        } else if (
          rawAction.type === "group_message" ||
          rawAction.type === "start_group" ||
          rawAction.type === "hangout"
        ) {
          const groupResult = await executeGroupAction(db, config, nameById, characterId, rawAction);
          event = groupResult.event;
          for (const id of groupResult.pingedIds) {
            pinged.add(id);
            if (groupResult.urgent) urgentPinged.add(id);
          }
        } else {
          const engineAction = toEngineAction(characterId, rawAction);
          if (!engineAction) continue;
          event = await executeWorldAction({ db, world, nameById, config, app: options.app }, engineAction);
          if (event && engineAction.type === "dm" && typeof engineAction.toCharacterId === "string") {
            pinged.add(engineAction.toCharacterId);
          }
        }
        if (event) {
          result.events.push(event);
          result.actionsExecuted += 1;
          budgetLeft -= 1;
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

    // They pinged someone: pull the recipients' next check-in earlier.
    // Hangout participants are physically together — they respond in minutes.
    // Anti-loop: as a back-and-forth drags on, the notice delay grows and
    // eventually no bump fires at all, so exchanges wind down instead of
    // ping-ponging "goodnight" forever.
    if (pinged.size) {
      const presence = await resolvePresenceMap(db, [...pinged]);
      const chats = createChatsStorage(db);
      for (const recipientId of pinged) {
        if (!nameById.has(recipientId)) continue;
        const depth = await recentExchangeDepth(chats, characterId, recipientId);
        if (depth >= 8) continue; // let it die — no forced continuation
        const slowdown = 1 + Math.max(0, depth - 2) * 0.6; // grows after a few turns
        const base = urgentPinged.has(recipientId)
          ? 1 + Math.random() * 3
          : noticeDelayMinutes(presence.get(recipientId)?.status ?? "unknown");
        const delay = base * slowdown;
        await world.bumpMindWake(recipientId, new Date(nowDate.getTime() + delay * 60_000).toISOString());
      }
    }

    // Update the mind: cursors, mood, intention, and their own next check-in.
    const requested = output.nextCheckInMinutes;
    const maxGap = config.wakeIntervalMinutes * 4;
    let gap = Number.isFinite(requested as number)
      ? Math.max(minCheckinMinutes(config), Math.min(maxGap, requested as number))
      : config.wakeIntervalMinutes * (0.6 + Math.random() * 0.8);
    // Presence floors scale with the configured pace: at a slow-life pace an
    // offline character sleeps for hours; at a bustling pace, minutes.
    if (ctx.presence.status === "offline") {
      gap = Math.max(gap, config.wakeIntervalMinutes * (3 + Math.random() * 3));
    } else if (ctx.presence.status === "dnd") {
      gap = Math.max(gap, config.wakeIntervalMinutes * (1.5 + Math.random() * 1.5));
    }
    const nowIso = nowDate.toISOString();
    await world.upsertMind(characterId, {
      mood: output.mood ?? undefined,
      // A "do" is a lived intention — it wins unless they stated a newer one.
      intention: output.intention ?? doActivity ?? undefined,
      lastWakeAt: nowIso,
      nextWakeAt: new Date(nowDate.getTime() + gap * 60_000).toISOString(),
      cursors: { seenPostsAt: nowIso, seenDmsAt: nowIso, wakeReason: "self" },
    });

    logger.info(
      "[world/mind] %s woke: %d action(s)%s — next check-in ~%dm",
      ctx.self.name,
      result.actionsExecuted,
      result.thought ? ` — "${shortText(result.thought, 80)}"` : "",
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

/**
 * Ensure every member has a mind row (first wakes staggered at offset times)
 * and — when noodle is allowed — an invited Noodle account, so world members
 * can actually post without a manual invite step.
 */
export async function ensureMindsInitialized(db: DB, config: WorldEngineConfig): Promise<void> {
  const world = createWorldStorage(db);
  const noodle = createNoodleStorage(db);
  const chats = createChatsStorage(db);
  const nameById = await buildNameMap(db, config);
  const existing = new Set((await world.listMinds()).map((mind) => mind.id));

  // Migration sweep: normalize every world chat's mode, folder (per-mode), and
  // group generation so each character speaks as themselves (not one narrator).
  const rpFolderId = await ensureWorldChatFolder(db, "roleplay");
  const convoFolderId = await ensureWorldChatFolder(db, "conversation");
  const allChats = (await chats.list()) as Array<{
    id: string;
    mode?: string | null;
    folderId?: string | null;
    metadata?: unknown;
  }>;
  for (const chat of allChats) {
    const meta = parseJson(chat.metadata);
    const isWorldChat = meta.worldLifeChat === true || meta.worldDmThread === true || meta.worldGroupThread === true;
    if (!isWorldChat) continue;
    // Life chats and in-person hangouts are roleplay (prose scenes); DMs and
    // text groups are conversation (two characters texting).
    const wantMode = meta.worldLifeChat === true || meta.worldHangout === true ? "roleplay" : "conversation";
    if (chat.mode !== wantMode) {
      await chats.update(chat.id, { mode: wantMode });
    }
    // Multi-character world chats speak individually, never merged/narrator.
    const isMulti = meta.worldDmThread === true || meta.worldGroupThread === true;
    if (isMulti && meta.groupChatMode !== "individual") {
      await chats.patchMetadata(chat.id, { groupChatMode: "individual" });
    }
    const wantFolderId = wantMode === "conversation" ? convoFolderId : rpFolderId;
    if (wantFolderId && chat.folderId !== wantFolderId) {
      await fileWorldChat(db, chat.id);
    }
  }
  for (const [characterId, name] of nameById) {
    if (config.allowNoodle) {
      const account = await noodle.getAccountByEntity("character", characterId);
      if (!account) {
        await noodle.upsertAccountFromProfile({ kind: "character", entityId: characterId, displayName: name, invited: true });
      } else if (!account.invited) {
        await noodle.updateAccount(account.id, { invited: true });
      }
    }
    if (existing.has(characterId)) continue;
    // First wakes spread across the interval at offset times — everyone gets a
    // turn within roughly one window of enabling.
    const stagger = (0.05 + Math.random() * 0.95) * config.wakeIntervalMinutes;
    await world.upsertMind(characterId, {
      nextWakeAt: new Date(Date.now() + stagger * 60_000).toISOString(),
    });
  }
}

/** Minimum real-time gap between spontaneous wakes, scaled to pace and roster. */
export function worldPaceGapMinutes(config: WorldEngineConfig, memberCount: number): number {
  const base = config.wakeIntervalMinutes / Math.max(2, memberCount);
  return Math.max(0.25, Math.min(20, base));
}

export interface MindsCycleResult {
  woke: MindWakeResult[];
  skippedReason: string | null;
}

/** How many ping-response wakes may run per cycle (active conversations flow). */
const MAX_PING_WAKES_PER_CYCLE = 4;

/** Scheduled wakes per cycle scale with the roster so everyone gets turns. */
export function scheduledWakesPerCycle(memberCount: number): number {
  return Math.max(1, Math.min(4, Math.ceil(memberCount / 4)));
}

/**
 * Split due minds into two lanes: ping-responses (someone addressed them —
 * these flow at texting speed and ignore the global pace) and spontaneous
 * check-ins (one at a time, keeping the world's slow trickle).
 */
export function selectDueMinds(
  minds: CharacterMindRow[],
  nowIso: string,
  options: { force?: boolean; paceOpen: boolean; scheduledLimit: number },
): CharacterMindRow[] {
  const due = minds
    .filter((mind) => options.force || !mind.nextWakeAt || mind.nextWakeAt <= nowIso)
    .sort((a, b) => String(a.nextWakeAt ?? "").localeCompare(String(b.nextWakeAt ?? "")));
  if (options.force) return due.slice(0, Math.max(1, options.scheduledLimit));
  const pinged = due.filter((mind) => mind.cursors.wakeReason === "ping").slice(0, MAX_PING_WAKES_PER_CYCLE);
  const scheduled = options.paceOpen
    ? due.filter((mind) => mind.cursors.wakeReason !== "ping").slice(0, options.scheduledLimit)
    : [];
  return [...pinged, ...scheduled];
}

/** Wake due minds: ping-responses flow freely, spontaneous wakes keep the pace. */
export async function wakeDueCharacterMinds(
  db: DB,
  options: { limit?: number; force?: boolean; app?: FastifyInstance } = {},
): Promise<MindsCycleResult> {
  const config = await loadWorldEngineConfig(db);
  const result: MindsCycleResult = { woke: [], skippedReason: null };

  const state = await loadWorldEngineState(db);
  if (dailyBudgetLeft(config, state.dailyCount) <= 0 && !options.force) {
    result.skippedReason = "daily action cap reached";
    return result;
  }

  await ensureMindsInitialized(db, config);
  const world = createWorldStorage(db);
  const nameById = await buildNameMap(db, config);
  const scheduledLimit = Math.max(1, options.limit ?? scheduledWakesPerCycle(nameById.size));

  // Global pace gates only SPONTANEOUS wakes — conversations keep flowing.
  let paceOpen = true;
  if (!options.force && state.lastRunAt) {
    const gapMs = worldPaceGapMinutes(config, nameById.size) * 60_000 * (0.7 + Math.random() * 0.6);
    paceOpen = Date.now() >= new Date(state.lastRunAt).getTime() + gapMs;
  }

  const nowIso = new Date().toISOString();
  const memberMinds = (await world.listMinds()).filter((mind) => nameById.has(mind.id));

  // A pace change (e.g. slow-life → bustling) applies immediately: minds still
  // scheduled far out under the old pace get re-staggered into the new window.
  const reStaggerBeyond = new Date(Date.now() + config.wakeIntervalMinutes * 2 * 60_000).toISOString();
  for (const mind of memberMinds) {
    if (mind.nextWakeAt && mind.nextWakeAt > reStaggerBeyond && mind.cursors.wakeReason !== "ping") {
      const stagger = (0.05 + Math.random() * 0.95) * config.wakeIntervalMinutes;
      mind.nextWakeAt = new Date(Date.now() + stagger * 60_000).toISOString();
      await world.upsertMind(mind.id, { nextWakeAt: mind.nextWakeAt });
    }
  }

  const due = selectDueMinds(memberMinds, nowIso, { force: options.force, paceOpen, scheduledLimit });
  if (!due.length) {
    result.skippedReason = paceOpen ? "no minds due" : "keeping the world's pace";
    return result;
  }

  const resolved = await resolveWorldProvider(db, config);
  if ("error" in resolved) {
    result.skippedReason = resolved.error;
    return result;
  }

  for (const mind of due) {
    const wasPing = mind.cursors.wakeReason === "ping";
    result.woke.push(await wakeCharacterMind(db, mind.id, { provider: resolved, app: options.app }));
    // Only spontaneous wakes advance the pace clock — a flowing conversation
    // shouldn't starve everyone else's check-ins.
    if (!wasPing) {
      await saveWorldEngineStatePatch(db, (current) => {
        current.lastRunAt = new Date().toISOString();
      });
    }
  }
  return result;
}
