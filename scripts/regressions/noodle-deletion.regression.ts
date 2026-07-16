import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DB } from "../../packages/server/src/db/connection.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { createNoodleStorage } from "../../packages/server/src/services/storage/noodle.storage.js";

const storageDir = mkdtempSync(join(tmpdir(), "marinara-noodle-deletion-"));
process.env.FILE_STORAGE_DIR = storageDir;
const fileDb = await createFileNativeDB();
const db = fileDb as unknown as DB;

try {
  const noodle = createNoodleStorage(db);
  const account = await noodle.upsertAccountFromProfile({
    kind: "persona",
    entityId: "deletion-regression-persona",
    displayName: "Deletion Regression",
  });
  const post = await noodle.createPost({ authorAccountId: account.id, content: "A live post" });
  assert.ok(post);

  const postDigest = await noodle.createDigest({
    accountIds: [account.id],
    content: "canonical post digest",
    sourcePostId: post.id,
  });
  await noodle.updatePostMedia(post.id, { metadata: { activityDigestId: postDigest.id } });

  const interaction = await noodle.createInteraction(post.id, {
    actorAccountId: account.id,
    type: "reply",
    content: "delete me",
  });
  assert.ok(interaction);
  await noodle.createDigest({
    accountIds: [account.id],
    content: "linked comment digest",
    sourcePostId: post.id,
    sourceInteractionId: interaction.id,
  });
  await noodle.createDigest({
    accountIds: [account.id],
    content: "linked comment digest revised",
    sourcePostId: post.id,
    sourceInteractionId: interaction.id,
  });
  await noodle.createDigest({
    accountIds: [account.id],
    content: "legacy unlinked comment digest",
    sourcePostId: post.id,
  });
  await noodle.createDigest({
    accountIds: [account.id],
    content: "untraceable model-authored digest",
    sourceRunId: "legacy-refresh-run",
  });

  assert.deepEqual((await noodle.listDigests()).map((digest) => digest.content).sort(), [
    "canonical post digest",
    "linked comment digest revised",
  ]);

  await noodle.deleteInteractionById(interaction.id);
  assert.deepEqual(
    (await noodle.listDigests()).map((digest) => digest.content),
    ["canonical post digest"],
  );

  await noodle.deletePost(post.id);
  assert.deepEqual(await noodle.listDigests(), []);

  const filler = await noodle.createFillerProfile({ displayName: "Temporary Filler" });
  const fillerAccount = await noodle.upsertAccountFromProfile({
    kind: "random_user",
    entityId: filler.entityId,
    displayName: filler.displayName,
  });
  const fillerPost = await noodle.createPost({ authorAccountId: fillerAccount.id, content: "Remove with roster" });
  assert.ok(fillerPost);
  const fillerReply = await noodle.createInteraction(fillerPost.id, {
    actorAccountId: account.id,
    type: "reply",
    content: "Also remove this reply",
  });
  assert.ok(fillerReply);
  await noodle.createDigest({
    accountIds: [account.id, fillerAccount.id],
    content: "Filler activity",
    sourcePostId: fillerPost.id,
    sourceInteractionId: fillerReply.id,
  });
  assert.equal(await noodle.deleteFillerProfile(filler.id), true);
  assert.equal(await noodle.getAccountById(fillerAccount.id), null);
  assert.equal(await noodle.getPostById(fillerPost.id), null);
  assert.equal(
    (await noodle.listInteractions()).some((item) => item.id === fillerReply.id),
    false,
  );
  assert.equal(
    (await noodle.listDigests()).some((item) => item.accountIds.includes(fillerAccount.id)),
    false,
  );
} finally {
  await fileDb._fileStore.close();
  rmSync(storageDir, { recursive: true, force: true });
}

process.stdout.write("Noodle deletion-memory regression passed.\n");
