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
import { z } from "zod";
import {
  noodleSubscribeSchema,
  noodleUnlockPostSchema,
  noodlePrivateAccountCreateSchema,
  noodlerMilestoneCreateSchema,
  noodlerMilestoneUpdateSchema,
  noodlerProjectCreateSchema,
  noodlerProjectUpdateSchema,
} from "@marinara-engine/shared";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createNoodleStorage } from "../services/storage/noodle.storage.js";
import { createNoodlerProjectsStorage } from "../services/storage/noodler-projects.storage.js";
import { isNoodleRefreshLocked, withNoodleRefreshLock } from "../services/noodle/noodle-refresh-lock.js";
import {
  ensurePrivateAccountIdentity,
  isNoodleAccountHiddenFromViewer,
  simulateNoodlerFanActivity,
  tryGenerateNoodlerReaction,
} from "./noodle.routes.js";
import { isNoodlePrivatePostingActive, resolvePersonaAccount } from "../services/noodle/noodle-manual-post.js";

export async function noodlerRoutes(app: FastifyInstance) {
  const noodle = createNoodleStorage(app.db);
  const characters = createCharactersStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const projects = createNoodlerProjectsStorage(app.db);

  app.get("/noodler/creator-pages", async (req) => {
    const rawIds = (req.query as Record<string, unknown>).characterIds;
    const characterIds = new Set(
      typeof rawIds === "string"
        ? rawIds
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    );
    const accounts = (await noodle.listPrivateAccounts()).filter(
      (account) => account.kind === "character" && characterIds.has(account.entityId),
    );
    return Promise.all(
      accounts.map(async (account) => {
        const projectDetails = await projects.list(account.id);
        const activeProject = projectDetails.find((detail) => detail.project.status === "active") ?? null;
        const nextMilestone = activeProject
          ? activeProject.milestones.find((item) => item.status === "ready" || item.status === "planned") ?? null
          : null;
        return { account, activeProject: activeProject?.project ?? null, nextMilestone };
      }),
    );
  });

  app.get("/accounts/:id/projects", async (req, reply) => {
    const { id } = req.params as { id: string };
    const account = await noodle.getAccountById(id);
    if (!account || account.visibility !== "private") return reply.code(404).send({ error: "NoodleR profile not found" });
    return projects.list(id);
  });

  app.post("/accounts/:id/projects", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodlerProjectCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const created = await projects.create(id, parsed.data);
    if (!created) return reply.code(404).send({ error: "NoodleR profile not found" });
    return created;
  });

  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodlerProjectUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const updated = await projects.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "NoodleR project not found" });
    return updated;
  });

  app.post("/projects/:id/milestones", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodlerMilestoneCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const created = await projects.addMilestone(id, parsed.data);
    if (!created) return reply.code(404).send({ error: "NoodleR project not found" });
    return created;
  });

  app.patch("/projects/:projectId/milestones/:id", async (req, reply) => {
    const { projectId, id } = req.params as { projectId: string; id: string };
    const parsed = noodlerMilestoneUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const updated = await projects.updateMilestone(projectId, id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "NoodleR milestone not found" });
    return updated;
  });

  app.post("/projects/:id/generate-next", async (req, reply) => {
    const { id } = req.params as { id: string };
    const request = z
      .object({ milestoneId: z.string().min(1).optional(), connectionId: z.string().min(1).optional() })
      .safeParse(req.body ?? {});
    if (!request.success) return reply.code(400).send({ error: request.error.flatten() });
    const detail = await projects.getDetail(id);
    if (!detail) return reply.code(404).send({ error: "NoodleR project not found" });
    const account = await noodle.getAccountById(detail.project.creatorAccountId);
    if (!account || account.visibility !== "private") return reply.code(404).send({ error: "NoodleR profile not found" });
    if (!isNoodlePrivatePostingActive(account)) {
      return reply.code(403).send({ error: "Passive NoodleR profiles cannot generate project posts." });
    }
    const next = request.data.milestoneId
      ? detail.milestones.find(
          (item) =>
            item.id === request.data.milestoneId && (item.status === "planned" || item.status === "ready"),
        ) ?? null
      : await projects.nextMilestone(id);
    if (!next) return reply.code(400).send({ error: "This project has no milestone ready to generate." });
    const existingProjectPost = (
      await noodle.listSurfacePosts("private", { authorAccountId: account.id, limit: 100 })
    ).find((post) => post.metadata.projectMilestoneId === next.id);
    if (existingProjectPost) {
      const updated = await projects.completeMilestone(id, next.id, existingProjectPost.id, existingProjectPost.content);
      return { project: updated, post: existingProjectPost };
    }
    const completed = detail.milestones
      .filter((milestone) => milestone.status === "completed")
      .map((milestone) => `${milestone.title}: ${milestone.completionSummary}`)
      .join("\n");
    const influence =
      detail.project.influence === "loose"
        ? "Use this beat as inspiration while preserving spontaneous character voice."
        : detail.project.influence === "focused"
          ? "Directly fulfill this beat without quoting the planning text or mentioning the project."
          : "Clearly advance this beat while preserving spontaneous character voice.";
    const includeImage = next.mediaPreference === "image" || next.mediaPreference === "text_and_image";
    const projectPrompt = [
      `Current milestone: ${next.title.slice(0, 240)}. ${next.notes.slice(0, 300)}`,
      influence,
      "Never mention projects, milestones, schedules, prompts, or planning metadata in the post.",
      `Private creator project brief: ${detail.project.brief.slice(0, 250)}`,
      detail.project.toneGuidance ? `Tone guidance: ${detail.project.toneGuidance.slice(0, 150)}` : "",
      completed ? `Already completed beats; do not repeat them:\n${completed.slice(0, 250)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const response = await app.inject({
      method: "POST",
      url: "/api/noodle/refresh",
      payload: {
        targetAccountId: account.id,
        ...(request.data.connectionId ? { connectionId: request.data.connectionId } : {}),
        privateProjectWork: { projectId: id, milestoneId: next.id },
        privatePostGuide: {
          access: next.access,
          ...(next.ppvPrice !== null ? { ppvPrice: next.ppvPrice } : {}),
          includeText: next.mediaPreference !== "image",
          includeImage,
          requireImage: next.mediaPreference !== "model_choice",
          theme: detail.project.title,
          prompt: projectPrompt,
        },
      },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return reply.code(response.statusCode).send(response.json());
    }
    const result = response.json() as { createdPostIds?: string[] };
    const postId = result.createdPostIds?.[0];
    const post = postId ? await noodle.getPostById(postId) : null;
    if (!post) return reply.code(500).send({ error: "The project post was not persisted." });
    const updated = await projects.completeMilestone(id, next.id, post.id, post.content);
    return { project: updated, post };
  });

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
    // Marinara is single-player: this tab is the director's management view,
    // while subscriptions/discover below remain scoped to the selected persona.
    const owned = privateAccounts;
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
