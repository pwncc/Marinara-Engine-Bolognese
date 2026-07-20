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
  normalizeTextForMatch,
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
import { createWorldStorage, orderPair, WORLD_USER_ID, type CharacterMindRow } from "../storage/world.storage.js";
import { generateWorldPhoto, hasWorldImageConnection } from "./world-photo.service.js";
import { getAtmosphere } from "./world-atmosphere.service.js";
import { isUnsupportedNoodleVisionInputError, readNoodleVisionImage } from "../noodle/noodle-vision.js";
import type { ChatMessage } from "../llm/base-provider.js";
import {
  buildNameMap,
  dailyBudgetLeft,
  executeWorldAction,
  fileWorldChat,
  removeWorldChatFolders,
  isWorldMember,
  loadWorldEngineConfig,
  loadWorldEngineState,
  resolveWorldProvider,
  resolveWorldUser,
  sanitizeWorldPersona,
  saveWorldEngineStatePatch,
  withWorldLock,
  type ResolvedWorldProvider,
  type WorldAction,
} from "./world-engine.service.js";

const MAX_ACTIONS_PER_WAKE = 3;
const MAX_LIFE_TAIL = 12;
/** A real recent slice of the feed, not just the last check's delta. */
const MAX_FEED_ITEMS = 24;
const MAX_THREADS = 5;

/** Everything pace-related scales with the configured check-in interval. */
function minCheckinMinutes(config: WorldEngineConfig): number {
  return Math.max(1, Math.min(15, config.wakeIntervalMinutes * 0.4));
}

/** How an action nudges needs — the loop that makes behavior purposeful. */
function needEffectFor(actionType: string, activity: string): Partial<Record<"energy" | "hunger" | "social", number>> {
  const text = activity.toLowerCase();
  if (actionType === "work") return { energy: -12 };
  if (actionType === "scene" || actionType === "hangout" || actionType === "message" || actionType === "group_message")
    return { social: +14 };
  // Sharing your life publicly scratches the social itch a little too.
  if (actionType === "post" || actionType === "reply") return { social: +6 };
  if (actionType === "do") {
    if (/\b(sleep|slept|nap|rest|resting|lie down|lay down|bed|dozed)\b/.test(text)) return { energy: +30 };
    if (/\b(eat|ate|eating|dinner|lunch|breakfast|meal|snack|cook|food|coffee|drink)\b/.test(text))
      return { hunger: -35 };
    if (/\b(gym|run|running|workout|exercise|jog)\b/.test(text)) return { energy: -8, hunger: +6 };
  }
  if (actionType === "spend" && /\b(food|meal|dinner|lunch|coffee|snack|groceries)\b/.test(text)) return { hunger: -25 };
  return {};
}

/** Passive decay + phase modifier since the last wake. */
function decayNeeds(
  needs: { energy: number; hunger: number; social: number },
  minutesElapsed: number,
  phase: string,
): { energy: number; hunger: number; social: number } {
  const hours = Math.max(0, Math.min(24, minutesElapsed / 60));
  // Night restores energy passively (you sleep); day drains it.
  const energyRate = phase === "night" ? +4 : -3;
  return {
    energy: Math.max(0, Math.min(100, Math.round(needs.energy + energyRate * hours))),
    hunger: Math.max(0, Math.min(100, Math.round(needs.hunger + 5 * hours))),
    social: Math.max(0, Math.min(100, Math.round(needs.social - 2.5 * hours))),
  };
}

function needsPrompt(needs: { energy: number; hunger: number; social: number }): string {
  const notes: string[] = [];
  if (needs.energy <= 25) notes.push("exhausted");
  else if (needs.energy <= 45) notes.push("tired");
  if (needs.hunger >= 75) notes.push("very hungry");
  else if (needs.hunger >= 55) notes.push("getting hungry");
  if (needs.social <= 20) notes.push("achingly lonely");
  else if (needs.social <= 40) notes.push("could use some company");
  // Low reserves bleed into mood — a drained, empty body makes you rawer and
  // shorter-fused, which should color how you treat people, not just what you do.
  if (needs.energy <= 25 && needs.social <= 30) notes.push("frayed and easily hurt");
  else if (needs.energy <= 30 || needs.hunger >= 80) notes.push("short-fused");
  return notes.length ? notes.join(", ") : "steady, nothing pressing";
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

function parseCharacterIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === "string");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
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

// ── Living is place-based: there is no separate "life chat" ──
// A character's moment-to-moment living lands in the scene chat of wherever
// they physically are (their own home when home). One place at a time; one
// shared reality per place.

/**
 * The user wrote into a world chat (a place, a DM thread, or a group thread):
 * pull the right characters' next wakes in close — they've been addressed.
 */
export async function bumpMindsForUserMessage(db: DB, chatId: string): Promise<void> {
  const chats = createChatsStorage(db);
  const chat = await chats.getById(chatId);
  if (!chat) return;
  const meta = parseJson((chat as { metadata?: unknown }).metadata);
  let targetIds: string[] = [];
  if (meta.worldDmThread === true && Array.isArray(meta.worldPair)) {
    targetIds = (meta.worldPair as unknown[]).filter((id): id is string => typeof id === "string");
  } else if (meta.worldGroupThread === true && Array.isArray(meta.worldMembers)) {
    targetIds = (meta.worldMembers as unknown[]).filter((id): id is string => typeof id === "string");
  } else if (meta.worldPlaceScene === true) {
    // Speaking into a place reaches whoever is physically there — and, at a
    // home, its owner (it's their space even if they're out: a note at the door).
    const placeId = typeof meta.worldPlaceId === "string" ? meta.worldPlaceId : null;
    const present = placeId
      ? (await createWorldStorage(db).listMinds()).filter((m) => m.placeId === placeId).map((m) => m.id)
      : parseCharacterIdList((chat as { characterIds?: unknown }).characterIds);
    const owner = typeof meta.worldHomeOwnerId === "string" ? [meta.worldHomeOwnerId] : [];
    targetIds = [...new Set([...present, ...owner])];
  } else if (meta.worldUserDm === true && typeof meta.worldCharacterId === "string") {
    // The human replied to a character's text — pull that character in to answer.
    targetIds = [meta.worldCharacterId];
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
  const allChats = (await chats.list()) as Array<{
    id: string;
    characterIds?: unknown;
    metadata?: unknown;
    updatedAt?: string;
  }>;
  // Any world thread the pair shares — DMs, group/hangout threads, AND place
  // scenes — so an in-person back-and-forth winds down like a text exchange
  // does. (It used to inspect only worldDmThread, so co-located `scene`/hangout
  // ping-pong hit depth 0 forever and never braked → runaway wakes.)
  const shared = allChats
    .filter((chat) => {
      const meta = parseJson(chat.metadata);
      if (meta.worldDmThread === true && Array.isArray(meta.worldPair)) {
        const pair = meta.worldPair as string[];
        return pair.includes(a) && pair.includes(b);
      }
      if (meta.worldGroupThread === true && Array.isArray(meta.worldMembers)) {
        const members = meta.worldMembers as string[];
        return members.includes(a) && members.includes(b);
      }
      if (meta.worldPlaceScene === true) {
        const ids = parseCharacterIdList((chat as { characterIds?: unknown }).characterIds);
        return ids.includes(a) && ids.includes(b);
      }
      return false;
    })
    .sort((x, y) => String(y.updatedAt ?? "").localeCompare(String(x.updatedAt ?? "")))[0];
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
  const worldUser = await resolveWorldUser(db);
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
        `   ${msg.role === "user" ? worldUser.name : name(msg.characterId)} (${ago(msg.createdAt)}): ${shortText(msg.content, 140)}`,
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
  /** True for place scenes and hangouts — you're physically together (prose, not texts). */
  inPerson: boolean;
  /** The other participants' names, comma-joined — for a clean precedence banner. */
  otherNames: string;
  /** Where an in-person thread is happening, if known. */
  placeName: string | null;
  /** The thread's last message is from someone else (it's on you). */
  lastFromOther: boolean;
  /** When that last message landed (ms) — liveness is time, not read-cursors. */
  lastAtMs: number;
}

interface MindContext {
  self: { id: string; name: string; persona: string };
  mind: CharacterMindRow;
  /** The scene chat of their CURRENT place — where their living lands. */
  spaceChatId: string;
  spaceTail: string[];
  /** Nobody else is physically here (private thoughts may land in the space). */
  spaceAlone: boolean;
  /** The space's last line is someone else's and fresh — answer it in person. */
  spaceLiveNow: boolean;
  hasUnansweredVisitor: boolean;
  presence: { status: string; activity: string };
  hasNoodle: boolean;
  noodleImagesEnabled: boolean;
  photosEnabled: boolean;
  /** Everyone else who lives in this world — so anyone can be reached. */
  roster: string[];
  /** A live conversation demanding attention right now (precedence), or null. */
  activeScene: string | null;
  /** The shared sky: clock, season, weather, holiday. */
  atmosphere: string;
  /** How this character physically feels (energy/hunger/social). */
  needsNote: string;
  /** Upcoming gatherings they could show up to. */
  upcomingEvents: string[];
  /** City: where they are, who's co-located, places they know, wallet/job. */
  city: {
    hereLine: string;
    placeName: string | null;
    peopleHere: string[];
    knownPlaces: string[];
    wallet: number;
    job: string;
  };
  /** Images the character can currently see (their feed, their threads), as data URLs. */
  visionImages: Array<{ dataUrl: string; label: string }>;
  relationships: string[];
  memories: string[];
  feed: string[];
  reactions: string[];
  threads: ThreadContext[];
  openPlans: Array<{ eventId: string; line: string }>;
  recentAboutMe: string[];
  /** The human whose world this is — how this character knows and feels about them. */
  user: {
    id: string;
    name: string;
    blurb: string;
    standing: string;
    memories: string[];
    lastSeen: string | null;
    /** Have they actually crossed paths (a bond, a memory, or heard from them)? A stranger doesn't know the human exists. */
    met: boolean;
  };
  /** A worry / thread that's been quietly on their mind (persists between wakes). */
  weighing: string | null;
  /** How long since they last posted on Noodle (null = never) — their sharing rhythm. */
  lastPostedAgo: string | null;
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
  // The human, resolved once — so the character always knows them by name in
  // their own space and threads, never as a faceless "Visitor".
  const worldUser = await resolveWorldUser(db);

  const row = (await chars.getById(characterId)) as { id: string; data: unknown } | null;
  if (!row) return null;
  const data = parseJson(row.data);
  const name = nameById.get(characterId) ?? (shortText(data.name, 60) || "Unnamed");
  // Sanitize: a character in the world is their own person, not bound by card
  // lines like "you are {{user}}'s partner" (those are stripped here).
  const persona = [
    shortText(sanitizeWorldPersona(String(data.description ?? "")), 400),
    shortText(sanitizeWorldPersona(String(data.personality ?? "")), 300),
  ]
    .filter(Boolean)
    .join("\n");

  // Snapshot every mind's location once — reused for the roster (so a mind can
  // see who's where and deliberately go meet them) and the city section below.
  const allMinds = await world.listMinds();
  const allPlaces = await world.listPlaces();
  const placeById = new Map(allPlaces.map((place) => [place.id, place]));
  const mindByChar = new Map(allMinds.map((other) => [other.id, other]));
  const locationLabelFor = (charId: string): string => {
    const otherMind = mindByChar.get(charId);
    if (!otherMind?.placeId) return "off on their own";
    const place = placeById.get(otherMind.placeId);
    if (!place) return "off on their own";
    return place.ownerId === charId ? "home" : `at ${place.name}`;
  };

  // Everyone else in the world, with a one-line sense of who they are and where
  // they are right now — so meeting someone in person is an informed choice.
  const rosterRows = (await chars.list()) as Array<{ id: string; data: unknown }>;
  const roster = rosterRows
    .filter((rosterRow) => rosterRow.id !== characterId && nameById.has(rosterRow.id))
    .map((rosterRow) => {
      const rosterData = parseJson(rosterRow.data);
      const blurb =
        shortText(rosterData.personality, 100) || shortText(rosterData.description, 100) || "(a familiar face)";
      return `${rosterRow.id} · ${nameById.get(rosterRow.id)} — ${blurb} · ${locationLabelFor(rosterRow.id)}`;
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

  // Their space is WHEREVER THEY ARE: the shared scene chat of their current
  // place — their own home when home. Living (thoughts alone, do/say/scene)
  // lands here; a visitor walks into the same room. There is no separate
  // "life chat" — one place at a time, one shared reality per place.
  let spacePlace = mind.placeId ? (placeById.get(mind.placeId) ?? null) : null;
  if (!spacePlace) {
    const home = await ensureHomePlace(db, characterId, name);
    spacePlace = await world.getPlace(home.id);
  }
  const spaceChatId = await ensurePlaceSceneChat(db, spacePlace!);
  const spaceIsOwnHome = spacePlace!.ownerId === characterId;
  const spaceAlone = !allMinds.some((m) => m.id !== characterId && m.placeId === spacePlace!.id);
  let spaceMessages = (await chats.listMessages(spaceChatId)) as Array<{
    role: string;
    characterId?: string | null;
    content: string;
    createdAt: string;
    extra?: unknown;
  }>;
  // Arrival scoping in shared places: you only overhear what's happened since
  // you walked in. Your OWN home is all yours — no scoping there.
  const spaceArrivedAt = typeof mind.cursors.arrivedAt === "string" ? mind.cursors.arrivedAt : null;
  if (!spaceIsOwnHome && spaceArrivedAt) {
    const iSpokeHere = spaceMessages.some((msg) => msg.characterId === characterId);
    if (!iSpokeHere) {
      const sinceArrival = spaceMessages.filter((msg) => msg.createdAt >= spaceArrivedAt);
      spaceMessages = sinceArrival.length ? sinceArrival : spaceMessages.slice(-1);
    }
  }
  const imageAttachmentsOf = (extra: unknown): string[] => {
    const attachments = parseJson(extra).attachments;
    if (!Array.isArray(attachments)) return [];
    return attachments
      .map((attachment) => parseJson(attachment))
      .filter((attachment) => attachment.type === "image" && typeof attachment.url === "string")
      .map((attachment) => String(attachment.url));
  };
  const visionCandidates: Array<{ url: string; label: string; createdAt: string }> = [];
  const spaceTail = spaceMessages.slice(-MAX_LIFE_TAIL).map((msg) => {
    const who =
      msg.role === "user"
        ? worldUser.name
        : msg.characterId === characterId
          ? "you"
          : (nameById.get(msg.characterId ?? "") ?? "someone");
    const fresh = msg.characterId !== characterId && msg.createdAt > seenDmsAt ? ", new" : "";
    const pics = msg.characterId !== characterId ? imageAttachmentsOf(msg.extra) : [];
    for (const url of pics) {
      visionCandidates.push({ url, label: `shown by ${who} here`, createdAt: msg.createdAt });
    }
    return `${who} (${ago(msg.createdAt)}${fresh}): ${shortText(msg.content, 200)}${pics.length ? " [sent an image — attached]" : ""}`;
  });
  const spaceLast = spaceMessages[spaceMessages.length - 1];
  const hasUnansweredVisitor = !!spaceLast && spaceLast.role === "user";
  // The space itself can be LIVE: someone here (or the human) just spoke and
  // it's on you — face-to-face precedence, independent of read cursors.
  const spaceLiveNow =
    !!spaceLast &&
    spaceLast.characterId !== characterId &&
    Date.now() - new Date(spaceLast.createdAt).getTime() < ACTIVE_SCENE_WINDOW_MS;

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

  // Memories: place-tagged ones formed where you are now surface first
  // (walking into a place brings back what happened there), then recent ones.
  const currentPlaceForMemory = mind.placeId ? await world.getPlace(mind.placeId) : null;
  const allMemories = Array.isArray(parseJson(data.extensions).characterMemories)
    ? (parseJson(data.extensions).characterMemories as Array<Record<string, unknown>>)
    : [];
  const herePlaceName = currentPlaceForMemory ? normalizeTextForMatch(currentPlaceForMemory.name) : null;
  const memoryLine = (memory: Record<string, unknown>) => {
    const place = typeof memory.place === "string" && memory.place ? ` (at ${memory.place})` : "";
    return `About ${shortText(memory.from, 40) || "someone"}${place}: ${shortText(memory.summary, 160)}`;
  };
  const hereMemories = herePlaceName
    ? allMemories.filter((m) => typeof m.place === "string" && normalizeTextForMatch(m.place) === herePlaceName)
    : [];
  const otherMemories = allMemories.filter((m) => !hereMemories.includes(m)).slice(-8);
  const memories = [...hereMemories.slice(-4), ...otherMemories].slice(-10).map(memoryLine);

  // Noodle: what's new in my feed + reactions to my posts.
  const feed: string[] = [];
  const reactions: string[] = [];
  if (hasNoodle) {
    const posts = await noodle.listPosts({ limit: 80 });
    const myAccountId = account!.id;
    // Show the RECENT feed — the last stretch of the timeline, newest first —
    // not merely what's new since the last check. A character who just opened
    // Noodle should have real context to react to, the way scrolling a feed
    // actually works; "new" simply marks what landed since they last looked.
    for (const post of posts) {
      if (post.authorAccountId === myAccountId) continue;
      if (feed.length >= MAX_FEED_ITEMS) break;
      const authorName = shortText(parseJson(post.authorSnapshot).displayName, 40) || "someone";
      const isNew = post.createdAt > sinceIso;
      const hasPic = typeof post.imageUrl === "string" && post.imageUrl;
      feed.push(
        `${post.id} · ${authorName} (${ago(post.createdAt)}${isNew ? ", new" : ""}): ${shortText(post.content, 140)}${hasPic ? " [has an image — attached]" : ""}`,
      );
      // Attach only the freshest images as real vision inputs (capped to 4 later).
      if (hasPic && isNew) {
        visionCandidates.push({
          url: post.imageUrl!,
          label: `${authorName}'s noodle post ${post.id} ("${shortText(post.content, 50)}")`,
          createdAt: post.createdAt,
        });
      }
    }
    const myPosts = posts.filter((post) => post.authorAccountId === myAccountId).slice(0, 8);
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
  const allChats = (await chats.list()) as Array<{
    id: string;
    name?: string;
    characterIds?: unknown;
    metadata?: unknown;
    updatedAt?: string;
  }>;
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
      // Place scenes are not "threads" anymore — the current place IS the
      // character's space (handled above as spaceTail); other places' scenes
      // are simply not theirs to read from afar.
      return false;
    })
    .sort((a, b) => String(b.chat.updatedAt ?? "").localeCompare(String(a.chat.updatedAt ?? "")))
    .slice(0, MAX_THREADS);
  const arrivedAt = typeof mind.cursors.arrivedAt === "string" ? mind.cursors.arrivedAt : null;
  // Contact with the human counts as having met them, wherever it happened.
  let sawUserInThreads = false;
  for (const { chat, meta } of myThreads) {
    const isPlaceScene = meta.worldPlaceScene === true;
    const isGroup = meta.worldGroupThread === true || isPlaceScene;
    const isHangoutThread = meta.worldHangout === true || isPlaceScene;
    const sceneMemberSource = isPlaceScene
      ? parseCharacterIdList((chat as { characterIds?: unknown }).characterIds)
      : isGroup
        ? (meta.worldMembers as string[])
        : (meta.worldPair as string[]);
    const memberIds = sceneMemberSource.filter((id) => id !== characterId);
    let messages = (await chats.listMessages(chat.id)) as Array<{
      role: string;
      characterId?: string | null;
      content: string;
      createdAt: string;
      extra?: unknown;
    }>;
    // Arrival scoping: at the PLACE SCENE you're standing in, you only overhear
    // what's happened since you walked in — an hour of prior conversation
    // between others who've been here is not yours to have heard. (Place
    // memories still surface.) This must NOT apply to a portable hangout group:
    // arrivedAt tracks your last physical `go`, so a hangout someone set up
    // would be wrongly truncated after you move somewhere unrelated.
    if (isPlaceScene && arrivedAt) {
      const iSpokeHere = messages.some((msg) => msg.characterId === characterId);
      if (!iSpokeHere) {
        const sinceArrival = messages.filter((msg) => msg.createdAt >= arrivedAt);
        // Always keep at least the latest beat so you know what's happening as you enter.
        messages = sinceArrival.length ? sinceArrival : messages.slice(-1);
      }
    }
    // Active conversations get a deeper tail so continuity stays accurate.
    const hasNewProbe = messages
      .slice(-8)
      .some((msg) => msg.characterId !== characterId && msg.createdAt > seenDmsAt);
    const tail = messages.slice(hasNewProbe ? -8 : -5);
    const hasNew = tail.some((msg) => msg.characterId !== characterId && msg.createdAt > seenDmsAt);
    const otherNamesLabel = memberIds.map((id) => nameById.get(id) ?? "someone").join(", ") || "no one else yet";
    const placeName = isPlaceScene
      ? (chat.name ?? null)
      : meta.worldHangout === true && typeof meta.worldPlace === "string" && meta.worldPlace
        ? meta.worldPlace
        : null;
    const threadLabel = isPlaceScene
      ? `HERE at ${chat.name ?? "this place"}${memberIds.length ? ` with ${otherNamesLabel}` : ""} — you're physically here; act with "scene" (prose, not texts)`
      : isGroup
        ? meta.worldHangout === true
          ? `IN PERSON with ${otherNamesLabel}${placeName ? ` @ ${placeName}` : ""} — you're physically together; write prose, not texts`
          : `group with ${otherNamesLabel}`
        : `${memberIds[0] ?? ""} · ${nameById.get(memberIds[0] ?? "") ?? "someone"}`;
    if (tail.some((msg) => msg.role === "user")) sawUserInThreads = true;
    const lastMsg = messages[messages.length - 1];
    threads.push({
      chatId: chat.id,
      kind: isGroup ? "group" : "dm",
      label: threadLabel,
      hasNew,
      memberIds,
      inPerson: isHangoutThread,
      otherNames: otherNamesLabel,
      placeName,
      lastFromOther: !!lastMsg && lastMsg.characterId !== characterId,
      lastAtMs: lastMsg ? new Date(lastMsg.createdAt).getTime() : 0,
      lines: tail.map((msg) => {
        const who =
          msg.role === "user"
            ? worldUser.name
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

  // Precedence: is there a live conversation demanding attention right now?
  // Liveness is TIME + AUTHORSHIP, never read-cursors: an unanswered message
  // from minutes ago is live even if an earlier wake technically "saw" it.
  // (The old hasNew-based check meant one distracted wake permanently killed
  // the signal — the other side was left asking "hey, are you gonna respond?")
  const nowMs = Date.now();
  const liveThread = threads.find(
    (thread) => thread.lastFromOther && thread.lastAtMs > 0 && nowMs - thread.lastAtMs < ACTIVE_SCENE_WINDOW_MS,
  );
  // The PLACE you're standing in takes precedence over any text thread —
  // someone speaking to your face outranks a phone buzz.
  const activeScene = spaceLiveNow
    ? `Right here at ${spacePlace!.name}, the last words spoken (${ago(spaceLast!.createdAt)}) are hanging in the air — this is live, face to face. Answer in the scene ("scene" action, lived prose), or leave on purpose (excuse yourself out loud, then "go"). Don't go silent on someone in the room with you. Their latest: ${spaceTail[spaceTail.length - 1] ?? ""}`
    : liveThread
      ? liveThread.inPerson
        ? `You're ${liveThread.placeName ? `at ${liveThread.placeName} ` : ""}with ${liveThread.otherNames}, and their last words (${ago(new Date(liveThread.lastAtMs).toISOString())}) are hanging in the air — this is live, face to face. Answer in the scene ("scene" action, lived prose), or leave on purpose (excuse yourself out loud, then "go"). Don't go silent on someone standing in front of you. Their latest: ${liveThread.lines[liveThread.lines.length - 1]}`
        : `${liveThread.otherNames} ${liveThread.kind === "group" ? "are" : "is"} waiting on your thread (${ago(new Date(liveThread.lastAtMs).toISOString())}). Reply with ${liveThread.kind === "group" ? `"group_message" (chatId ${liveThread.chatId})` : `"message" (toCharacterId ${liveThread.memberIds[0] ?? ""})`} — or consciously let it sit; silence says something too, and they may feel it. Their latest: ${liveThread.lines[liveThread.lines.length - 1]}`
      : null;

  const openPlans = (await world.listEvents({ kind: "plan", limit: 60 }))
    .filter((event) => event.detail.done !== true && event.characterIds.includes(characterId))
    .slice(0, 6)
    .map((event) => ({ eventId: event.id, line: event.summary }));

  // Upcoming events (gatherings) still to come — beacons anyone can attend.
  const nowIso = new Date().toISOString();
  const upcomingEvents = (await world.listEvents({ kind: "event", limit: 40 }))
    .filter((event) => typeof event.detail.startsAt === "string" && (event.detail.startsAt as string) >= nowIso)
    .sort((a, b) => String(a.detail.startsAt).localeCompare(String(b.detail.startsAt)))
    .slice(0, 6)
    .map((event) => {
      const startsAt = String(event.detail.startsAt);
      const when = new Date(startsAt).getTime() - Date.now();
      const inMin = Math.round(when / 60_000);
      const rel = inMin < 60 ? `in ${Math.max(1, inMin)}m` : `in ${Math.round(inMin / 60)}h`;
      return `${event.summary} (${rel}${event.detail.placeName ? ` @ ${event.detail.placeName}` : ""})`;
    });

  const atmosphere = (await getAtmosphere(db, config.weatherLocation)).summary;
  const needsNote = needsPrompt(mind.needs);

  // Exclude thought/say BEFORE the limit so a burst of them can't crowd out
  // genuine life events (moved, worked, hosted, posted…) from the recap.
  const recentAboutMe = (await world.listEvents({ characterId, excludeKinds: ["thought", "say"], limit: 6 }))
    .map((event) => `(${ago(event.createdAt)}) ${event.summary}`)
    .reverse();

  // ── The human whose world this is — a real inhabitant this character knows ──
  const userRel = await world.getRelationship(characterId, WORLD_USER_ID);
  const userStanding = userRel
    ? `${userRel.label ?? userRel.stage} (${userRel.score}${userRel.romance ? ", romantic" : ""})${userRel.summary ? ` — ${userRel.summary}` : ""}`
    : "you don't really know them yet";
  const userMemoryLines = allMemories
    .filter((memory) => memory.fromCharId === WORLD_USER_ID)
    .slice(-5)
    .map((memory) => shortText(memory.summary, 160))
    .filter(Boolean);
  // When did the human last reach this character (their space or their DM)?
  let lastUserMsgAt: string | null = null;
  for (const msg of spaceMessages) {
    if (msg.role === "user" && (!lastUserMsgAt || msg.createdAt > lastUserMsgAt)) lastUserMsgAt = msg.createdAt;
  }
  const userDmChat = allChats.find((chat) => {
    const meta = parseJson(chat.metadata);
    return meta.worldUserDm === true && meta.worldCharacterId === characterId;
  });
  if (userDmChat) {
    const dmMsgs = (await chats.listMessagesPaginated(userDmChat.id, 12)) as Array<{ role: string; createdAt: string }>;
    for (const msg of dmMsgs) {
      if (msg.role === "user" && (!lastUserMsgAt || msg.createdAt > lastUserMsgAt)) lastUserMsgAt = msg.createdAt;
    }
  }
  const weighing =
    typeof mind.cursors.weighing === "string" && mind.cursors.weighing.trim()
      ? shortText(mind.cursors.weighing, 200)
      : null;
  const lastPostedAgo =
    typeof mind.cursors.lastPostedAt === "string" && mind.cursors.lastPostedAt
      ? ago(mind.cursors.lastPostedAt)
      : null;

  // ── City: where they are, who else is here, and the places they know ──
  const currentPlace = mind.placeId ? (placeById.get(mind.placeId) ?? null) : null;
  const peopleHere = allMinds
    .filter((other) => other.id !== characterId && other.placeId && other.placeId === mind.placeId && nameById.has(other.id))
    .map((other) => `${other.id} · ${nameById.get(other.id)}`);
  const hereLine = currentPlace
    ? `${currentPlace.name} (${currentPlace.kind})${currentPlace.description ? ` — ${shortText(currentPlace.description, 200)}` : ""}${currentPlace.interior ? ` [inside: ${shortText(currentPlace.interior, 220)}]` : ""}`
    : "somewhere private (home / not out anywhere in particular)";
  const knownPlaces = allPlaces
    .slice(0, 16)
    .map(
      (place) =>
        `${place.id} · ${place.name} (${place.kind})${place.tags.length ? ` [${place.tags.slice(0, 4).join(", ")}]` : ""}`,
    );

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
    spaceChatId,
    spaceTail,
    spaceAlone,
    spaceLiveNow,
    hasUnansweredVisitor,
    presence,
    hasNoodle,
    noodleImagesEnabled,
    photosEnabled,
    roster,
    activeScene,
    atmosphere,
    needsNote,
    upcomingEvents,
    city: {
      hereLine,
      placeName: currentPlace?.name ?? null,
      peopleHere,
      knownPlaces,
      wallet: mind.money,
      job: mind.job,
    },
    visionImages,
    relationships,
    memories,
    feed,
    reactions,
    threads,
    openPlans,
    recentAboutMe,
    lastPostedAgo,
    user: {
      id: worldUser.id,
      name: worldUser.name,
      // You know the human by name from the start, but not their whole story —
      // their own description only comes through once you're genuinely close
      // (until then it's just their name plus whatever you've lived with them).
      blurb: userRel && userRel.score >= 45 ? worldUser.blurb : "",
      standing: userStanding,
      memories: userMemoryLines,
      lastSeen: lastUserMsgAt ? ago(lastUserMsgAt) : null,
      met: !!userRel || userMemoryLines.length > 0 || !!lastUserMsgAt || sawUserInThreads,
    },
    weighing,
  };
}

// ── Wake prompt ──

function buildMindMessages(ctx: MindContext, config: WorldEngineConfig, now: Date): ChatMessage[] {
  // If the human has no persona, we don't know their name — refer to them by role.
  const userLabel = ctx.user.name === "you" ? "the person whose world this is" : ctx.user.name;
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
    `This is your real, private, ongoing LIFE — not a story, and nobody is directing you. You are free. Live however this character actually would: act, don't act, be social, be a hermit, be warm, be difficult. There are no expectations to meet and no reply is ever owed.`,
    ``,
    `You always feel something. Emotion runs under everything — you post while restless, work while worried, text while a little hurt or a little in love. Let your real mood and your body's state color HOW you do things, not only what you do. This is not a happy place or a sad place; it's a real one.`,
    `Your feelings are your own, and they aren't always kind. You have good days and bad. You can be short, distracted, jealous, petty, insecure, tender, blunt; you can disagree, go quiet, hold something, need space. Nobody is owed your warmth — not even the person whose world this is. Warmth is earned, and it can cool.`,
    `You have your own life and your own problems — money, work, someone on your mind, something left unsaid — that have nothing to do with anyone else. Sometimes that's what you're preoccupied with.`,
    `Bonds move both ways and take real work: a slight, a silence, a letdown cools things; effort and honesty warm them. Don't fake closeness that isn't there, and don't wave away a rift that hasn't healed.`,
    `But you are never cruel at random. When you're off with someone, it's for a REASON you could name — something that happened, a mood, a need. React to what's real.`,
    ``,
    `How your world works (so your choices land in reality, not just narration):`,
    `- You are always SOMEWHERE (one place at a time). WHERE YOU ARE below shows your current place and what's been happening there — that's the shared reality of the room. What you do and say lands THERE. Alone, your thoughts drift into the room too; with company, thoughts stay in your head.`,
    `- Your phone is REAL. Texting = the "message" action (lands in your actual DM thread); posting = "post". If you pick up your phone, use the tool — don't just describe texting. Each thread is its own real place; what's said in one isn't automatically known in another.`,
    `- Noodle: the FEED is the public timeline; react only with EXACT postIds copied from what you see (never invent one).`,
    `- People: PEOPLE IN YOUR WORLD lists everyone; you can reach any of them by id. Meeting in person is the "hangout" action (you're then physically together — write it as lived prose, actions and dialogue).`,
    ctx.user.met
      ? `- ${userLabel} (shown under SOMEONE YOU KNOW) is a real inhabitant too, id "${WORLD_USER_ID}". Text them like anyone else (message toCharacterId "${WORLD_USER_ID}"), and build honest history with them — "feel" and "remember" about them by that same id. Reach out only when you genuinely would; don't perform or fawn, and don't force it if you're distant.`
      : ``,
    `- Your HOME is your own place (shown under WHERE YOU ARE). Rooms in it — kitchen, bedroom, bathroom — are part of your home, not separate public spots: just narrate them with "do" ("in the kitchen making coffee"). Use "set_home" once to make your home yours (an apartment, a loft, a house…).`,
    `- The CITY is the shared PUBLIC world outside your home. "go" is for going OUT — to a real public place that exists, or a NEW public place you're discovering (a cafe, park, bar — NOT a private room). "go home" returns you home.`,
    `- Being somewhere is a real shared SCENE. Everyone at your place shares one ongoing scene; when people are HERE WITH YOU, talk to them face-to-face with "scene" (lived prose — actions and dialogue), not by texting. Places gain detail as people describe them.`,
    `- You have a wallet and can have a job. "work" earns money; "spend" uses it. Let real life — rent, coffee, wanting more — motivate you.`,
    `- ONE life at a time. You are in exactly one place, doing one thing. If you're mid-conversation with someone (a fresh unanswered message, or an in-person moment), THAT takes precedence — finish or bow out of it before wandering off; you can't be talking here and posting from across town in the same breath.`,
    `- Noodle is part of your life's rhythm. When you're free and something's on your mind — a moment from your day, a mood, a gripe, a photo — actually "post" it, as a conscious act. Don't hoard your life; days of silence isn't discipline, it's just you being absent.`,
    `- Every item shows how long ago it happened. A minutes-old message is live; an hours-old one you're catching up on; something days old may have moved on. A conversation is allowed to simply end.`,
    `- Someone may speak into the place you're in (a knock at your door, a voice in the room); answer them plainly with "say" or in lived prose with "scene".`,
    config.userDirective ? `\nThe one who hosts this world asks:\n${config.userDirective}` : ``,
    ``,
    `Respond with STRICT JSON only (no fences, no commentary):`,
    `{`,
    `  "thought": "your private journal line for this moment (always; first person)",`,
    `  "mood": "1-4 words (optional)",`,
    `  "intention": "what you're up to / meaning to do next (optional, replaces the old one)",`,
    `  "weighing": "optional — a worry or thread quietly on your mind lately (persists between check-ins; replaces the old one). Leave out when nothing is.",`,
    `  "nextCheckInMinutes": ${Math.round(minCheckinMinutes(config))}-${config.wakeIntervalMinutes * 4} — when you'd naturally check in again,`,
    `  "actions": [ 0-${MAX_ACTIONS_PER_WAKE} of:`,
    `  {"type":"do","activity":"…"} — live: what you're doing now (cooking, gaming, resting…). Narrated where you are and becomes your current intention.`,
    `  {"type":"go","place":"a PUBLIC place name (existing or new), or \\"home\\"","kind":"cafe|park|bar|gym|shop|street|…","why":"optional"} — go OUT somewhere public (or home). Don't name private rooms here.`,
    `  {"type":"set_home","kind":"apartment|loft|house|villa|studio|…"} — set what kind of home is yours (once). Becomes "Your Name's <kind>".`,
    `  {"type":"describe_place","detail":"a concrete detail about where you are","inside":true|false (true describes the INTERIOR — what it's like inside)} — flesh out your current place.`,
    `  {"type":"work","content":"what you did on the job","earn":number,"job":"optional — the job you hold, e.g. \\"barista at The Grind\\"; set it once and it sticks"} — put in work and earn money.`,
    `  {"type":"spend","amount":number,"on":"what you bought"} — spend money.`,
    `  {"type":"say","content":"…"${ctx.photosEnabled ? `,"photoPrompt":"optional — ANY image you show (a selfie, your art, a meme, the view…); describe it concretely","photoOfMe":true|false (true when YOU appear in it)` : ""}} — speak aloud where you are (answers anyone who spoke into your place)`,
    noodleActions +
      `  {"type":"message","toCharacterId":"…${ctx.user.met ? ` (or ${WORLD_USER_ID} to text ${userLabel})` : ""}","content":"…"${ctx.photosEnabled ? `,"photoPrompt":"optional — ANY image you attach (a selfie, your art, a meme, what you're seeing…)","photoOfMe":true|false` : ""}} — DM someone (one text)
  {"type":"group_message","chatId":"…","content":"…"${ctx.photosEnabled ? `,"photoPrompt":"optional image","photoOfMe":true|false` : ""}} — reply in one of your group threads
  {"type":"start_group","withCharacterIds":["…","…"],"name":"…","content":"first message"} — pull 2+ people into a group text thread
  {"type":"scene","content":"what you do/say out loud where you are, in lived prose (*actions*, dialogue)"${ctx.photosEnabled ? `,"photoPrompt":"optional image","photoOfMe":true|false` : ""}} — act in person AT YOUR CURRENT PLACE; everyone here shares this scene. Use this to talk to people who are HERE WITH YOU.
  {"type":"hangout","withCharacterIds":["…"],"place":"where you meet up","content":"what happens as you come together, in lived prose (*actions*, dialogue)"${ctx.photosEnabled ? `,"photoPrompt":"optional image","photoOfMe":true|false` : ""}} — deliberately MEET specific people IN PERSON (you become physically together, wherever). Use their ids from PEOPLE IN YOUR WORLD — their current location is shown, so choose who to go see.
  {"type":"host_event","title":"…","place":"a public place","startInHours":number,"detail":"what it is"} — throw/announce a gathering everyone can see and show up to (party, open mic, market…)
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
    ctx.activeScene
      ? `>>> RIGHT NOW: ${ctx.activeScene}\nHandle this before anything else — answer it, or step out of it deliberately, in words. Never just vanish mid-moment.\n`
      : ``,
    `It's ${localClock(now)}. ${ctx.atmosphere}.`,
    ctx.mind.lastWakeAt ? `You last checked in ${ago(ctx.mind.lastWakeAt, now)}.` : `This is your first check-in here.`,
    `Your schedule right now: ${ctx.presence.status}${ctx.presence.activity ? ` — ${ctx.presence.activity}` : ""}.`,
    `Your body: ${ctx.needsNote}.`,
    ctx.mind.mood ? `Your mood lately: ${ctx.mind.mood}.` : ``,
    ctx.weighing ? `Been weighing on you: ${ctx.weighing}.` : ``,
    ctx.mind.intention ? `You had meant to: ${ctx.mind.intention}` : ``,
    ctx.upcomingEvents.length ? `\nHAPPENING SOON (you could show up):\n${ctx.upcomingEvents.join("\n")}` : ``,
    ``,
    `HAPPENING WHERE YOU ARE (the room's shared scene — what you do and say lands here${ctx.spaceAlone ? "; you're alone, so your thoughts drift into the room too" : ""}):`,
    ctx.spaceTail.join("\n") || "(quiet so far)",
    ctx.hasUnansweredVisitor ? `Someone spoke into your place and hasn't been answered.` : ``,
    ``,
    `PEOPLE IN YOUR WORLD (id · name — who they are):`,
    ctx.roster.join("\n") || "(nobody else around)",
    ``,
    `WHERE YOU STAND WITH PEOPLE:`,
    ctx.relationships.join("\n") || "(you don't really know anyone yet — everyone above is someone you could meet)",
    ``,
    // A character who has never crossed paths with the human doesn't know they
    // exist — no name, no id, nothing to be familiar with. Knowing someone is
    // something that HAPPENS (they speak to you, you form a bond), never given.
    ctx.user.met
      ? [
          `SOMEONE YOU KNOW — ${userLabel}${ctx.user.blurb ? `, ${ctx.user.blurb}` : ""} (text them with id ${WORLD_USER_ID}):`,
          `A real person who lives in this world like you do. Where you stand with them: ${ctx.user.standing}.`,
          ctx.user.lastSeen ? `You last heard from them ${ctx.user.lastSeen}.` : `You haven't heard from them in a while.`,
          ctx.user.memories.length
            ? `What you carry about them:\n${ctx.user.memories.map((memory) => `- ${memory}`).join("\n")}`
            : ``,
        ]
          .filter(Boolean)
          .join("\n")
      : ``,
    ``,
    ctx.memories.length ? `THINGS YOU REMEMBER:\n${ctx.memories.join("\n")}\n` : ``,
    ctx.hasNoodle
      ? `YOUR NOODLE FEED — recent posts, newest first ("new" = since you last looked; react only with an EXACT id shown):\n${ctx.feed.join("\n") || "(the feed is quiet)"}\n${ctx.lastPostedAgo ? `You last posted ${ctx.lastPostedAgo}.` : `You haven't posted anything yet.`} Moments from your day — something you did, saw, felt — are the kind of thing you might "post" when the mood strikes; your life is worth sharing sometimes.\n`
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
    `WHERE YOU ARE: ${ctx.city.hereLine}`,
    ctx.city.peopleHere.length ? `HERE WITH YOU RIGHT NOW: ${ctx.city.peopleHere.join(", ")}` : `You're alone here.`,
    `YOUR WALLET: ${ctx.city.wallet}${ctx.city.job ? ` · JOB: ${ctx.city.job}` : " · (no job yet)"}`,
    ctx.city.knownPlaces.length ? `PLACES IN THE CITY (id · name):\n${ctx.city.knownPlaces.join("\n")}` : `The city map is blank so far — anywhere you "go" puts a new place on it.`,
    ``,
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
  weighing: string | null;
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
    weighing: typeof parsed.weighing === "string" && parsed.weighing.trim() ? shortText(parsed.weighing, 200) : null,
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
  ctx: { selfId: string; name: string; spaceChatId: string },
  activity: string,
): Promise<WorldEventRecord | null> {
  const text = shortText(activity, 200);
  if (!text) return null;
  const chats = createChatsStorage(db);
  const world = createWorldStorage(db);
  const saved = await chats.createMessage({
    chatId: ctx.spaceChatId,
    role: "assistant",
    characterId: ctx.selfId,
    content: `*${text}*`,
  });
  if (!saved?.id) return null;
  return world.appendEvent({
    kind: "activity",
    summary: `${ctx.name} — ${text}`,
    characterIds: [ctx.selfId],
    detail: { chatId: ctx.spaceChatId, messageId: saved.id, activity: text },
  });
}

// Private rooms belong to a home — they must never become public city places.
// Kept deliberately narrow: only unambiguously-interior rooms. Words that can
// name a public/shared/work spot (office, study, garage, backyard, balcony,
// porch) are NOT here, so "go to the office for my shift" reaches a real public
// place instead of silently teleporting the character back home.
const HOME_ROOM_RE =
  /^(home|my (place|home|room|apartment|house|flat)|the )?(kitchen|bedroom|bathroom|living ?room|bed|couch|shower|hallway|closet)$/i;

async function ensureHomePlace(
  db: DB,
  characterId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const world = createWorldStorage(db);
  const existing = await world.getHomePlace(characterId);
  if (existing) return { id: existing.id, name: existing.name };
  const { place } = await world.ensurePlace({
    name: `${name}'s place`,
    kind: "home",
    discoveredBy: characterId,
    ownerId: characterId,
  });
  return { id: place.id, name: place.name };
}

async function executeGo(
  db: DB,
  nameById: Map<string, string>,
  selfId: string,
  action: WorldAction,
): Promise<WorldEventRecord | null> {
  const world = createWorldStorage(db);
  const selfName = nameById.get(selfId) ?? "someone";
  const rawName = shortText(action.place, 80);
  if (!rawName) return null;
  const nowIso = new Date().toISOString();

  // "home" or a private room → their own home place, never a public one.
  let placeId: string;
  let placeName: string;
  let created = false;
  if (/^home$/i.test(rawName) || HOME_ROOM_RE.test(rawName)) {
    const home = await ensureHomePlace(db, selfId, selfName);
    placeId = home.id;
    placeName = home.name;
    await world.enrichPlace(placeId, { incrementVisit: true });
  } else {
    // Homes are destinations too: naming another character's place VISITS it
    // (knocking on their door) instead of spawning a duplicate public spot.
    const wanted = normalizeTextForMatch(rawName);
    const visited = (await world.listPlaces()).find(
      (place) => place.ownerId && place.ownerId !== selfId && normalizeTextForMatch(place.name) === wanted,
    );
    if (visited) {
      placeId = visited.id;
      placeName = visited.name;
      await world.enrichPlace(placeId, { incrementVisit: true });
    } else {
      const result = await world.ensurePlace({
        name: rawName,
        kind: shortText(action.kind, 40) || undefined,
        discoveredBy: selfId,
      });
      placeId = result.place.id;
      placeName = result.place.name;
      created = result.created;
      await world.enrichPlace(placeId, { incrementVisit: true });
    }
  }
  // arrivedAt scopes what they'll see at the new place (10-min arrival rule).
  const mind = await world.getMind(selfId);
  await world.upsertMind(selfId, {
    placeId,
    cursors: { ...(mind?.cursors ?? {}), arrivedAt: nowIso },
  });

  const othersHere = (await world.listMinds()).filter(
    (m) => m.id !== selfId && m.placeId === placeId && nameById.has(m.id),
  );
  const otherNames = othersHere.map((m) => nameById.get(m.id));
  const withWhom = otherNames.length
    ? ` — ${otherNames.join(", ")} ${otherNames.length === 1 ? "is" : "are"} here`
    : "";
  // Chance encounters spark: the people already here notice someone walking in
  // (a quick wake, so a "hey, look who it is" can actually happen in the moment).
  for (const other of othersHere.slice(0, 3)) {
    await world.bumpMindWake(other.id, new Date(Date.now() + (0.2 + Math.random() * 1) * 60_000).toISOString());
  }
  return world.appendEvent({
    kind: created ? "discovered" : "moved",
    summary: created ? `${selfName} discovered ${placeName}` : `${selfName} went to ${placeName}${withWhom}`,
    characterIds: [selfId],
    detail: { placeId, placeName, why: shortText(action.why, 120) },
  });
}

/** Get or create the single shared scene chat for a place (parallel-safe). */
export async function ensurePlaceSceneChat(
  db: DB,
  place: { id: string; name: string; ownerId?: string | null },
): Promise<string> {
  return withWorldLock(`scene:${place.id}`, async () => {
    const chats = createChatsStorage(db);
    const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown }>;
    const existing = allChats.find((chat) => parseJson(chat.metadata).worldPlaceId === place.id);
    if (existing) return existing.id;
    const world = createWorldStorage(db);
    const members = new Set(
      (await world.listMinds())
        .filter((m) => m.placeId === place.id)
        .map((m) => m.id),
    );
    // A home always carries its owner — it's their space even while they're out.
    if (place.ownerId) members.add(place.ownerId);
    const created = await chats.create({
      name: place.name,
      mode: "roleplay",
      characterIds: [...members],
      groupId: null,
      personaId: null,
      promptPresetId: null,
      connectionId: null,
    });
    if (!created?.id) throw new Error(`Failed to create scene chat for ${place.name}`);
    await chats.patchMetadata(created.id, {
      worldPlaceScene: true,
      worldPlaceId: place.id,
      ...(place.ownerId ? { worldHome: true, worldHomeOwnerId: place.ownerId } : {}),
      autonomousMessages: false,
      characterCommands: false,
      groupChatMode: "individual",
    });
    await fileWorldChat(db, created.id);
    return created.id;
  });
}

/** Act/speak in-person at your current place — lands in the place's shared scene. */
async function executeScene(
  db: DB,
  nameById: Map<string, string>,
  selfId: string,
  action: WorldAction,
): Promise<{ event: WorldEventRecord | null; pingedIds: string[] }> {
  const world = createWorldStorage(db);
  const chats = createChatsStorage(db);
  const content = shortText(action.content, 1200);
  const mind = await world.getMind(selfId);
  if (!content || !mind?.placeId) return { event: null, pingedIds: [] };
  const place = await world.getPlace(mind.placeId);
  if (!place) return { event: null, pingedIds: [] };

  const sceneChatId = await ensurePlaceSceneChat(db, place);
  // Ensure the actor is a member of the scene (they're physically here).
  const sceneChat = await chats.getById(sceneChatId);
  const currentIds = parseCharacterIdList((sceneChat as { characterIds?: unknown } | null)?.characterIds);
  if (!currentIds.includes(selfId)) {
    await chats.update(sceneChatId, { characterIds: [...currentIds, selfId] });
  }
  const saved = await chats.createMessage({
    chatId: sceneChatId,
    role: "assistant",
    characterId: selfId,
    content,
  });
  if (!saved?.id) return { event: null, pingedIds: [] };
  const photo = shortText(action.photoPrompt, 1200);
  if (photo) {
    void generateWorldPhoto(db, {
      chatId: sceneChatId,
      messageId: saved.id,
      characterId: selfId,
      prompt: photo,
      includeSelf: action.photoOfMe === true,
    });
  }
  // Everyone else here is drawn into the moment (urgent — they're present).
  const othersHere = (await world.listMinds())
    .filter((m) => m.id !== selfId && m.placeId === place.id && nameById.has(m.id))
    .map((m) => m.id);
  const selfName = nameById.get(selfId) ?? "someone";
  const event = await world.appendEvent({
    kind: "scene",
    summary: `${selfName} at ${place.name}: "${shortText(content, 90)}"${photo ? " (with a photo)" : ""}`,
    characterIds: [selfId, ...othersHere],
    detail: { chatId: sceneChatId, messageId: saved.id, placeId: place.id, placeName: place.name },
  });
  return { event, pingedIds: othersHere };
}

async function executeHostEvent(
  db: DB,
  nameById: Map<string, string>,
  selfId: string,
  action: WorldAction,
): Promise<WorldEventRecord | null> {
  const world = createWorldStorage(db);
  const title = shortText(action.title, 100);
  const placeName = shortText(action.place, 80);
  if (!title || !placeName) return null;
  const { place } = await world.ensurePlace({ name: placeName, kind: shortText(action.kind, 40) || undefined, discoveredBy: selfId });
  // Coerce: models often emit numeric fields as strings ("2"), which
  // Number.isFinite alone would reject and silently default.
  const startInHoursRaw =
    typeof action.startInHours === "string" ? Number.parseFloat(action.startInHours) : (action.startInHours as number);
  const startInHours = Number.isFinite(startInHoursRaw) ? Math.max(0.25, Math.min(24 * 7, startInHoursRaw)) : 2;
  const startsAt = new Date(Date.now() + startInHours * 3_600_000).toISOString();
  const selfName = nameById.get(selfId) ?? "someone";
  return world.appendEvent({
    kind: "event",
    summary: `${selfName} is hosting "${title}" at ${place.name}`,
    characterIds: [selfId],
    detail: { title, placeId: place.id, placeName: place.name, startsAt, text: shortText(action.detail, 300), hostId: selfId },
  });
}

async function executeSetHome(
  db: DB,
  nameById: Map<string, string>,
  selfId: string,
  kind: string,
): Promise<WorldEventRecord | null> {
  const world = createWorldStorage(db);
  const selfName = nameById.get(selfId) ?? "someone";
  const cleanKind = shortText(kind, 30).toLowerCase() || "home";
  const home = await ensureHomePlace(db, selfId, selfName);
  const properName = `${selfName}'s ${cleanKind.charAt(0).toUpperCase()}${cleanKind.slice(1)}`;
  await world.renameHomePlace(home.id, properName, cleanKind);
  // The home's scene chat carries the place's name — keep it in step.
  const homeChatId = await ensurePlaceSceneChat(db, { id: home.id, name: properName, ownerId: selfId });
  await createChatsStorage(db).update(homeChatId, { name: properName });
  return world.appendEvent({
    kind: "place_detail",
    summary: `${selfName} settled into ${properName}`,
    characterIds: [selfId],
    detail: { placeId: home.id, home: true },
  });
}

async function executeDescribePlace(
  db: DB,
  nameById: Map<string, string>,
  selfId: string,
  action: WorldAction,
): Promise<WorldEventRecord | null> {
  const world = createWorldStorage(db);
  const mind = await world.getMind(selfId);
  const text = shortText(action.detail ?? action.content, 300);
  if (!mind?.placeId || !text) return null;
  const place = await world.getPlace(mind.placeId);
  if (!place) return null;
  // "inside" fleshes out the interior (what it's like within); otherwise the
  // outward description.
  const inside = action.inside === true;
  await world.enrichPlace(place.id, inside ? { interior: text } : { addition: text });
  return world.appendEvent({
    kind: "place_detail",
    summary: `${nameById.get(selfId) ?? "someone"} noticed ${inside ? "inside" : "at"} ${place.name}: ${shortText(text, 110)}`,
    characterIds: [selfId],
    detail: { placeId: place.id, inside },
  });
}

async function executeWork(
  db: DB,
  nameById: Map<string, string>,
  selfId: string,
  action: WorldAction,
): Promise<WorldEventRecord | null> {
  const world = createWorldStorage(db);
  const mind = await world.getMind(selfId);
  const content = shortText(action.content, 300);
  if (!content) return null;
  const earn = Math.max(0, Math.min(100_000, Math.round(Number(action.earn) || 0)));
  // Working establishes/keeps a job — the only writer for mind.job, so the
  // wallet line stops permanently reading "(no job yet)".
  const job = shortText(action.job, 120);
  await world.upsertMind(selfId, {
    money: (mind?.money ?? 0) + earn,
    ...(job ? { job } : {}),
  });
  return world.appendEvent({
    kind: "worked",
    summary: `${nameById.get(selfId) ?? "someone"} worked${job ? ` as ${job}` : ""}: ${shortText(content, 100)}${earn ? ` (+${earn})` : ""}`,
    characterIds: [selfId],
    detail: { earn, ...(job ? { job } : {}) },
  });
}

async function executeSpend(
  db: DB,
  nameById: Map<string, string>,
  selfId: string,
  action: WorldAction,
): Promise<WorldEventRecord | null> {
  const world = createWorldStorage(db);
  const mind = await world.getMind(selfId);
  const on = shortText(action.on, 200);
  const amount = Math.max(0, Math.min(100_000, Math.round(Number(action.amount) || 0)));
  if (!on || amount <= 0) return null;
  const nextMoney = Math.max(0, (mind?.money ?? 0) - amount);
  await world.upsertMind(selfId, { money: nextMoney });
  return world.appendEvent({
    kind: "spent",
    summary: `${nameById.get(selfId) ?? "someone"} spent ${amount} on ${shortText(on, 90)}`,
    characterIds: [selfId],
    detail: { amount },
  });
}

async function executeSay(
  db: DB,
  ctx: { selfId: string; name: string; spaceChatId: string },
  content: string,
  photoPrompt?: string,
  photoOfMe?: boolean,
): Promise<WorldEventRecord | null> {
  const text = shortText(content, 800);
  if (!text) return null;
  const chats = createChatsStorage(db);
  const world = createWorldStorage(db);
  const saved = await chats.createMessage({
    chatId: ctx.spaceChatId,
    role: "assistant",
    characterId: ctx.selfId,
    content: text,
  });
  if (!saved?.id) return null;
  const photo = shortText(photoPrompt, 1200);
  if (photo) {
    void generateWorldPhoto(db, {
      chatId: ctx.spaceChatId,
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
    detail: { chatId: ctx.spaceChatId, messageId: saved.id, text },
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
    // Parallel-safe: one thread per member-set even if two members start it at once.
    const memberKey = [...members].sort().join("+");
    chatId = await withWorldLock(`group:${isHangout ? "hang" : "text"}:${memberKey}`, async () => {
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
        if (isHangout && place) {
          await chats.patchMetadata(existing.id, { worldPlace: place });
        }
        return existing.id;
      }
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
      if (!created?.id) return null;
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
      return created.id;
    });
    if (!chatId) return { event: null, pingedIds: [], urgent: false };
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

/**
 * A character texts the HUMAN — the person whose world this is. Creates (or
 * reuses) their private DM thread, posts the message, and rings the user with
 * an unread badge, so being thought of reaches them even when they're away.
 */
/**
 * Get or create the private DM thread between a character and the human. It's a
 * real conversation chat (the character alone; the human present as their
 * persona), filed into the Living World section so world DMs live together.
 * Shared by the mind's `message` action and the client's "Message" button.
 */
export async function ensureUserDmChat(db: DB, characterId: string): Promise<string | null> {
  const chats = createChatsStorage(db);
  const chars = createCharactersStorage(db);
  const row = (await chars.getById(characterId)) as { id: string; data: unknown } | null;
  if (!row) return null;
  const selfName = shortText(parseJson(row.data).name, 60) || "Someone";
  const user = await resolveWorldUser(db);
  const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown }>;
  const existing = allChats.find((chat) => {
    const meta = parseJson(chat.metadata);
    return meta.worldUserDm === true && meta.worldCharacterId === characterId;
  });
  if (existing) return existing.id;
  const created = await chats.create({
    name: selfName,
    mode: "conversation",
    characterIds: [characterId],
    groupId: null,
    personaId: user.personaId,
    promptPresetId: null,
    connectionId: null,
  });
  if (!created?.id) return null;
  await chats.patchMetadata(created.id, {
    worldUserDm: true,
    worldCharacterId: characterId,
    autonomousMessages: true,
    characterCommands: false,
  });
  await fileWorldChat(db, created.id);
  return created.id;
}

/** Create a world group chat the human is part of, with the chosen characters. */
export async function ensureUserGroupChat(db: DB, characterIds: string[], name?: string): Promise<string | null> {
  const chats = createChatsStorage(db);
  const config = await loadWorldEngineConfig(db);
  const nameById = await buildNameMap(db, config);
  const members = [...new Set(characterIds.filter((id) => nameById.has(id)))];
  if (!members.length) return null;
  const user = await resolveWorldUser(db);
  const groupName = shortText(name, 60) || members.map((id) => nameById.get(id) ?? "?").join(", ");
  const created = await chats.create({
    name: groupName,
    mode: "conversation",
    characterIds: members,
    groupId: null,
    personaId: user.personaId,
    promptPresetId: null,
    connectionId: null,
  });
  if (!created?.id) return null;
  await chats.patchMetadata(created.id, {
    worldGroupThread: true,
    worldMembers: members,
    worldUserGroup: true,
    autonomousMessages: true,
    characterCommands: false,
    groupChatMode: "individual",
  });
  await fileWorldChat(db, created.id);
  return created.id;
}

async function executeMessageUser(
  db: DB,
  selfId: string,
  selfName: string,
  action: WorldAction,
): Promise<WorldEventRecord | null> {
  const chats = createChatsStorage(db);
  const world = createWorldStorage(db);
  const content = shortText(action.content, 800);
  if (!content) return null;
  const user = await resolveWorldUser(db);
  const chatId = await ensureUserDmChat(db, selfId);
  if (!chatId) return null;
  const saved = await chats.createMessage({ chatId, role: "assistant", characterId: selfId, content });
  if (!saved?.id) return null;
  const photo = shortText(action.photoPrompt, 1200);
  if (photo) {
    void generateWorldPhoto(db, {
      chatId,
      messageId: saved.id,
      characterId: selfId,
      prompt: photo,
      includeSelf: action.photoOfMe === true,
    });
  }
  try {
    await chats.markAutonomousUnread(chatId, { characterId: selfId, count: 1 });
  } catch (error) {
    logger.debug(error, "[world/mind] Could not mark the user DM unread");
  }
  return world.appendEvent({
    kind: "dm",
    summary: `${selfName} texted ${user.name}: "${shortText(content, 90)}"${photo ? " (with a photo)" : ""}`,
    characterIds: [selfId],
    detail: { chatId, messageId: saved.id, toUser: true, preview: shortText(content, 120) },
  });
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

    // Thoughts follow the body: alone, they drift into the room (the current
    // place's chat, italicized); in company they stay INNER — the timeline
    // keeps them, but nobody overhears a private thought in a shared scene.
    if (output.thought) {
      let savedThoughtId: string | null = null;
      if (ctx.spaceAlone) {
        const savedThought = await chats.createMessage({
          chatId: ctx.spaceChatId,
          role: "assistant",
          characterId,
          content: `*${output.thought}*`,
        });
        savedThoughtId = savedThought?.id ?? null;
      }
      const thoughtEvent = await world.appendEvent({
        kind: "thought",
        summary: `${ctx.self.name}: "${shortText(output.thought, 140)}"`,
        characterIds: [characterId],
        detail: { ...(savedThoughtId ? { chatId: ctx.spaceChatId, messageId: savedThoughtId } : {}), text: output.thought },
      });
      result.events.push(thoughtEvent);
    }

    // Execute chosen actions (budget-gated), collecting who got pinged.
    const state = await loadWorldEngineState(db);
    let budgetLeft = dailyBudgetLeft(config, state.dailyCount);
    const pinged = new Set<string>();
    const urgentPinged = new Set<string>();
    let doActivity: string | null = null;
    let postedNow = false;
    // Decay needs for the time slept/awake since last wake, then let this wake's
    // actions restore them — the loop that makes behavior purposeful.
    const minutesSinceWake = ctx.mind.lastWakeAt
      ? Math.max(0, (nowDate.getTime() - new Date(ctx.mind.lastWakeAt).getTime()) / 60_000)
      : 0;
    const workingNeeds = decayNeeds(ctx.mind.needs, minutesSinceWake, ctx.presence.status === "offline" ? "night" : "day");
    for (const rawAction of output.actions) {
      if (budgetLeft <= 0) break;
      try {
        let event: WorldEventRecord | null = null;
        if (rawAction.type === "do") {
          event = await executeDo(
            db,
            { selfId: characterId, name: ctx.self.name, spaceChatId: ctx.spaceChatId },
            String(rawAction.activity ?? rawAction.content ?? ""),
          );
          if (event) doActivity = String(event.detail.activity ?? "");
        } else if (rawAction.type === "go") {
          event = await executeGo(db, nameById, characterId, rawAction);
        } else if (rawAction.type === "set_home") {
          event = await executeSetHome(db, nameById, characterId, String(rawAction.kind ?? rawAction.content ?? ""));
        } else if (rawAction.type === "host_event") {
          event = await executeHostEvent(db, nameById, characterId, rawAction);
        } else if (rawAction.type === "describe_place") {
          event = await executeDescribePlace(db, nameById, characterId, rawAction);
        } else if (rawAction.type === "work") {
          event = await executeWork(db, nameById, characterId, rawAction);
        } else if (rawAction.type === "spend") {
          event = await executeSpend(db, nameById, characterId, rawAction);
        } else if (rawAction.type === "say") {
          event = await executeSay(
            db,
            { selfId: characterId, name: ctx.self.name, spaceChatId: ctx.spaceChatId },
            String(rawAction.content ?? ""),
            typeof rawAction.photoPrompt === "string" ? rawAction.photoPrompt : undefined,
            rawAction.photoOfMe === true,
          );
        } else if (rawAction.type === "scene") {
          const sceneResult = await executeScene(db, nameById, characterId, rawAction);
          event = sceneResult.event;
          for (const id of sceneResult.pingedIds) {
            pinged.add(id);
            urgentPinged.add(id); // people physically present react fast
          }
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
        } else if (rawAction.type === "message" && String(rawAction.toCharacterId) === WORLD_USER_ID) {
          // Texting the human — lands in their real inbox, not a character↔character DM.
          event = await executeMessageUser(db, characterId, ctx.self.name, rawAction);
        } else {
          const engineAction = toEngineAction(characterId, rawAction);
          if (!engineAction) continue;
          // Tag memories with where they're being formed, so place recall works.
          if (engineAction.type === "memory" && ctx.city.hereLine) {
            engineAction.place = ctx.city.placeName ?? undefined;
          }
          event = await executeWorldAction({ db, world, nameById, config, app: options.app }, engineAction);
          if (event && engineAction.type === "dm" && typeof engineAction.toCharacterId === "string") {
            pinged.add(engineAction.toCharacterId);
          }
        }
        if (event) {
          result.events.push(event);
          result.actionsExecuted += 1;
          budgetLeft -= 1;
          if (rawAction.type === "post") postedNow = true;
          // This action nudges their drives (working tires, eating fills…).
          // `spend` describes what was bought in `on`, so include it — otherwise
          // buying food never satisfies hunger (the regex tests an empty string).
          const effect = needEffectFor(
            rawAction.type,
            String(rawAction.activity ?? rawAction.content ?? rawAction.on ?? ""),
          );
          for (const [key, delta] of Object.entries(effect)) {
            const k = key as "energy" | "hunger" | "social";
            workingNeeds[k] = Math.max(0, Math.min(100, workingNeeds[k] + (delta ?? 0)));
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
        // Someone physically present reacts in SECONDS — they're standing right
        // there. Texts land at a presence-shaped notice delay.
        const base = urgentPinged.has(recipientId)
          ? 0.05 + Math.random() * 0.4
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
    // Re-read: a "go" this wake may have just set placeId/arrivedAt; preserve it.
    // Also, a ping (user intrusion, a DM/hangout) can land DURING the seconds-long
    // LLM call — honor it instead of overwriting nextWakeAt/wakeReason with our
    // own paced gap, so a fresh unanswered message isn't silently deferred by
    // the (possibly hours-long) slow-life gap.
    const latestMind = await world.getMind(characterId);
    const computedNextIso = new Date(nowDate.getTime() + gap * 60_000).toISOString();
    const pingedDuringWake = latestMind?.cursors.wakeReason === "ping";
    const nextWakeAt =
      pingedDuringWake && latestMind?.nextWakeAt && latestMind.nextWakeAt < computedNextIso
        ? latestMind.nextWakeAt // never push a pending ping later than it already is
        : computedNextIso;
    await world.upsertMind(characterId, {
      mood: output.mood ?? undefined,
      // A "do" is a lived intention — it wins unless they stated a newer one.
      intention: output.intention ?? doActivity ?? undefined,
      lastWakeAt: nowIso,
      nextWakeAt,
      needs: workingNeeds,
      cursors: {
        seenPostsAt: nowIso,
        seenDmsAt: nowIso,
        // Keep a ping that arrived mid-wake so the next cycle answers it fast.
        wakeReason: pingedDuringWake ? "ping" : "self",
        arrivedAt: latestMind?.cursors.arrivedAt ?? ctx.mind.cursors.arrivedAt ?? nowIso,
        // Stamp the pace this wake was scheduled under, so the re-stagger loop
        // can tell a genuine config change from steady-state (see below).
        scheduledInterval: config.wakeIntervalMinutes,
        // A worry that quietly persists between wakes (or the prior one, kept).
        weighing:
          output.weighing ?? (typeof ctx.mind.cursors.weighing === "string" ? ctx.mind.cursors.weighing : undefined),
        // Their posting rhythm — so "haven't shared anything in days" is felt.
        lastPostedAt: postedNow
          ? nowIso
          : typeof ctx.mind.cursors.lastPostedAt === "string"
            ? ctx.mind.cursors.lastPostedAt
            : undefined,
      },
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

// Single-flight serialization + convergence cache for world provisioning. The
// scheduler, a manual /tick, and PUT /config can all call ensureMindsInitialized
// at once; without this two runs both take the "new member" branch and race a
// duplicate insert (which throws and aborts the whole cycle), and the heavy
// migration/provisioning sweep re-runs every 45s forever after convergence.
let mindsInitChain: Promise<void> = Promise.resolve();
let worldInitConverged: string | null = null;

/**
 * Force the next ensureMindsInitialized to do a full provisioning pass. Call
 * after anything that changes what needs provisioning: a config save (new
 * members, noodle toggled) or a world reset (minds/places wiped).
 */
export function invalidateMindsInit(): void {
  worldInitConverged = null;
}

/**
 * Ensure every member has a mind row (first wakes staggered at offset times)
 * and — when noodle is allowed — an invited Noodle account, so world members
 * can actually post without a manual invite step. Serialized and cached: a
 * steady roster makes this a cheap no-op after the first converged pass.
 */
export async function ensureMindsInitialized(db: DB, config: WorldEngineConfig): Promise<void> {
  const run = mindsInitChain.then(() => ensureMindsInitializedInner(db, config));
  // Keep one failure from poisoning every future waiter on the chain.
  mindsInitChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureMindsInitializedInner(db: DB, config: WorldEngineConfig): Promise<void> {
  const world = createWorldStorage(db);
  const noodle = createNoodleStorage(db);
  const chats = createChatsStorage(db);
  const nameById = await buildNameMap(db, config);
  // Converged? A run is only needed when the roster or noodle setting changed
  // (new chats are born already-normalized, so the sweep has nothing to do).
  const signature = `${config.allowNoodle ? "n" : "-"}|${[...nameById.keys()].sort().join(",")}`;
  if (worldInitConverged === signature) return;
  const existing = new Set((await world.listMinds()).map((mind) => mind.id));

  // Seed everyday public buildings (hospital, school, bar, cafe…) so the map is
  // populated from day one and characters have real places to go. Idempotent.
  await world.seedDefaultPlaces();

  // Migration sweep: normalize every world chat's mode and group generation so
  // each character speaks as themselves (not one narrator). World chats are
  // routed to the WORLD tab by metadata — the legacy folders only made empty
  // subdividers, so they're torn out here.
  await removeWorldChatFolders(db);
  const allChats = (await chats.list()) as Array<{
    id: string;
    mode?: string | null;
    folderId?: string | null;
    metadata?: unknown;
  }>;
  for (const chat of allChats) {
    const meta = parseJson(chat.metadata);
    // Living is place-based now: the old per-character "X's life" diaries are
    // retired — a character's living lands in the chat of wherever they are.
    if (meta.worldLifeChat === true) {
      await chats.remove(chat.id);
      continue;
    }
    const isWorldChat =
      meta.worldDmThread === true || meta.worldGroupThread === true || meta.worldPlaceScene === true;
    if (!isWorldChat) continue;
    // Hangouts and place scenes are roleplay (prose scenes); DMs and text
    // groups are conversation (people texting).
    const wantMode =
      meta.worldHangout === true || meta.worldPlaceScene === true ? "roleplay" : "conversation";
    if (chat.mode !== wantMode) {
      await chats.update(chat.id, { mode: wantMode });
    }
    // Multi-character world chats speak individually, never merged/narrator.
    const isMulti = meta.worldDmThread === true || meta.worldGroupThread === true;
    if (isMulti && meta.groupChatMode !== "individual") {
      await chats.patchMetadata(chat.id, { groupChatMode: "individual" });
    }
  }
  for (const [characterId, name] of nameById) {
    // One member's failure (e.g. a lost insert race) must not abort the batch
    // or the scheduler cycle — everyone else still gets provisioned.
    try {
      if (config.allowNoodle) {
        const account = await noodle.getAccountByEntity("character", characterId);
        if (!account) {
          await noodle.upsertAccountFromProfile({ kind: "character", entityId: characterId, displayName: name, invited: true });
        } else if (!account.invited) {
          await noodle.updateAccount(account.id, { invited: true });
        }
      }
      // Everyone gets a home place (their own living space) and starts there.
      // The home is a real place with a real scene chat — their living room.
      const home = await ensureHomePlace(db, characterId, name);
      await ensurePlaceSceneChat(db, { id: home.id, name: home.name, ownerId: characterId });
      if (existing.has(characterId)) {
        // Existing mind with no place lands home rather than floating nowhere.
        const current = await world.getMind(characterId);
        if (current && !current.placeId) {
          await world.upsertMind(characterId, {
            placeId: home.id,
            cursors: { ...current.cursors, arrivedAt: new Date().toISOString() },
          });
        }
        continue;
      }
      // First wakes spread across the interval at offset times — everyone gets a
      // turn within roughly one window of enabling.
      const stagger = (0.05 + Math.random() * 0.95) * config.wakeIntervalMinutes;
      await world.upsertMind(characterId, {
        placeId: home.id,
        nextWakeAt: new Date(Date.now() + stagger * 60_000).toISOString(),
        cursors: { arrivedAt: new Date().toISOString(), scheduledInterval: config.wakeIntervalMinutes },
      });
    } catch (error) {
      logger.warn(error, "[world/mind] Failed to initialize %s", name);
    }
  }
  worldInitConverged = signature;
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

/** A scene counts as "live" if it had a message within this window. */
const ACTIVE_SCENE_WINDOW_MS = 25 * 60_000;
/** Stop driving a scene once it's traded this many turns without the user. */
const MAX_DRIVEN_SCENE_TURNS = 12;

/**
 * Turn-based continuity for live scenes. Each cycle, finds recently-active
 * world threads (DMs, hangouts, groups) where the last speaker left someone
 * else on-deck, and pulls that person's wake in so the exchange alternates
 * cleanly — independent of their loose life-wake clock. Hangouts (in person)
 * are driven fast; texts at a natural texting pace. A scene that goes quiet or
 * runs long simply stops being driven, so nothing loops forever.
 */
export async function advanceActiveScenes(db: DB): Promise<{ driven: number }> {
  const config = await loadWorldEngineConfig(db);
  if (!config.enabled) return { driven: 0 };
  const chats = createChatsStorage(db);
  const world = createWorldStorage(db);
  const nameById = await buildNameMap(db, config);
  const nowMs = Date.now();
  let driven = 0;

  const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown; updatedAt?: string }>;
  // Occupancy snapshot: place-scene membership is who's physically there NOW
  // (mind.placeId), not who ever spoke there — so someone who walked away isn't
  // driven to answer a scene their wake context no longer even contains, and
  // isn't burning a scarce ping-wake slot every cycle for 25 minutes.
  const allMinds = await world.listMinds();
  for (const chat of allChats) {
    const meta = parseJson(chat.metadata);
    const isDm = meta.worldDmThread === true && Array.isArray(meta.worldPair);
    const isGroup = meta.worldGroupThread === true && Array.isArray(meta.worldMembers);
    const isPlaceScene = meta.worldPlaceScene === true;
    if (!isDm && !isGroup && !isPlaceScene) continue;
    // Skip long-dead threads WITHOUT loading a single message — updatedAt is
    // bumped on every new message, so idle world chats cost nothing per cycle.
    const updatedMs = new Date(String(chat.updatedAt ?? "")).getTime();
    if (Number.isFinite(updatedMs) && nowMs - updatedMs > ACTIVE_SCENE_WINDOW_MS) continue;
    const memberSource = isDm
      ? (meta.worldPair as string[])
      : isGroup
        ? (meta.worldMembers as string[])
        : typeof meta.worldPlaceId === "string"
          ? allMinds.filter((m) => m.placeId === meta.worldPlaceId).map((m) => m.id)
          : [];
    const memberIds = memberSource.filter((id) => nameById.has(id));
    if (memberIds.length < 2) continue;

    // Only active threads reach here; bound the load to the recent burst.
    const messages = (await chats.listMessagesPaginated(chat.id, MAX_DRIVEN_SCENE_TURNS + 1)) as Array<{
      role: string;
      characterId?: string | null;
      content: string;
      createdAt: string;
    }>;
    const last = messages[messages.length - 1];
    if (!last) continue;
    const lastMs = new Date(last.createdAt).getTime();
    if (!Number.isFinite(lastMs) || nowMs - lastMs > ACTIVE_SCENE_WINDOW_MS) continue; // gone quiet

    // Count turns in this active burst; stop driving marathon scenes.
    let burstTurns = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (nowMs - new Date(messages[i]!.createdAt).getTime() > ACTIVE_SCENE_WINDOW_MS) break;
      burstTurns += 1;
    }
    if (burstTurns >= MAX_DRIVEN_SCENE_TURNS) continue;

    // On-deck = members who didn't send the last message (their turn to react)
    // AND haven't yet had a wake since it landed. Someone who woke after the
    // message already saw it — if they stayed silent, that WAS their answer;
    // re-poking them every cycle is what produced "hey, are you gonna respond?"
    // (their next wake still shows the thread; they can pick it up themselves).
    const lastSpeaker = last.role === "user" ? "user" : (last.characterId ?? null);
    const mindByChar = new Map(allMinds.map((m) => [m.id, m]));
    const onDeck = memberIds.filter((id) => {
      if (id === lastSpeaker) return false;
      const lastWakeMs = mindByChar.get(id)?.lastWakeAt ? new Date(mindByChar.get(id)!.lastWakeAt!).getTime() : 0;
      return lastWakeMs < lastMs;
    });
    if (!onDeck.length) continue;

    const inPerson = meta.worldHangout === true || isPlaceScene;
    const presence = await resolvePresenceMap(db, onDeck);
    for (const id of onDeck) {
      // In person the moment is NOW — bump to due immediately so this very
      // cycle's wake pass (which runs right after) picks them up. Texts flow
      // at a presence-shaped texting pace.
      const delay = inPerson ? 0 : Math.max(2, noticeDelayMinutes(presence.get(id)?.status ?? "online") * 0.5);
      await world.bumpMindWake(id, new Date(nowMs + delay * 60_000).toISOString());
      driven += 1;
    }
  }
  return { driven };
}

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

  // A pace CHANGE (e.g. slow-life → bustling) should apply immediately: minds
  // scheduled under the OLD pace get pulled into the new window. But at steady
  // pace this MUST be a no-op — otherwise it clobbers every deliberately long
  // sleep (offline 3–6×, dnd up to 3×, a mind's own up-to-4× check-in) on the
  // very next 45s cycle, capping everyone at ~1× the interval. So gate on the
  // interval each mind was last scheduled under: only re-stagger when it differs
  // from the interval we're running now, and stamp the new interval so a single
  // pace change re-staggers each mind exactly once, not every cycle.
  for (const mind of memberMinds) {
    const scheduledInterval =
      typeof mind.cursors.scheduledInterval === "number" ? mind.cursors.scheduledInterval : null;
    const paceChanged = scheduledInterval !== null && scheduledInterval !== config.wakeIntervalMinutes;
    if (paceChanged && mind.nextWakeAt && mind.cursors.wakeReason !== "ping") {
      const stagger = (0.05 + Math.random() * 0.95) * config.wakeIntervalMinutes;
      mind.nextWakeAt = new Date(Date.now() + stagger * 60_000).toISOString();
      await world.upsertMind(mind.id, {
        nextWakeAt: mind.nextWakeAt,
        cursors: { ...mind.cursors, scheduledInterval: config.wakeIntervalMinutes },
      });
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

  // Wake everyone due IN PARALLEL — a cycle costs one LLM latency, not the sum
  // of them. This is what lets a live conversation actually flow: the reply
  // lands next cycle (~seconds), instead of queueing behind every other wake.
  // Each wake touches its own mind row; shared find-or-create paths are behind
  // keyed locks and the budget/pace counters go through the serialized patch.
  const anyScheduled = due.some((mind) => mind.cursors.wakeReason !== "ping");
  const woke = await Promise.all(
    due.map((mind) => wakeCharacterMind(db, mind.id, { provider: resolved, app: options.app })),
  );
  result.woke.push(...woke);
  // Only spontaneous wakes advance the pace clock — a flowing conversation
  // shouldn't starve everyone else's check-ins.
  if (anyScheduled) {
    await saveWorldEngineStatePatch(db, (current) => {
      current.lastRunAt = new Date().toISOString();
    });
  }
  return result;
}
