import assert from "node:assert/strict";
import type { GameState, PresentCharacter } from "@marinara-engine/shared";

// The regression runner owns the disposable data directory; never open the user's profile.
assert.ok(process.env.DATA_DIR, "Run this fixture with scripts/run-regressions.mjs");
process.env.NODE_ENV = "test";
const { createFileNativeDB } = await import("../../packages/server/src/db/file-backed-store.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createGameStateStorage } = await import("../../packages/server/src/services/storage/game-state.storage.js");
const { materializeWorkspace, holdReagentWorkspace } =
  await import("../../packages/server/src/services/reagent/reagent-workspace.js");
const { seedSceneState, returnSceneState } =
  await import("../../packages/server/src/services/generation/scene-state-transfer.js");
const db = await createFileNativeDB();
const chats = createChatsStorage(db);
const states = createGameStateStorage(db);
const person = (name: string, notes: string): PresentCharacter => ({
  characterId: name,
  name,
  emoji: "",
  mood: "calm",
  appearance: null,
  outfit: null,
  thoughts: null,
  customFields: {},
  stats: [],
  notes,
  limbs: { hand: "holding the key" },
});
const snapshot = (
  chatId: string,
  messageId: string,
  presentCharacters: PresentCharacter[],
): Omit<GameState, "id" | "createdAt"> => ({
  chatId,
  messageId,
  swipeIndex: 0,
  presentCharacters,
  date: "2026-11-20",
  time: "10:00",
  location: "Library",
  weather: null,
  temperature: null,
  recentEvents: [],
  playerStats: null,
  personaStats: null,
  committed: true,
});
try {
  const origin = await chats.create({ name: "Origin", mode: "conversation", characterIds: [] });
  const scene = await chats.create({ name: "Scene", mode: "roleplay", characterIds: [] });
  assert.ok(origin && scene);
  await chats.patchMetadata(scene.id, { enableAgents: false, activeAgentIds: [] });
  const originReply = await chats.createMessage({ chatId: origin.id, role: "assistant", content: "Before the scene." });
  const opening = await chats.createMessage({ chatId: scene.id, role: "assistant", content: "Welcome." });
  assert.ok(originReply && opening);
  await states.create(snapshot(origin.id, originReply.id, [person("Alice", "tired"), person("Bob", "waiting")]));
  await chats.patchMetadata(origin.id, {
    reagent: { enabled: true },
    enableAgents: true,
    activeAgentIds: ["character-tracker"],
    reagentUserFileEdits: [
      { path: "memory.md", content: "They know the library.", afterMessageId: null, at: new Date().toISOString() },
    ],
  });
  await seedSceneState({ db, originChatId: origin.id, sceneChatId: scene.id, openingMessageId: opening.id });
  const metadata = (await chats.getById(scene.id))!.metadata;
  const sceneMeta = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  assert.equal(sceneMeta.enableAgents, false, "upstream's Roleplay profile controls agent switches");
  assert.deepEqual(sceneMeta.activeAgentIds, []);
  assert.equal(sceneMeta.reagent.enabled, true, "custom settings carry when the profile has no override");
  const seeded = await states.getLatest(scene.id);
  assert.equal(seeded?.messageId, opening.id, "the snapshot follows upstream's separate character opening");
  assert.equal(JSON.parse(String(seeded?.presentCharacters))[0].notes, "tired");
  assert.equal((await materializeWorkspace(db, scene.id)).state["memory.md"], "They know the library.");

  const profileScene = await chats.create({ name: "Profile scene", mode: "roleplay", characterIds: [] });
  assert.ok(profileScene);
  await chats.patchMetadata(profileScene.id, { reagent: { enabled: false } });
  const profileOpening = await chats.createMessage({ chatId: profileScene.id, role: "assistant", content: "Hello." });
  assert.ok(profileOpening);
  await seedSceneState({
    db,
    originChatId: origin.id,
    sceneChatId: profileScene.id,
    openingMessageId: profileOpening.id,
  });
  const profileMetadata = (await chats.getById(profileScene.id))!.metadata;
  const profileMeta = typeof profileMetadata === "string" ? JSON.parse(profileMetadata) : profileMetadata;
  assert.equal(profileMeta.reagent.enabled, false, "the Roleplay profile's explicit custom settings win too");
  assert.equal((await materializeWorkspace(db, profileScene.id)).state["memory.md"], "They know the library.");

  // A read while a reply holds the workspace cannot erase its in-flight writes.
  const release = holdReagentWorkspace(scene.id);
  try {
    assert.equal((await materializeWorkspace(db, scene.id, { unlessHeld: true })).held, true);
  } finally {
    release();
  }

  await states.create(snapshot(scene.id, opening.id, [person("Alice", "rested")]));
  await chats.updateMessageExtra(opening.id, {
    reagentFiles: { "memory.md": "They found the book.", "characters/alice.md": "Keeps the key." },
  });
  const returnReply = await chats.createMessage({ chatId: origin.id, role: "narrator", content: "They returned." });
  assert.ok(returnReply);
  const returned = await returnSceneState({
    db,
    sceneChatId: scene.id,
    originChatId: origin.id,
    returnMessageId: returnReply.id,
  });
  assert.equal(returned.tracker, true);
  assert.deepEqual(new Set(returned.files), new Set(["memory.md", "characters/alice.md"]));
  const people = JSON.parse(String((await states.getLatest(origin.id))?.presentCharacters));
  assert.deepEqual(
    people.map((row: PresentCharacter) => [row.name, row.notes]),
    [
      ["Alice", "rested"],
      ["Bob", "waiting"],
    ],
  );
  const workspace = await materializeWorkspace(db, origin.id);
  assert.equal(workspace.state["memory.md"], "They found the book.");
  assert.equal(workspace.state["characters/alice.md"], "Keeps the key.");

  // A legacy scene that was never seeded cannot overwrite the origin with its empty state.
  const legacy = await chats.create({ name: "Legacy", mode: "roleplay", characterIds: [] });
  assert.ok(legacy);
  assert.deepEqual(
    await returnSceneState({ db, sceneChatId: legacy.id, originChatId: origin.id, returnMessageId: null }),
    { tracker: false, files: [] },
  );
} finally {
  await db._fileStore.close();
}
console.info("Scene state transfer regression passed.");
