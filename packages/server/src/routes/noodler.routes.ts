// ──────────────────────────────────────────────
// Routes: NoodleR (private/paywalled Noodle accounts)
//
// Split out of noodle.routes.ts: these are the OnlyFans-style mechanic —
// create/delete a private profile, retry its stage-identity generation,
// browse the NoodleR hub, subscribe/unsubscribe, unlock a PPV post, and
// trigger fan activity. Registered at the same "/noodle" prefix as
// noodleRoutes so client URLs are unchanged.
//
// The underlying generation machinery (stage-identity/avatar generation,
// linked-identity resolution, image-prompt sanitization) stays in
// noodle.routes.ts and is imported here, since it's also used by the core
// Noodle refresh loop (buildRefreshPrompt/generateNoodlePostImage) — those
// are genuinely shared, not NoodleR-exclusive, so moving them would just
// relocate the entanglement rather than remove it.
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { noodleSubscribeSchema, noodleUnlockPostSchema, noodlePrivateAccountCreateSchema } from "@marinara-engine/shared";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createNoodleStorage } from "../services/storage/noodle.storage.js";
import { isNoodleRefreshLocked, withNoodleRefreshLock } from "../services/noodle/noodle-refresh-lock.js";
import {
  ensurePrivateAccountIdentity,
  isNoodleAccountHiddenFromViewer,
  resolvePersonaAccount,
  simulateNoodlerFanActivity,
  tryGenerateNoodlerReaction,
} from "./noodle.routes.js";

export async function noodlerRoutes(app: FastifyInstance) {
  const noodle = createNoodleStorage(app.db);
  const characters = createCharactersStorage(app.db);
  const connections = createConnectionsStorage(app.db);

  app.post("/accounts/:id/private", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodlePrivateAccountCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const publicAccount = await noodle.getAccountById(id);
    if (!publicAccount) return reply.code(404).send({ error: "Noodle account not found" });
    const created = await noodle.createPrivateAccount(id);
    if (!created) return reply.code(400).send({ error: "Could not create a private Noodle account for that account." });

    return ensurePrivateAccountIdentity({
      noodle,
      connections,
      characters,
      app,
      publicAccount,
      privateAccount: created,
      requestedStageProfile: parsed.data.stageProfile,
    });
  });

  app.delete("/accounts/:id/private", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await noodle.deletePrivateAccount(id);
    if (!deleted) return reply.code(404).send({ error: "NoodleR profile not found" });
    return deleted;
  });

  app.post("/accounts/:id/private/retry-identity", async (req, reply) => {
    const { id } = req.params as { id: string };
    const privateAccount = await noodle.getAccountById(id);
    if (!privateAccount || privateAccount.visibility !== "private") {
      return reply.code(404).send({ error: "NoodleR profile not found" });
    }
    const allAccounts = await noodle.listAccounts();
    const publicAccount = allAccounts.find((account) => account.linkedAccountId === privateAccount.id);
    if (!publicAccount) return reply.code(404).send({ error: "Linked public Noodle account not found" });
    return ensurePrivateAccountIdentity({
      noodle,
      connections,
      characters,
      app,
      publicAccount,
      privateAccount,
    });
  });

  app.post("/accounts/:id/private/simulate-fans", async (req, reply) => {
    const { id } = req.params as { id: string };
    const privateAccount = await noodle.getAccountById(id);
    if (!privateAccount || privateAccount.visibility !== "private") {
      return reply.code(404).send({ error: "NoodleR profile not found" });
    }
    if (isNoodleRefreshLocked(privateAccount.id)) {
      return reply.code(409).send({ error: "Wait for the current NoodleR activity to finish." });
    }
    const result = await withNoodleRefreshLock(privateAccount.id, () =>
      simulateNoodlerFanActivity({ noodle, connections, characters, privateAccount }),
    );
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result;
  });

  app.get("/noodler/hub", async (req, reply) => {
    const parsed = noodleSubscribeSchema.safeParse({
      subscriberKind: (req.query as Record<string, unknown>).subscriberKind,
      subscriberEntityId: (req.query as Record<string, unknown>).subscriberEntityId,
    });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let subscriber = await noodle.getAccountByEntity(parsed.data.subscriberKind, parsed.data.subscriberEntityId);
    if (!subscriber && parsed.data.subscriberKind === "persona") {
      subscriber = await resolvePersonaAccount(noodle, characters, parsed.data.subscriberEntityId);
    }
    if (!subscriber) return reply.code(404).send({ error: "Noodle subscriber not found" });

    const privateAccounts = await noodle.listPrivateAccounts();
    // A private account always shares kind+entityId with the public account it's
    // linked from, so we can split owned-vs-browsable without a reverse lookup:
    // "persona" private accounts are the caller's own NoodleR pages, "character"
    // ones are creators to subscribe to.
    const owned = privateAccounts.filter((account) => account.kind === "persona");
    // A page never leaks its own existence to itself, so hidden-from only
    // applies to accounts other than the requesting subscriber.
    const creatorAccounts = privateAccounts
      .filter((account) => account.kind === "character")
      .filter((account) => !isNoodleAccountHiddenFromViewer(account, subscriber.id));
    const subscriptions = await noodle.listSubscriptionsForSubscriber(subscriber.id);
    const subscribedCreatorIds = new Set(subscriptions.map((subscription) => subscription.creatorAccountId));
    return {
      owned,
      subscribed: creatorAccounts.filter((account) => subscribedCreatorIds.has(account.id)),
      discover: creatorAccounts.filter((account) => !subscribedCreatorIds.has(account.id)),
    };
  });

  app.post("/accounts/:id/subscribe", async (req, reply) => {
    const { id: creatorAccountId } = req.params as { id: string };
    const parsed = noodleSubscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const creator = await noodle.getAccountById(creatorAccountId);
    if (!creator) return reply.code(404).send({ error: "Noodle account not found" });
    let subscriber = await noodle.getAccountByEntity(parsed.data.subscriberKind, parsed.data.subscriberEntityId);
    if (!subscriber && parsed.data.subscriberKind === "persona") {
      subscriber = await resolvePersonaAccount(noodle, characters, parsed.data.subscriberEntityId);
    }
    if (!subscriber) return reply.code(404).send({ error: "Noodle subscriber not found" });
    // Don't reveal a hidden-from page's existence via a different status code.
    if (isNoodleAccountHiddenFromViewer(creator, subscriber.id)) {
      return reply.code(404).send({ error: "Noodle account not found" });
    }
    const subscription = await noodle.subscribe(subscriber.id, creator.id);
    if (!subscription) return reply.code(400).send({ error: "Could not subscribe to that account." });
    const triggerPost = await noodle.getMostRecentPostByAuthor(creator.id);
    const reaction = await tryGenerateNoodlerReaction({
      noodle,
      connections,
      creator,
      subscriberDisplayName: subscriber.displayName,
      triggerPost,
      kind: "subscribe",
    });
    return { ...subscription, reaction };
  });

  app.delete("/accounts/:id/subscribe", async (req, reply) => {
    const { id: creatorAccountId } = req.params as { id: string };
    const parsed = noodleSubscribeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let subscriber = await noodle.getAccountByEntity(parsed.data.subscriberKind, parsed.data.subscriberEntityId);
    if (!subscriber && parsed.data.subscriberKind === "persona") {
      subscriber = await resolvePersonaAccount(noodle, characters, parsed.data.subscriberEntityId);
    }
    if (!subscriber) return reply.code(404).send({ error: "Noodle subscriber not found" });
    await noodle.unsubscribe(subscriber.id, creatorAccountId);
    return { ok: true };
  });

  app.post("/posts/:id/unlock", async (req, reply) => {
    const { id: postId } = req.params as { id: string };
    const parsed = noodleUnlockPostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const post = await noodle.getPostById(postId);
    if (!post) return reply.code(404).send({ error: "Noodle post not found" });
    let actor = await noodle.getAccountByEntity(parsed.data.actorKind, parsed.data.actorEntityId);
    if (!actor && parsed.data.actorKind === "persona") {
      actor = await resolvePersonaAccount(noodle, characters, parsed.data.actorEntityId);
    }
    if (!actor) return reply.code(404).send({ error: "Noodle actor not found" });
    const postAuthor = await noodle.getAccountById(post.authorAccountId);
    if (postAuthor && isNoodleAccountHiddenFromViewer(postAuthor, actor.id)) {
      return reply.code(404).send({ error: "Noodle post not found" });
    }
    const unlock = await noodle.unlockPost(actor.id, postId);
    const creator = await noodle.getAccountById(post.authorAccountId);
    const reaction = creator
      ? await tryGenerateNoodlerReaction({
          noodle,
          connections,
          creator,
          subscriberDisplayName: actor.displayName,
          triggerPost: post,
          kind: "unlock",
        })
      : null;
    return { ...unlock, reaction };
  });
}
