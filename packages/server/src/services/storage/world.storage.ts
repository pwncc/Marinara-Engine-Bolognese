// ──────────────────────────────────────────────
// Storage: Living World events + character relationships
// ──────────────────────────────────────────────
import { and, desc, eq, or } from "../../db/file-query.js";
import { characterRelationships, worldEvents } from "../../db/schema/index.js";
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
