// ──────────────────────────────────────────────
// Storage: Living World events + character relationships
// ──────────────────────────────────────────────
import { and, desc, eq, or } from "../../db/file-query.js";
import {
  characterMinds,
  characterRelationships,
  worldActions,
  worldEvents,
  worldPlaces,
} from "../../db/schema/index.js";
import { normalizeTextForMatch } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { newId, now } from "../../utils/id-generator.js";
import {
  getRelationshipStage,
  type CharacterRelationshipRecord,
  type RelationshipMilestoneEntry,
  type WorldEventRecord,
} from "@marinara-engine/shared";

function parseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== "string") return Array.isArray(raw) ? (raw as T[]) : [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toEventRecord(row: Record<string, unknown>): WorldEventRecord {
  return {
    id: String(row.id),
    kind: String(row.kind ?? ""),
    summary: String(row.summary ?? ""),
    characterIds: parseJsonArray<string>(row.characterIds),
    detail: parseJsonRecord(row.detail),
    createdAt: String(row.createdAt ?? ""),
  };
}

function toRelationshipRecord(row: Record<string, unknown>): CharacterRelationshipRecord {
  const score = Math.max(-100, Math.min(100, Math.round(Number(row.score ?? 0) || 0)));
  const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : null;
  return {
    id: String(row.id),
    aCharacterId: String(row.aCharacterId),
    bCharacterId: String(row.bCharacterId),
    score,
    romance: row.romance === "true" || row.romance === true,
    label,
    stage: getRelationshipStage(score),
    summary: String(row.summary ?? ""),
    milestones: parseJsonArray<RelationshipMilestoneEntry>(row.milestones),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

/** Normalize a pair so (a, b) is order-independent. */
export function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export interface CharacterMindRow {
  id: string;
  intention: string;
  mood: string;
  lastWakeAt: string | null;
  nextWakeAt: string | null;
  cursors: Record<string, unknown>;
  placeId: string | null;
  money: number;
  job: string;
  createdAt: string;
  updatedAt: string;
}

function toMindRow(row: Record<string, unknown>): CharacterMindRow {
  return {
    id: String(row.id),
    intention: String(row.intention ?? ""),
    mood: String(row.mood ?? ""),
    lastWakeAt: typeof row.lastWakeAt === "string" ? row.lastWakeAt : null,
    nextWakeAt: typeof row.nextWakeAt === "string" ? row.nextWakeAt : null,
    cursors: parseJsonRecord(row.cursors),
    placeId: typeof row.placeId === "string" && row.placeId ? row.placeId : null,
    money: Number.isFinite(Number(row.money)) ? Number(row.money) : 0,
    job: String(row.job ?? ""),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

export interface WorldPlaceRow {
  id: string;
  name: string;
  kind: string;
  description: string;
  detail: number;
  tags: string[];
  discoveredBy: string | null;
  ownerId: string | null;
  visitCount: number;
  createdAt: string;
  updatedAt: string;
}

function toPlaceRow(row: Record<string, unknown>): WorldPlaceRow {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    kind: String(row.kind ?? "place"),
    description: String(row.description ?? ""),
    detail: Number.isFinite(Number(row.detail)) ? Number(row.detail) : 0,
    tags: parseJsonArray<string>(row.tags),
    discoveredBy: typeof row.discoveredBy === "string" && row.discoveredBy ? row.discoveredBy : null,
    ownerId: typeof row.ownerId === "string" && row.ownerId ? row.ownerId : null,
    visitCount: Number.isFinite(Number(row.visitCount)) ? Number(row.visitCount) : 0,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

export interface AppendWorldEventInput {
  kind: string;
  summary: string;
  characterIds: string[];
  detail?: Record<string, unknown>;
}

export interface UpsertRelationshipInput {
  delta?: number;
  romance?: boolean;
  label?: string | null;
  summary?: string;
  milestone?: { title: string; description: string; eventId?: string };
}

export function createWorldStorage(db: DB) {
  return {
    async appendEvent(input: AppendWorldEventInput): Promise<WorldEventRecord> {
      const row = {
        id: newId(),
        kind: input.kind,
        summary: input.summary,
        characterIds: JSON.stringify(input.characterIds),
        detail: JSON.stringify(input.detail ?? {}),
        createdAt: now(),
      };
      await db.insert(worldEvents).values(row);
      return toEventRecord(row);
    },

    async getEvent(id: string): Promise<WorldEventRecord | null> {
      const rows = await db.select().from(worldEvents).where(eq(worldEvents.id, id));
      return rows[0] ? toEventRecord(rows[0]) : null;
    },

    // ── Upcoming timeline (director-planned, drip-executed) ──

    async enqueueActions(
      inputs: Array<{ runAt: string; action: Record<string, unknown>; directorRunId?: string }>,
    ): Promise<number> {
      const timestamp = now();
      for (const input of inputs) {
        await db.insert(worldActions).values({
          id: newId(),
          runAt: input.runAt,
          action: JSON.stringify(input.action),
          status: "pending",
          directorRunId: input.directorRunId ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      return inputs.length;
    },

    async listDueActions(nowIso: string, limit = 10): Promise<
      Array<{ id: string; runAt: string; action: Record<string, unknown> }>
    > {
      const rows = await db.select().from(worldActions).where(eq(worldActions.status, "pending"));
      return rows
        .map((row) => ({ id: String(row.id), runAt: String(row.runAt), action: parseJsonRecord(row.action) }))
        .filter((row) => row.runAt <= nowIso)
        .sort((a, b) => a.runAt.localeCompare(b.runAt))
        .slice(0, limit);
    },

    async pendingActionStats(): Promise<{ count: number; nextRunAt: string | null }> {
      const rows = await db.select().from(worldActions).where(eq(worldActions.status, "pending"));
      const runAts = rows.map((row) => String(row.runAt)).sort();
      return { count: rows.length, nextRunAt: runAts[0] ?? null };
    },

    async markAction(id: string, status: "done" | "failed" | "skipped"): Promise<void> {
      await db.update(worldActions).set({ status, updatedAt: now() }).where(eq(worldActions.id, id));
    },

    /** Drop old finished rows so the queue table stays small. */
    async pruneFinishedActions(keep = 200): Promise<void> {
      const rows = await db.select().from(worldActions);
      const finished = rows
        .filter((row) => row.status !== "pending")
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      for (const row of finished.slice(keep)) {
        await db.delete(worldActions).where(eq(worldActions.id, row.id));
      }
    },

    // ── Character minds (minds mode) ──

    async getMind(characterId: string): Promise<CharacterMindRow | null> {
      const rows = await db.select().from(characterMinds).where(eq(characterMinds.id, characterId));
      return rows[0] ? toMindRow(rows[0]) : null;
    },

    async listMinds(): Promise<CharacterMindRow[]> {
      const rows = await db.select().from(characterMinds);
      return rows.map(toMindRow);
    },

    /** Wipe all Living World state: events, relationships, queue, minds, places. */
    async resetWorld(): Promise<void> {
      await db.delete(worldActions);
      await db.delete(worldEvents);
      await db.delete(characterRelationships);
      await db.delete(characterMinds);
      await db.delete(worldPlaces);
    },

    async upsertMind(
      characterId: string,
      patch: Partial<Omit<CharacterMindRow, "id" | "createdAt" | "updatedAt">>,
    ): Promise<CharacterMindRow> {
      const existing = await this.getMind(characterId);
      const timestamp = now();
      const next = {
        intention: (patch.intention ?? existing?.intention ?? "").slice(0, 300),
        mood: (patch.mood ?? existing?.mood ?? "").slice(0, 200),
        lastWakeAt: patch.lastWakeAt !== undefined ? patch.lastWakeAt : (existing?.lastWakeAt ?? null),
        nextWakeAt: patch.nextWakeAt !== undefined ? patch.nextWakeAt : (existing?.nextWakeAt ?? null),
        cursors: JSON.stringify(patch.cursors ?? existing?.cursors ?? {}),
        placeId: patch.placeId !== undefined ? patch.placeId : (existing?.placeId ?? null),
        money: String(patch.money !== undefined ? patch.money : (existing?.money ?? 0)),
        job: (patch.job ?? existing?.job ?? "").slice(0, 160),
        updatedAt: timestamp,
      };
      if (existing) {
        await db.update(characterMinds).set(next).where(eq(characterMinds.id, characterId));
        return (await this.getMind(characterId))!;
      }
      const row = { id: characterId, createdAt: timestamp, ...next };
      await db.insert(characterMinds).values(row);
      return toMindRow(row);
    },

    // ── The living city (world_places) ──

    async listPlaces(): Promise<WorldPlaceRow[]> {
      const rows = await db.select().from(worldPlaces);
      return rows.map(toPlaceRow).sort((a, b) => b.visitCount - a.visitCount);
    },

    async getPlace(id: string): Promise<WorldPlaceRow | null> {
      const rows = await db.select().from(worldPlaces).where(eq(worldPlaces.id, id));
      return rows[0] ? toPlaceRow(rows[0]) : null;
    },

    async getHomePlace(ownerId: string): Promise<WorldPlaceRow | null> {
      const rows = await db.select().from(worldPlaces).where(eq(worldPlaces.ownerId, ownerId));
      return rows[0] ? toPlaceRow(rows[0]) : null;
    },

    /** Find an existing place by fuzzy name, or create it (discovery). */
    async ensurePlace(input: {
      name: string;
      kind?: string;
      description?: string;
      tags?: string[];
      discoveredBy?: string | null;
      ownerId?: string | null;
    }): Promise<{ place: WorldPlaceRow; created: boolean }> {
      const wanted = normalizeTextForMatch(input.name);
      const all = await db.select().from(worldPlaces);
      const match = all.map(toPlaceRow).find((place) => normalizeTextForMatch(place.name) === wanted);
      if (match) return { place: match, created: false };
      const timestamp = now();
      const row = {
        id: newId(),
        name: input.name.trim().slice(0, 80),
        kind: (input.kind ?? "place").trim().slice(0, 40) || "place",
        description: (input.description ?? "").trim().slice(0, 800),
        detail: input.description ? "1" : "0",
        tags: JSON.stringify((input.tags ?? []).slice(0, 12)),
        discoveredBy: input.discoveredBy ?? null,
        ownerId: input.ownerId ?? null,
        visitCount: "0",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.insert(worldPlaces).values(row);
      return { place: toPlaceRow(row), created: true };
    },

    async renameHomePlace(id: string, name: string, kind: string): Promise<void> {
      await db
        .update(worldPlaces)
        .set({ name: name.trim().slice(0, 80), kind: kind.trim().slice(0, 40) || "home", updatedAt: now() })
        .where(eq(worldPlaces.id, id));
    },

    /** Add detail to a place — append to its description, bump its detail level. */
    async enrichPlace(id: string, input: { addition?: string; tags?: string[]; incrementVisit?: boolean }): Promise<void> {
      const existing = await this.getPlace(id);
      if (!existing) return;
      const addition = input.addition?.trim();
      const description = addition
        ? `${existing.description}${existing.description ? " " : ""}${addition}`.slice(0, 1600)
        : existing.description;
      const tags = input.tags?.length
        ? [...new Set([...existing.tags, ...input.tags])].slice(0, 16)
        : existing.tags;
      await db
        .update(worldPlaces)
        .set({
          description,
          detail: String(existing.detail + (addition ? 1 : 0)),
          tags: JSON.stringify(tags),
          visitCount: String(existing.visitCount + (input.incrementVisit ? 1 : 0)),
          updatedAt: now(),
        })
        .where(eq(worldPlaces.id, id));
    },

    /**
     * Pull a character's wake earlier (they were pinged — DM, group message,
     * user intrusion), never later. Ping-wakes bypass the world's global pace:
     * answering promptly is the one fast thing real people do.
     */
    async bumpMindWake(characterId: string, notLaterThanIso: string): Promise<void> {
      const existing = await this.getMind(characterId);
      const cursors = { ...(existing?.cursors ?? {}), wakeReason: "ping" };
      if (!existing || !existing.nextWakeAt || existing.nextWakeAt > notLaterThanIso) {
        await this.upsertMind(characterId, { nextWakeAt: notLaterThanIso, cursors });
      } else {
        await this.upsertMind(characterId, { cursors });
      }
    },

    async updateEventDetail(id: string, patch: Record<string, unknown>): Promise<void> {
      const rows = await db.select().from(worldEvents).where(eq(worldEvents.id, id));
      const existing = rows[0];
      if (!existing) return;
      const detail = { ...parseJsonRecord(existing.detail), ...patch };
      await db.update(worldEvents).set({ detail: JSON.stringify(detail) }).where(eq(worldEvents.id, id));
    },

    async listEvents(options: { limit?: number; characterId?: string; kind?: string } = {}): Promise<
      WorldEventRecord[]
    > {
      const limit = Math.max(1, Math.min(500, options.limit ?? 100));
      let rows = await db.select().from(worldEvents).orderBy(desc(worldEvents.createdAt));
      let events = rows.map(toEventRecord);
      if (options.kind) events = events.filter((event) => event.kind === options.kind);
      if (options.characterId) {
        events = events.filter((event) => event.characterIds.includes(options.characterId!));
      }
      return events.slice(0, limit);
    },

    /** Chronological history of everything between two characters. */
    async listPairEvents(x: string, y: string, limit = 200): Promise<WorldEventRecord[]> {
      const rows = await db.select().from(worldEvents).orderBy(desc(worldEvents.createdAt));
      const events = rows
        .map(toEventRecord)
        .filter((event) => event.characterIds.includes(x) && event.characterIds.includes(y))
        .slice(0, limit);
      return events.reverse();
    },

    async listRelationships(characterId?: string): Promise<CharacterRelationshipRecord[]> {
      const rows = characterId
        ? await db
            .select()
            .from(characterRelationships)
            .where(
              or(
                eq(characterRelationships.aCharacterId, characterId),
                eq(characterRelationships.bCharacterId, characterId),
              ),
            )
        : await db.select().from(characterRelationships);
      return rows.map(toRelationshipRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getRelationship(x: string, y: string): Promise<CharacterRelationshipRecord | null> {
      const [a, b] = orderPair(x, y);
      const rows = await db
        .select()
        .from(characterRelationships)
        .where(and(eq(characterRelationships.aCharacterId, a), eq(characterRelationships.bCharacterId, b)));
      return rows[0] ? toRelationshipRecord(rows[0]) : null;
    },

    async upsertRelationship(x: string, y: string, input: UpsertRelationshipInput): Promise<CharacterRelationshipRecord> {
      const [a, b] = orderPair(x, y);
      const existing = await this.getRelationship(a, b);
      const timestamp = now();

      const baseScore = existing?.score ?? 0;
      const delta = Number.isFinite(input.delta) ? Math.max(-25, Math.min(25, Math.round(input.delta!))) : 0;
      const score = Math.max(-100, Math.min(100, baseScore + delta));

      const milestones: RelationshipMilestoneEntry[] = [...(existing?.milestones ?? [])];
      if (input.milestone?.title) {
        milestones.push({
          at: timestamp,
          title: input.milestone.title.slice(0, 120),
          description: (input.milestone.description ?? "").slice(0, 500),
          eventId: input.milestone.eventId,
        });
      }

      const next = {
        score: String(score),
        romance: String(input.romance ?? existing?.romance ?? false),
        label:
          input.label === undefined ? (existing?.label ?? null) : input.label && input.label.trim() ? input.label.trim().slice(0, 60) : null,
        summary: (input.summary?.trim() || existing?.summary || "").slice(0, 600),
        milestones: JSON.stringify(milestones.slice(-40)),
        updatedAt: timestamp,
      };

      if (existing) {
        await db.update(characterRelationships).set(next).where(eq(characterRelationships.id, existing.id));
        return (await this.getRelationship(a, b))!;
      }
      const row = {
        id: newId(),
        aCharacterId: a,
        bCharacterId: b,
        createdAt: timestamp,
        ...next,
      };
      await db.insert(characterRelationships).values(row);
      return toRelationshipRecord(row);
    },
  };
}

export type WorldStorage = ReturnType<typeof createWorldStorage>;
