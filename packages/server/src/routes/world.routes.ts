// ──────────────────────────────────────────────
// Routes: Living World (feed, relationships, config, manual tick)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";

import { createWorldStorage } from "../services/storage/world.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import {
  loadWorldEngineConfig,
  loadWorldEngineState,
  normalizeWorldEngineConfig,
  resolveWorldProvider,
  runWorldTick,
  saveWorldEngineConfig,
} from "../services/world/world-engine.service.js";

function parseCharacterName(data: unknown): string | null {
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    const name = (parsed as { name?: unknown } | null)?.name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export async function worldRoutes(app: FastifyInstance) {
  const world = createWorldStorage(app.db);
  const chars = createCharactersStorage(app.db);

  const buildNameMap = async (): Promise<Record<string, string>> => {
    const rows = (await chars.list()) as Array<{ id: string; data: unknown }>;
    const names: Record<string, string> = {};
    for (const row of rows) {
      names[row.id] = parseCharacterName(row.data) ?? "Unknown";
    }
    return names;
  };

  // ── World feed (the observable history) ──
  app.get<{ Querystring: { characterId?: string; kind?: string; limit?: string } }>("/feed", async (req) => {
    const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : 100;
    const events = await world.listEvents({
      limit: Number.isFinite(limit) ? limit : 100,
      characterId: req.query.characterId || undefined,
      kind: req.query.kind || undefined,
    });
    return { events, names: await buildNameMap() };
  });

  // ── Relationships ──
  app.get<{ Querystring: { characterId?: string } }>("/relationships", async (req) => {
    const relationships = await world.listRelationships(req.query.characterId || undefined);
    return { relationships, names: await buildNameMap() };
  });

  // Pair detail: relationship + full chronological history ("how they met").
  app.get<{ Params: { aId: string; bId: string } }>("/relationships/:aId/:bId", async (req) => {
    const relationship = await world.getRelationship(req.params.aId, req.params.bId);
    const events = await world.listPairEvents(req.params.aId, req.params.bId);
    return { relationship, events, names: await buildNameMap() };
  });

  // ── Config & status ──
  app.get("/config", async () => loadWorldEngineConfig(app.db));

  app.put("/config", async (req) => {
    const config = normalizeWorldEngineConfig(req.body);
    return saveWorldEngineConfig(app.db, config);
  });

  app.get("/status", async () => {
    const config = await loadWorldEngineConfig(app.db);
    const state = await loadWorldEngineState(app.db);
    const provider = await resolveWorldProvider(app.db, config);
    const timeline = await world.pendingActionStats();
    return {
      config,
      state,
      timeline,
      provider: "error" in provider ? { ok: false, error: provider.error } : { ok: true, label: provider.label },
    };
  });

  // ── Manual "advance the world now" (plans a window + plays the first due moments;
  //    works while the engine is disabled — great for testing) ──
  app.post("/tick", async () => runWorldTick(app.db, { manual: true }));
}
