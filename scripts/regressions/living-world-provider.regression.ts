import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DEFAULT_WORLD_ENGINE_CONFIG } from "../../packages/shared/src/index.js";

assert.ok(process.env.DATA_DIR, "Run with scripts/run-regressions.mjs for isolated storage");
const { createFileNativeDB } = await import("../../packages/server/src/db/file-backed-store.js");
const { createConnectionsStorage } = await import("../../packages/server/src/services/storage/connections.storage.js");
const { resolveWorldProvider } = await import("../../packages/server/src/services/world/world-engine.service.js");
const { tryBackgroundConnection, resetConnectionAdmissionForTests } =
  await import("../../packages/server/src/services/generation/connection-admission.js");

let arrived!: () => void;
let finish!: () => void;
const requested = new Promise<void>((resolve) => (arrived = resolve));
const responseAllowed = new Promise<void>((resolve) => (finish = resolve));
const server = createServer(async (_request, response) => {
  arrived();
  await responseAllowed;
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: "World reply." }, finish_reason: "stop" }] }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const db = await createFileNativeDB();
let pending: Promise<unknown> | undefined;
try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const connection = await createConnectionsStorage(db).create({
    name: "World connection",
    provider: "custom",
    model: "fixture",
    apiKey: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  assert.ok(connection);
  resetConnectionAdmissionForTests();
  const world = await resolveWorldProvider(db, { ...DEFAULT_WORLD_ENGINE_CONFIG, connectionId: connection.id });
  assert.ok(!("error" in world));
  pending = world.provider.chatComplete([{ role: "user", content: "Look around." }], {
    model: world.model,
    stream: false,
    maxTokens: 32,
  });
  await requested;
  const concurrent = tryBackgroundConnection(connection.id, new Date());
  if (concurrent.acquired) concurrent.release("completed");
  assert.equal(concurrent.acquired, false, "World calls participate in upstream's connection admission");
  finish();
  assert.equal(((await pending) as { content: string }).content, "World reply.");
} finally {
  finish();
  await pending;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db._fileStore.close();
  resetConnectionAdmissionForTests();
}
console.info("Living World provider regression passed.");
