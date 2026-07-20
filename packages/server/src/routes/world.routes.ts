// ──────────────────────────────────────────────
// Routes: Living World (feed, relationships, config, manual tick)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";

import { createWorldStorage, WORLD_USER_ID } from "../services/storage/world.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createNoodleStorage } from "../services/storage/noodle.storage.js";
import { createChatFoldersStorage } from "../services/storage/chat-folders.storage.js";
import { getAtmosphere } from "../services/world/world-atmosphere.service.js";
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

  // ── City: places + who's where + wallets/jobs ──
  app.get("/city", async () => {
    const places = await world.listPlaces();
    const minds = await world.listMinds();
    const names = await buildNameMap();
    // Map each place to its scene chat (if one exists) so the UI can open it.
    const chats = createChatsStorage(app.db);
    const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown }>;
    const sceneChatByPlace: Record<string, string> = {};
    for (const chat of allChats) {
      const meta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
      if (meta?.worldPlaceScene === true && typeof meta.worldPlaceId === "string") {
        sceneChatByPlace[meta.worldPlaceId] = chat.id;
      }
    }
    const placesWithScene = places.map((place) => ({ ...place, sceneChatId: sceneChatByPlace[place.id] ?? null }));
    const peopleByPlace: Record<string, string[]> = {};
    const residents = minds
      .filter((mind) => names[mind.id])
      .map((mind) => ({
        characterId: mind.id,
        name: names[mind.id] ?? "Unknown",
        placeId: mind.placeId,
        money: mind.money,
        job: mind.job,
        needs: mind.needs,
      }));
    for (const resident of residents) {
      if (resident.placeId) {
        (peopleByPlace[resident.placeId] ??= []).push(resident.name);
      }
    }
    const userMind = minds.find((mind) => mind.id === WORLD_USER_ID);
    return { places: placesWithScene, residents, peopleByPlace, names, userPlaceId: userMind?.placeId ?? null };
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
    const saved = await saveWorldEngineConfig(app.db, config);
    // Provision immediately (mind rows + invited Noodle accounts) so newly
    // added members are findable on Noodle without waiting for a cycle.
    if (saved.mode === "minds") {
      const { ensureMindsInitialized, invalidateMindsInit } = await import(
        "../services/world/character-mind.service.js"
      );
      // A config change may add members or toggle noodle — force a full pass.
      invalidateMindsInit();
      await ensureMindsInitialized(app.db, saved).catch((error) =>
        app.log.warn(error, "[world] Member provisioning after config save failed"),
      );
    }
    return saved;
  });

  app.get("/atmosphere", async () => {
    const config = await loadWorldEngineConfig(app.db);
    return getAtmosphere(app.db, config.weatherLocation);
  });

  app.get("/status", async () => {
    const config = await loadWorldEngineConfig(app.db);
    const state = await loadWorldEngineState(app.db);
    const provider = await resolveWorldProvider(app.db, config);
    const timeline = await world.pendingActionStats();
    const atmosphere = await getAtmosphere(app.db, config.weatherLocation);
    const mindRows = (await world.listMinds()).filter(
      (mind) => config.memberCharacterIds === null || config.memberCharacterIds.includes(mind.id),
    );
    const nextWakes = mindRows
      .map((mind) => mind.nextWakeAt)
      .filter((at): at is string => typeof at === "string")
      .sort();
    return {
      config,
      state,
      timeline,
      atmosphere,
      minds: { count: mindRows.length, nextWakeAt: nextWakes[0] ?? null },
      provider: "error" in provider ? { ok: false, error: provider.error } : { ok: true, label: provider.label },
    };
  });

  // ── Manual "advance the world now" (plans a window + plays the first due moments;
  //    works while the engine is disabled — great for testing) ──
  app.post("/tick", async () => runWorldTick(app.db, { manual: true, app }));

  // ── Open (or create) a private DM between you and a world character. Powers
  //    the "Message" button on Noodle — returns the chat id to jump into. ──
  app.post<{ Body: { characterId?: string } }>("/dm", async (req, reply) => {
    const characterId = String((req.body as { characterId?: unknown } | undefined)?.characterId ?? "").trim();
    if (!characterId) return reply.code(400).send({ error: "characterId required" });
    const { ensureUserDmChat } = await import("../services/world/character-mind.service.js");
    const chatId = await ensureUserDmChat(app.db, characterId);
    if (!chatId) return reply.code(404).send({ error: "character not found" });
    return { ok: true, chatId };
  });

  // ── YOU move through the world: set where you are (null = nowhere/offline).
  //    People already there notice you walk in. Returns the place's chat id. ──
  app.post<{ Body: { placeId?: string | null } }>("/go", async (req, reply) => {
    const { WORLD_USER_ID } = await import("../services/storage/world.storage.js");
    const placeId = (req.body as { placeId?: string | null } | undefined)?.placeId ?? null;
    if (placeId === null) {
      await world.upsertMind(WORLD_USER_ID, { placeId: null });
      return { ok: true, placeId: null, chatId: null };
    }
    const place = await world.getPlace(String(placeId));
    if (!place) return reply.code(404).send({ error: "place not found" });
    await world.upsertMind(WORLD_USER_ID, {
      placeId: place.id,
      cursors: { arrivedAt: new Date().toISOString() },
    });
    const { ensurePlaceSceneChat } = await import("../services/world/character-mind.service.js");
    const chatId = await ensurePlaceSceneChat(app.db, place);
    // Arrival spark: whoever is here notices you walk in.
    const names = await buildNameMap();
    for (const mind of (await world.listMinds()).filter((m) => m.placeId === place.id && names[m.id]).slice(0, 4)) {
      await world.bumpMindWake(mind.id, new Date(Date.now() + (0.2 + Math.random()) * 60_000).toISOString());
    }
    return { ok: true, placeId: place.id, chatId };
  });

  // ── Create a public place of your own design. ──
  app.post<{ Body: { name?: string; kind?: string; description?: string; interior?: string } }>(
    "/place",
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = String(body.name ?? "").trim();
      if (!name) return reply.code(400).send({ error: "name required" });
      const { place, created } = await world.ensurePlace({
        name,
        kind: typeof body.kind === "string" && body.kind.trim() ? body.kind.trim() : "place",
        description: typeof body.description === "string" ? body.description : "",
        interior: typeof body.interior === "string" ? body.interior : "",
      });
      const { ensurePlaceSceneChat } = await import("../services/world/character-mind.service.js");
      const chatId = await ensurePlaceSceneChat(app.db, place);
      return { ok: true, created, place, chatId };
    },
  );

  // ── Edit a place: rename, and/or add to its description/interior. ──
  app.patch<{ Params: { id: string }; Body: { name?: string; kind?: string; description?: string; interior?: string } }>(
    "/place/:id",
    async (req, reply) => {
      const place = await world.getPlace(req.params.id);
      if (!place) return reply.code(404).send({ error: "place not found" });
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.name === "string" && body.name.trim()) {
        await world.renameHomePlace(place.id, body.name.trim(), String(body.kind ?? place.kind));
      }
      await world.enrichPlace(place.id, {
        addition: typeof body.description === "string" && body.description.trim() ? body.description.trim() : undefined,
        interior: typeof body.interior === "string" && body.interior.trim() ? body.interior.trim() : undefined,
      });
      return { ok: true, place: await world.getPlace(place.id) };
    },
  );

  // ── Start a group you're in with the chosen world characters. ──
  app.post<{ Body: { characterIds?: string[]; name?: string } }>("/group", async (req, reply) => {
    const body = (req.body ?? {}) as { characterIds?: unknown; name?: unknown };
    const characterIds = Array.isArray(body.characterIds)
      ? body.characterIds.filter((id): id is string => typeof id === "string")
      : [];
    if (!characterIds.length) return reply.code(400).send({ error: "characterIds required" });
    const { ensureUserGroupChat } = await import("../services/world/character-mind.service.js");
    const chatId = await ensureUserGroupChat(app.db, characterIds, typeof body.name === "string" ? body.name : undefined);
    if (!chatId) return reply.code(400).send({ error: "no valid world members" });
    return { ok: true, chatId };
  });

  // ── Reset the world: wipe all Living World state (events, relationships,
  //    minds, queued actions), the world chats, their folder, and — when asked —
  //    the Noodle timeline. Config is preserved. ──
  app.post<{ Body: { resetNoodle?: boolean } }>("/reset", async (req) => {
    const resetNoodle = (req.body as { resetNoodle?: boolean } | undefined)?.resetNoodle !== false;
    const chats = createChatsStorage(app.db);
    const noodle = createNoodleStorage(app.db);
    const folders = createChatFoldersStorage(app.db);

    // Remove world chats (life spaces, DMs, groups, hangouts).
    const allChats = (await chats.list()) as Array<{ id: string; metadata?: unknown }>;
    let removedChats = 0;
    for (const chat of allChats) {
      const meta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
      if (
        meta?.worldLifeChat === true ||
        meta?.worldDmThread === true ||
        meta?.worldGroupThread === true ||
        meta?.worldPlaceScene === true
      ) {
        await chats.remove(chat.id);
        removedChats += 1;
      }
    }
    // Remove the (now-empty) Living World folders (one per sidebar tab).
    for (const folder of await folders.list()) {
      if (folder.name === "Living World") await folders.remove(folder.id);
    }
    await world.resetWorld();
    if (resetNoodle) await noodle.resetTimeline();
    // Minds/places are gone — force re-provisioning on the next cycle instead
    // of trusting the process-level "already converged" cache.
    const { invalidateMindsInit } = await import("../services/world/character-mind.service.js");
    invalidateMindsInit();

    return { ok: true, removedChats, resetNoodle };
  });
}
