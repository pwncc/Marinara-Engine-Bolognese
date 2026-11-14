// ──────────────────────────────────────────────
// A scene started from a conversation plays in its own roleplay chat. What the
// conversation tracks goes with it and comes back when the scene concludes:
// the tracker snapshot (people's status rows, world state, persona stats), the
// REagent settings and workspace files (memory, dossiers, simulation ledger),
// the questions it asked, and which agents run.
// ──────────────────────────────────────────────

import {
  normalizeWorldCustomFields,
  parseTrackerFieldLocks,
  parseTrackerHiddenFields,
  REAGENT_QUESTION_HISTORY,
  REAGENT_QUESTIONS_METADATA_KEY,
  REAGENT_USER_EDITS_METADATA_KEY,
  readReagentQuestions,
  readReagentUserFileEdits,
  type PresentCharacter,
  type ReagentFileVersions,
  type ReagentUserFileEdit,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { resolveVisibleGameStateAnchor } from "../../routes/generate/generate-route-utils.js";
import { copyReagentWorkspace, materializeWorkspace } from "../reagent/reagent-workspace.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createGameStateStorage } from "../storage/game-state.storage.js";

/** Marks a scene chat that started from its origin's state, so concluding it may write that state back. */
export const SCENE_STATE_SEEDED_KEY = "sceneStateSeeded";

/** Chat settings a scene keeps from the conversation so the same things keep being tracked. */
const CARRIED_SETTING_KEYS = [
  "reagent",
  REAGENT_QUESTIONS_METADATA_KEY,
  "enableAgents",
  "activeAgentIds",
  "agentOverrides",
  "agentPromptTemplateIds",
  "trackerFeaturedCharacterKeys",
  "trackerStatIconOverrides",
] as const;

type SnapshotRow = NonNullable<Awaited<ReturnType<ReturnType<typeof createGameStateStorage>["getLatest"]>>>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const parseMetadata = (chat: { metadata?: unknown } | null | undefined) =>
  parseJson<Record<string, unknown>>(chat?.metadata, {});

/** The snapshot a chat currently shows: the last reply's own, else the newest one. */
async function currentSnapshot(db: DB, chatId: string): Promise<SnapshotRow | null> {
  const messages = await createChatsStorage(db).listMessages(chatId);
  return createGameStateStorage(db).getForGeneration(chatId, {
    preferLatestVisible: true,
    visibleAnchor: resolveVisibleGameStateAnchor(messages),
  });
}

/** Rows keyed the way the tracker tells people apart: by card id, else by name. */
const rowKey = (row: PresentCharacter) => row.characterId || `name:${(row.name ?? "").trim().toLowerCase()}`;

/** The scene's people as they ended it, with everyone the scene did not touch left as they were. */
export function mergeReturnedCharacters(origin: PresentCharacter[], scene: PresentCharacter[]): PresentCharacter[] {
  const returned = new Map(scene.map((row) => [rowKey(row), row]));
  const merged = origin.map((row) => returned.get(rowKey(row)) ?? row);
  const known = new Set(origin.map(rowKey));
  return [...merged, ...scene.filter((row) => !known.has(rowKey(row)))];
}

/** What changed in the scene's workspace relative to the origin's, as edits to apply there. */
export function diffReturnedFiles(origin: ReagentFileVersions, scene: ReagentFileVersions): ReagentFileVersions {
  const changed: ReagentFileVersions = {};
  for (const [path, content] of Object.entries(scene)) {
    const before = origin[path] ?? null;
    if (content !== before) changed[path] = content;
  }
  return changed;
}

async function writeSnapshot(
  db: DB,
  target: { chatId: string; messageId: string; swipeIndex: number },
  source: SnapshotRow,
  presentCharacters: PresentCharacter[],
) {
  await createGameStateStorage(db).create({
    chatId: target.chatId,
    messageId: target.messageId,
    swipeIndex: target.swipeIndex,
    date: (source.date as string) ?? null,
    time: (source.time as string) ?? null,
    location: (source.location as string) ?? null,
    weather: (source.weather as string) ?? null,
    temperature: (source.temperature as string) ?? null,
    worldCustomFields: normalizeWorldCustomFields(parseJson(source.worldCustomFields, [])),
    presentCharacters,
    recentEvents: parseJson(source.recentEvents, []),
    playerStats: parseJson(source.playerStats, null),
    personaStats: parseJson(source.personaStats, null),
    fieldLocks: parseTrackerFieldLocks(source.fieldLocks),
    hiddenTrackerFields: parseTrackerHiddenFields(source.hiddenTrackerFields),
    committed: true,
  });
}

/**
 * Start a scene from its conversation's state. Each part stands alone: one that fails is
 * logged and the scene still opens.
 */
export async function seedSceneState(args: {
  db: DB;
  originChatId: string;
  sceneChatId: string;
  /** The scene's opening reply, which the tracker snapshot is anchored to. */
  openingMessageId: string;
}): Promise<void> {
  const chats = createChatsStorage(args.db);
  const origin = await chats.getById(args.originChatId);
  if (!origin) return;
  const originMeta = parseMetadata(origin);
  const patch: Record<string, unknown> = { [SCENE_STATE_SEEDED_KEY]: true };

  for (const key of CARRIED_SETTING_KEYS) {
    if (originMeta[key] !== undefined) patch[key] = structuredClone(originMeta[key]);
  }

  try {
    const snapshot = await currentSnapshot(args.db, args.originChatId);
    if (snapshot) {
      await writeSnapshot(
        args.db,
        { chatId: args.sceneChatId, messageId: args.openingMessageId, swipeIndex: 0 },
        snapshot,
        parseJson<PresentCharacter[]>(snapshot.presentCharacters, []),
      );
    }
  } catch (err) {
    logger.warn(err, "[scene] Could not carry the tracker into scene %s", args.sceneChatId);
  }

  try {
    // The origin's files become the scene's state before its first message, so swipes and
    // regenerations inside the scene fall back to them rather than to nothing.
    const { state } = await materializeWorkspace(args.db, args.originChatId, { unlessHeld: true });
    const at = new Date().toISOString();
    const seeded: ReagentUserFileEdit[] = Object.entries(state)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([path, content]) => ({ path, content, afterMessageId: null, at }));
    if (seeded.length > 0) patch[REAGENT_USER_EDITS_METADATA_KEY] = seeded;
    // Pictures and anything else that is not journaled come along as files.
    await copyReagentWorkspace(args.originChatId, args.sceneChatId);
  } catch (err) {
    logger.warn(err, "[scene] Could not carry the REagent workspace into scene %s", args.sceneChatId);
  }

  await chats.patchMetadata(args.sceneChatId, patch);
  if (patch[REAGENT_USER_EDITS_METADATA_KEY]) {
    await materializeWorkspace(args.db, args.sceneChatId, { unlessHeld: true }).catch((err) =>
      logger.warn(err, "[scene] Could not lay out the workspace of scene %s", args.sceneChatId),
    );
  }
}

/**
 * Bring a concluded scene's state home. Only a scene that started from the origin's state
 * writes back: one that began empty would overwrite the conversation with blanks.
 */
export async function returnSceneState(args: {
  db: DB;
  sceneChatId: string;
  originChatId: string;
  /** The message in the origin that reports the scene's end; file changes land after it. */
  returnMessageId: string | null;
}): Promise<{ tracker: boolean; files: string[] }> {
  const result = { tracker: false, files: [] as string[] };
  const chats = createChatsStorage(args.db);
  const [scene, origin] = await Promise.all([chats.getById(args.sceneChatId), chats.getById(args.originChatId)]);
  if (!scene || !origin || parseMetadata(scene)[SCENE_STATE_SEEDED_KEY] !== true) return result;
  const sceneMeta = parseMetadata(scene);

  try {
    const sceneSnapshot = await currentSnapshot(args.db, args.sceneChatId);
    if (sceneSnapshot) {
      const originMessages = await chats.listMessages(args.originChatId);
      const originSnapshot = await currentSnapshot(args.db, args.originChatId);
      // ponytail: the returned state replaces the snapshot of the conversation's last reply, the
      // one its tracker shows and its next reply starts from. Regenerating that older reply would
      // start from before the scene; anchor to the return message if that ever matters.
      const anchor = resolveVisibleGameStateAnchor(originMessages) ?? { messageId: "", swipeIndex: 0 };
      await writeSnapshot(
        args.db,
        { chatId: args.originChatId, ...anchor },
        sceneSnapshot,
        mergeReturnedCharacters(
          originSnapshot ? parseJson<PresentCharacter[]>(originSnapshot.presentCharacters, []) : [],
          parseJson<PresentCharacter[]>(sceneSnapshot.presentCharacters, []),
        ),
      );
      result.tracker = true;
    }
  } catch (err) {
    logger.warn(err, "[scene] Could not return the tracker from scene %s", args.sceneChatId);
  }

  try {
    const [{ state: sceneState }, { state: originState }] = await Promise.all([
      materializeWorkspace(args.db, args.sceneChatId, { unlessHeld: true }),
      materializeWorkspace(args.db, args.originChatId, { unlessHeld: true }),
    ]);
    const changed = diffReturnedFiles(originState, sceneState);
    const at = new Date().toISOString();
    const edits: ReagentUserFileEdit[] = Object.entries(changed).map(([path, content]) => ({
      path,
      content,
      afterMessageId: args.returnMessageId,
      at,
    }));
    const sceneQuestions = readReagentQuestions(sceneMeta);
    if (edits.length > 0 || sceneQuestions.length > 0) {
      await chats.patchMetadata(args.originChatId, (current) => {
        const patch: Record<string, unknown> = {};
        if (edits.length > 0) patch[REAGENT_USER_EDITS_METADATA_KEY] = [...readReagentUserFileEdits(current), ...edits];
        if (sceneQuestions.length > 0) {
          const known = readReagentQuestions(current);
          const ids = new Set(known.map((entry) => entry.id));
          patch[REAGENT_QUESTIONS_METADATA_KEY] = [
            ...known,
            ...sceneQuestions.filter((entry) => !ids.has(entry.id)),
          ].slice(-REAGENT_QUESTION_HISTORY);
        }
        return patch;
      });
    }
    if (edits.length > 0) {
      await materializeWorkspace(args.db, args.originChatId, { unlessHeld: true });
      result.files = Object.keys(changed);
    }
  } catch (err) {
    logger.warn(err, "[scene] Could not return the REagent workspace from scene %s", args.sceneChatId);
  }
  return result;
}
