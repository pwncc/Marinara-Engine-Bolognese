import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DB } from "../../packages/server/src/db/connection.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { createNoodleStorage } from "../../packages/server/src/services/storage/noodle.storage.js";
import { createNoodlerProjectsStorage } from "../../packages/server/src/services/storage/noodler-projects.storage.js";
import {
  eligibleNoodlerCreatorAccounts,
  selectNoodlerCreator,
} from "../../packages/server/src/services/noodle/noodler-creator-selection.js";

const storageDir = mkdtempSync(join(tmpdir(), "marinara-noodler-projects-"));
process.env.FILE_STORAGE_DIR = storageDir;

try {
  const db = await createFileNativeDB();
  const noodle = createNoodleStorage(db as unknown as DB);
  const projects = createNoodlerProjectsStorage(db as unknown as DB);
  const publicAccount = await noodle.upsertAccountFromProfile({
    kind: "character",
    entityId: "project-character",
    displayName: "Project Character",
  });
  assert.equal(
    await projects.create(publicAccount.id, {
      title: "Invalid public project",
      brief: "",
      toneGuidance: "",
      influence: "balanced",
      status: "draft",
      startsAt: null,
      endsAt: null,
      minimumSpacingHours: null,
    }),
    null,
  );
  const privateAccount = await noodle.createPrivateAccount(publicAccount.id);
  assert.ok(privateAccount);
  const activePrivateAccount = await noodle.updateAccount(privateAccount.id, {
    settings: {
      ...privateAccount.settings,
      stageProfile: { postingMode: "active" },
      autoPost: { enabled: true, intensity: "high" },
    },
  });
  assert.ok(activePrivateAccount);
  assert.deepEqual(eligibleNoodlerCreatorAccounts([publicAccount, activePrivateAccount]).map((item) => item.id), [
    activePrivateAccount.id,
  ]);
  assert.equal(selectNoodlerCreator([activePrivateAccount], () => 0)?.id, activePrivateAccount.id);

  const detail = await projects.create(activePrivateAccount.id, {
    title: "Moonlight Concert",
    brief: "Build toward the concert over several posts.",
    toneGuidance: "Nervous but excited.",
    influence: "focused",
    status: "active",
    startsAt: null,
    endsAt: null,
    minimumSpacingHours: null,
  });
  assert.ok(detail);
  const first = await projects.addMilestone(detail.project.id, {
    title: "Tease the concert",
    notes: "Do not reveal everything yet.",
    status: "ready",
    notBefore: null,
    dueAt: null,
    access: "subscriber",
    ppvPrice: null,
    mediaPreference: "text",
  });
  const second = await projects.addMilestone(detail.project.id, {
    title: "Reveal the stage",
    notes: "",
    status: "planned",
    notBefore: null,
    dueAt: null,
    access: "subscriber",
    ppvPrice: null,
    mediaPreference: "model_choice",
  });
  assert.ok(first);
  assert.ok(second);
  assert.equal((await projects.nextMilestone(detail.project.id))?.id, first.id);
  await projects.completeMilestone(detail.project.id, first.id, "post-1", "Concert teaser posted.");
  assert.equal((await projects.nextMilestone(detail.project.id))?.id, second.id);
  const completed = await projects.getDetail(detail.project.id);
  assert.equal(completed?.milestones[0]?.generatedPostId, "post-1");
  assert.equal(completed?.milestones[0]?.status, "completed");
  await db._fileStore.close();
  console.log("NoodleR creator projects regression passed.");
} finally {
  rmSync(storageDir, { recursive: true, force: true });
}
