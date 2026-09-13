import type { WrapFormat } from "@marinara-engine/shared";

import { logger } from "../../lib/logger.js";
import { getZonedDayBounds } from "../conversation/timezone.js";
import type { DB } from "../../db/connection.js";
import { wrapContent } from "../prompt/format-engine.js";
import { sanitizePromptLeaf } from "../prompt/prompt-escaping.js";

type CharactersStore = {
  getById(id: string): Promise<{ data: unknown } | null>;
};

type CharacterMemory = {
  from: string;
  fromCharId: string;
  summary: string;
  createdAt: string;
};

/** Older memories carried per character so shared history survives past today. */
const CARRIED_OLDER_MEMORIES = 6;

export async function mergeConversationCharacterMemories({
  chars,
  characterIds,
  awarenessBlock,
  timeZone,
  db,
  wrapFormat,
}: {
  chars: CharactersStore;
  characterIds: string[];
  awarenessBlock: string | null;
  timeZone?: string;
  /** When provided, injects Living World relationship standing between co-present characters. */
  db?: DB;
  wrapFormat: WrapFormat;
}): Promise<string | null> {
  const memoryLines: string[] = [];
  const today = getZonedDayBounds(new Date(), timeZone).start;
  const leaf = (text: string) => sanitizePromptLeaf(text, wrapFormat);

  for (const characterId of characterIds) {
    const charRow = await chars.getById(characterId);
    if (!charRow) continue;

    let charData: Record<string, any>;
    try {
      const parsed = typeof charRow.data === "string" ? JSON.parse(charRow.data) : charRow.data;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      charData = parsed as Record<string, any>;
    } catch (error) {
      logger.warn(error, "[memory] Skipping malformed character data for %s", characterId);
      continue;
    }
    const memories: CharacterMemory[] = charData.extensions?.characterMemories ?? [];
    if (memories.length === 0) continue;

    // Everything from today, plus a bounded tail of older memories so people
    // who met weeks ago still vividly remember each other.
    const fresh = memories.filter((memory) => new Date(memory.createdAt) >= today);
    const older = memories
      .filter((memory) => new Date(memory.createdAt) < today)
      .slice(-CARRIED_OLDER_MEMORIES);

    for (const memory of older) {
      memoryLines.push(`Memory from ${leaf(memory.from)} (${memory.createdAt.slice(0, 10)}): ${leaf(memory.summary)}`);
    }
    for (const memory of fresh) {
      memoryLines.push(`Memory from ${leaf(memory.from)}: ${leaf(memory.summary)}`);
    }
  }

  // Living World relationship standing between characters present in this chat.
  const relationshipLines: string[] = [];
  if (db && characterIds.length > 1) {
    try {
      const { createWorldStorage } = await import("../storage/world.storage.js");
      const world = createWorldStorage(db);
      const present = new Set(characterIds);
      const relationships = (await world.listRelationships()).filter(
        (rel) => present.has(rel.aCharacterId) && present.has(rel.bCharacterId),
      );
      const nameOf = async (id: string) => {
        const row = await chars.getById(id);
        try {
          const parsed = typeof row?.data === "string" ? JSON.parse(row.data) : row?.data;
          return typeof (parsed as { name?: unknown })?.name === "string" ? String((parsed as { name: string }).name) : "someone";
        } catch {
          return "someone";
        }
      };
      for (const rel of relationships.slice(0, 12)) {
        const a = await nameOf(rel.aCharacterId);
        const b = await nameOf(rel.bCharacterId);
        const label = rel.label ?? rel.stage;
        relationshipLines.push(
          `${leaf(a)} and ${leaf(b)} are ${leaf(label)}${rel.romance ? " (romantic)" : ""}${
            rel.summary ? ` — ${leaf(rel.summary)}` : ""
          }`,
        );
      }
    } catch (error) {
      logger.debug(error, "[memory] World relationship injection skipped");
    }
  }

  // In a 1:1 chat, how this character feels about the HUMAN — their world bond
  // rides into every DM, so they arrive already knowing (and reacting to) you.
  let userRelSection: string | null = null;
  if (db && characterIds.length === 1) {
    try {
      const { createWorldStorage, WORLD_USER_ID } = await import("../storage/world.storage.js");
      const world = createWorldStorage(db);
      const rel = await world.getRelationship(characterIds[0]!, WORLD_USER_ID);
      if (rel && (rel.summary || rel.label || rel.score !== 0 || rel.romance)) {
        const { resolveWorldUser } = await import("../world/world-engine.service.js");
        const user = await resolveWorldUser(db);
        const label = rel.label ?? rel.stage;
        userRelSection = wrapContent(
          `${leaf(label)}${rel.romance ? " (romantic)" : ""}${rel.summary ? ` — ${leaf(rel.summary)}` : ""} (warmth ${rel.score})`,
          `How they feel about ${user.name}`,
          wrapFormat,
          1,
        );
      }
    } catch (error) {
      logger.debug(error, "[memory] World user-relationship injection skipped");
    }
  }

  if (memoryLines.length === 0 && relationshipLines.length === 0 && !userRelSection) return awarenessBlock;

  const sections: string[] = [];
  if (memoryLines.length) sections.push(wrapContent(memoryLines.join("\n"), "Memories", wrapFormat, 1));
  if (relationshipLines.length) {
    sections.push(wrapContent(relationshipLines.join("\n"), "How they stand with each other", wrapFormat, 1));
  }
  if (userRelSection) sections.push(userRelSection);
  const memoriesSection = sections.join("\n\n");
  if (awarenessBlock) {
    if (wrapFormat === "xml") {
      return awarenessBlock.replace(/<\/awareness>$/, `${memoriesSection}\n</awareness>`);
    }
    return `${awarenessBlock}\n\n${memoriesSection}`;
  }
  return wrapContent(memoriesSection, "Awareness", wrapFormat);
}
