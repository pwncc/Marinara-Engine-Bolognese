// ──────────────────────────────────────────────
// Routes: REagent workspace and approvals
// ──────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REAGENT_MEMORY_FILE, readReagentUserFileEdits, type ReagentUserFileEdit } from "@marinara-engine/shared";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { listPendingApprovals, resolveApproval } from "../services/reagent/reagent-approvals.js";
import {
  REAGENT_MAX_TEXT_FILE_BYTES,
  listDirectory,
  materializeWorkspace,
  readWorkspaceMemory,
} from "../services/reagent/reagent-workspace.js";

const memoryBodySchema = z.object({ content: z.string().max(REAGENT_MAX_TEXT_FILE_BYTES) });
const decisionBodySchema = z.object({ decision: z.enum(["approved", "denied"]) });

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function reagentRoutes(app: FastifyInstance) {
  const chats = createChatsStorage(app.db);

  app.get<{ Params: { chatId: string } }>("/:chatId/workspace", async (req, reply) => {
    const chat = await chats.getById(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const { workspaceDir } = await materializeWorkspace(app.db, chat.id, {
      chatMetadata: parseMetadata(chat.metadata),
    });
    return {
      workspaceDir,
      memory: await readWorkspaceMemory(workspaceDir),
      files: await listDirectory(workspaceDir),
    };
  });

  // The user's own edit rides on the transcript like the model's: anchored after the
  // newest message so it survives swipes of older replies and is kept in fold order.
  app.put<{ Params: { chatId: string } }>("/:chatId/memory", async (req, reply) => {
    const chat = await chats.getById(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const parsed = memoryBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const messages = await chats.listMessages(chat.id);
    const metadata = parseMetadata(chat.metadata);
    const edit: ReagentUserFileEdit = {
      path: REAGENT_MEMORY_FILE,
      content: parsed.data.content,
      afterMessageId: messages.at(-1)?.id ?? null,
      at: new Date().toISOString(),
    };
    // Older edits of the same file anchored to the same message are superseded.
    const edits = readReagentUserFileEdits(metadata).filter(
      (entry) => !(entry.path === edit.path && entry.afterMessageId === edit.afterMessageId),
    );
    edits.push(edit);
    await chats.patchMetadata(chat.id, { reagentUserFileEdits: edits.slice(-200) });
    const { workspaceDir } = await materializeWorkspace(app.db, chat.id, {
      messages,
      chatMetadata: { ...metadata, reagentUserFileEdits: edits },
    });
    return { memory: await readWorkspaceMemory(workspaceDir) };
  });

  app.get<{ Params: { chatId: string } }>("/:chatId/approvals", async (req) => listPendingApprovals(req.params.chatId));

  app.post<{ Params: { id: string } }>("/approvals/:id", async (req, reply) => {
    const parsed = decisionBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const found = resolveApproval(req.params.id, parsed.data.decision);
    if (!found) return reply.status(404).send({ error: "That request is no longer waiting." });
    return { ok: true };
  });
}
