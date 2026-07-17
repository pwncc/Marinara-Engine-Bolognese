import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DB } from "../../packages/server/src/db/connection.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { createNoodleStorage } from "../../packages/server/src/services/storage/noodle.storage.js";
import { createCharactersStorage } from "../../packages/server/src/services/storage/characters.storage.js";
import {
  createManualNoodlePost,
  isNoodlePrivatePostingActive,
  noodlePpvPriceMetadata,
} from "../../packages/server/src/services/noodle/noodle-manual-post.js";
import { resolveNoodleAvatarCropAfterProfileUpdate } from "../../packages/server/src/services/noodle/noodle-profile-avatar.js";
import { noodleRefreshSchema } from "../../packages/shared/src/schemas/noodle.schema.js";

const sourceCrop = { x: 12, y: 18, width: 62, height: 62, unit: "%" as const };
assert.equal(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: undefined,
    currentCrop: sourceCrop,
  }),
  undefined,
);
assert.deepEqual(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: "/avatar.png",
    currentCrop: sourceCrop,
  }),
  sourceCrop,
);
assert.deepEqual(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: undefined,
    currentCrop: null,
    sourceAvatarUrl: "/avatar.png",
    sourceCrop,
  }),
  sourceCrop,
);
assert.deepEqual(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: "/avatar.png",
    currentCrop: null,
    sourceAvatarUrl: "/avatar.png",
    sourceCrop,
  }),
  sourceCrop,
);
assert.equal(
  resolveNoodleAvatarCropAfterProfileUpdate({
    currentAvatarUrl: "/avatar.png",
    nextAvatarUrl: "/replacement.png",
    currentCrop: sourceCrop,
  }),
  null,
);

const storageDir = mkdtempSync(join(tmpdir(), "marinara-noodle-settings-"));
process.env.FILE_STORAGE_DIR = storageDir;

try {
  const firstDb = await createFileNativeDB();
  const firstNoodle = createNoodleStorage(firstDb as unknown as DB);
  const firstCharacters = createCharactersStorage(firstDb as unknown as DB);
  assert.equal((await firstNoodle.getSettings()).noodler.showPublicPostsOnNoodle, false);
  const updated = await firstNoodle.updateSettings({
    maxImagesPerRefresh: 9,
    allowRandomUsers: true,
    enableNoodler: true,
    maxGeneratedPostsPerRefresh: 11,
    noodler: {
      enableFanActivityScheduler: true,
      showPublicPostsOnNoodle: true,
      creatorPosts: { enabled: true, postsPerDay: 4, generationConnectionId: null },
    },
  });
  assert.equal(updated.maxImagesPerRefresh, 9);
  assert.equal(updated.allowRandomUsers, true);
  assert.equal(updated.maxGeneratedPostsPerRefresh, 11);
  assert.equal(updated.noodler.enableFanActivityScheduler, true);
  assert.equal(updated.noodler.showPublicPostsOnNoodle, true);
  assert.equal(updated.noodler.creatorPosts.postsPerDay, 4);
  const partiallyUpdatedCreatorSchedule = await firstNoodle.updateSettings({
    noodler: { creatorPosts: { enabled: false } },
  });
  assert.equal(partiallyUpdatedCreatorSchedule.noodler.creatorPosts.enabled, false);
  assert.equal(partiallyUpdatedCreatorSchedule.noodler.creatorPosts.postsPerDay, 4);
  const partiallyUpdated = await firstNoodle.updateSettings({ allowRandomUsers: false });
  assert.equal(partiallyUpdated.allowRandomUsers, false);
  assert.equal(partiallyUpdated.noodler.enableFanActivityScheduler, true);
  assert.equal(partiallyUpdated.noodler.showPublicPostsOnNoodle, true);
  const refreshRun = await firstNoodle.createRefreshRun({
    activeAccountIds: ["alpha"],
    prompt: "Generate a Noodle timeline.",
  });
  assert.deepEqual(refreshRun.attempts, []);
  const rejectedResponse = "{not valid timeline JSON";
  const rejectionReason = "the response was not valid timeline JSON (full parser detail)";
  await firstNoodle.recordRefreshAttempt(refreshRun.id, {
    sequence: 1,
    kind: "initial",
    response: rejectedResponse,
    rejectionReason,
    createdAt: "2026-07-15T19:00:00.000Z",
  });
  const correctedResponse = '{"posts":[{"authorHandle":"alpha","content":"Valid"}]}';
  await firstNoodle.recordRefreshAttempt(refreshRun.id, {
    sequence: 2,
    kind: "correction",
    response: correctedResponse,
    rejectionReason: null,
    createdAt: "2026-07-15T19:00:01.000Z",
  });
  await firstNoodle.finishRefreshRun(refreshRun.id, { status: "completed", result: correctedResponse });
  const legacyRefreshRun = await firstNoodle.createRefreshRun({
    activeAccountIds: ["legacy"],
    prompt: "Legacy refresh prompt.",
  });
  await firstNoodle.finishRefreshRun(legacyRefreshRun.id, { status: "completed", result: "legacy result" });
  const characterAccount = await firstNoodle.upsertAccountFromProfile({
    kind: "character",
    entityId: "renamed-character",
    displayName: "Old Card Name",
    avatarUrl: "/old-avatar.png",
    bio: "Generated Noodle biography",
    invited: true,
    syncIdentity: true,
  });
  await firstNoodle.updateAccount(characterAccount.id, {
    displayName: "Generated Social Name",
    handle: "custom_handle",
    bio: "Keep this generated biography",
    settings: { profileGenerated: true, location: "Snezhnaya" },
  });
  const renamedCharacterAccount = await firstNoodle.upsertAccountFromProfile({
    kind: "character",
    entityId: "renamed-character",
    displayName: "New Card Name",
    avatarUrl: "/new-avatar.png",
    syncIdentity: true,
  });
  assert.equal(renamedCharacterAccount.displayName, "New Card Name");
  assert.equal(renamedCharacterAccount.avatarUrl, "/new-avatar.png");
  assert.equal(renamedCharacterAccount.handle, "custom_handle");
  assert.equal(renamedCharacterAccount.bio, "Keep this generated biography");
  assert.deepEqual(renamedCharacterAccount.settings, { profileGenerated: true, location: "Snezhnaya" });

  const privateAccount = await firstNoodle.createPrivateAccount(renamedCharacterAccount.id);
  assert.ok(privateAccount);
  const publicSurfacePost = await firstNoodle.createPost({
    authorAccountId: renamedCharacterAccount.id,
    content: "PUBLIC_SURFACE_MARKER",
  });
  const privateSurfacePost = await firstNoodle.createPost({
    authorAccountId: privateAccount.id,
    content: "PRIVATE_SURFACE_MARKER",
    access: "subscriber",
  });
  assert.ok(publicSurfacePost);
  assert.ok(privateSurfacePost);
  assert.deepEqual(
    (await firstNoodle.listSurfacePosts("public", { limit: 20 })).map((post) => post.content),
    ["PUBLIC_SURFACE_MARKER"],
  );
  assert.deepEqual(
    (await firstNoodle.listSurfacePosts("private", { limit: 20 })).map((post) => post.content),
    ["PRIVATE_SURFACE_MARKER"],
  );
  assert.deepEqual(
    (await firstNoodle.listSurfacePosts("private", { authorAccountId: privateAccount.id })).map(
      (post) => post.content,
    ),
    ["PRIVATE_SURFACE_MARKER"],
  );
  assert.equal(await firstNoodle.hasSurfacePostsBefore("public", "9999-12-31T23:59:59.999Z"), true);
  assert.equal(await firstNoodle.hasSurfacePostsBefore("private", "9999-12-31T23:59:59.999Z"), true);
  const passivePrivateAccount = await firstNoodle.updateAccount(privateAccount.id, {
    settings: {
      ...privateAccount.settings,
      stageProfile: { postingMode: "passive" },
      autoPost: { enabled: false },
    },
  });
  assert.ok(passivePrivateAccount);
  assert.equal(isNoodlePrivatePostingActive(passivePrivateAccount), false);

  const explicitManualPost = await createManualNoodlePost(firstNoodle, firstCharacters, {
    authorKind: passivePrivateAccount.kind,
    authorEntityId: passivePrivateAccount.entityId,
    authorAccountId: passivePrivateAccount.id,
    content: "Manual post from a passive page.",
    access: "ppv",
    ppvPrice: 12.5,
  });
  assert.ok("post" in explicitManualPost);
  assert.equal(explicitManualPost.post.authorAccountId, passivePrivateAccount.id);
  assert.equal(explicitManualPost.post.metadata.ppvPrice, 12.5);

  const manualTargetPost = await createManualNoodlePost(firstNoodle, firstCharacters, {
    authorKind: passivePrivateAccount.kind,
    authorEntityId: passivePrivateAccount.entityId,
    target: "noodler",
    content: "Manual command post from a passive page.",
  });
  assert.ok("post" in manualTargetPost);
  assert.equal(manualTargetPost.post.authorAccountId, passivePrivateAccount.id);

  assert.deepEqual(noodlePpvPriceMetadata("ppv", 19.99), { ppvPrice: 19.99 });
  assert.deepEqual(noodlePpvPriceMetadata("subscriber", 19.99), {});
  assert.equal(
    noodleRefreshSchema.parse({ privatePostGuide: { access: "ppv", ppvPrice: 999_999 } }).privatePostGuide
      ?.ppvPrice,
    999_999,
  );
  assert.equal(
    noodleRefreshSchema.safeParse({ privatePostGuide: { access: "ppv", ppvPrice: -0.01 } }).success,
    false,
  );
  assert.equal(
    noodleRefreshSchema.safeParse({ privatePostGuide: { access: "ppv", ppvPrice: 1_000_000 } }).success,
    false,
  );
  await firstDb._fileStore.close();

  const refreshRunsPath = join(storageDir, "tables", "noodle_refresh_runs.json");
  const persistedRefreshRuns = JSON.parse(readFileSync(refreshRunsPath, "utf8")) as Array<Record<string, unknown>>;
  const legacyPersistedRun = persistedRefreshRuns.find((entry) => entry.id === legacyRefreshRun.id);
  assert.ok(legacyPersistedRun);
  delete legacyPersistedRun.attempts;
  writeFileSync(refreshRunsPath, JSON.stringify(persistedRefreshRuns));

  const reopenedDb = await createFileNativeDB();
  const reopenedNoodle = createNoodleStorage(reopenedDb as unknown as DB);
  const reopenedSettings = await reopenedNoodle.getSettings();
  assert.equal(reopenedSettings.maxImagesPerRefresh, 9);
  assert.equal(reopenedSettings.allowRandomUsers, false);
  assert.equal(reopenedSettings.maxGeneratedPostsPerRefresh, 11);
  assert.equal(reopenedSettings.noodler.enableFanActivityScheduler, true);
  const reopenedRuns = await reopenedNoodle.listRefreshRuns({ status: "completed", limit: 2 });
  const reopenedRun = reopenedRuns.find((entry) => entry.id === refreshRun.id);
  assert.equal(reopenedRun?.result, correctedResponse);
  assert.deepEqual(reopenedRun?.attempts, [
    {
      sequence: 1,
      kind: "initial",
      response: rejectedResponse,
      rejectionReason,
      createdAt: "2026-07-15T19:00:00.000Z",
    },
    {
      sequence: 2,
      kind: "correction",
      response: correctedResponse,
      rejectionReason: null,
      createdAt: "2026-07-15T19:00:01.000Z",
    },
  ]);
  assert.deepEqual(
    reopenedRuns.find((entry) => entry.id === legacyRefreshRun.id)?.attempts,
    [],
  );
  await reopenedDb._fileStore.close();
} finally {
  rmSync(storageDir, { recursive: true, force: true });
}

process.stdout.write("Noodle settings persistence regression passed.\n");
