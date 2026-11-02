// ──────────────────────────────────────────────
// REagent shell approvals: a command that needs the user's answer parks here
// until the client posts a decision, or the wait runs out.
// ──────────────────────────────────────────────

import type { ReagentApprovalRequest, ReagentQuestionRequest } from "@marinara-engine/shared";
import { newId } from "../../utils/id-generator.js";

export type ReagentApprovalDecision = "approved" | "denied" | "timeout";

const APPROVAL_TIMEOUT_MS = 5 * 60_000;

type Pending = {
  request: ReagentApprovalRequest;
  resolve: (decision: ReagentApprovalDecision) => void;
  timer: NodeJS.Timeout;
};

const pending = new Map<string, Pending>();

export function createApproval(
  input: Omit<ReagentApprovalRequest, "id">,
  signal?: AbortSignal,
): { request: ReagentApprovalRequest; decision: Promise<ReagentApprovalDecision> } {
  const request: ReagentApprovalRequest = { id: newId(), ...input };
  const decision = new Promise<ReagentApprovalDecision>((resolve) => {
    const finish = (value: ReagentApprovalDecision) => {
      const entry = pending.get(request.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(request.id);
      resolve(value);
    };
    const timer = setTimeout(() => finish("timeout"), APPROVAL_TIMEOUT_MS);
    pending.set(request.id, { request, resolve: finish, timer });
    signal?.addEventListener("abort", () => finish("denied"), { once: true });
  });
  return { request, decision };
}

export function resolveApproval(id: string, decision: "approved" | "denied"): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  entry.resolve(decision);
  return true;
}

export function listPendingApprovals(chatId?: string): ReagentApprovalRequest[] {
  return [...pending.values()].map((entry) => entry.request).filter((request) => !chatId || request.chatId === chatId);
}

// ── Questions to the user ──

export type ReagentQuestionOutcome =
  { status: "answered"; answer: string } | { status: "skipped" | "timeout" | "aborted" };

const QUESTION_TIMEOUT_MS = 15 * 60_000;

type PendingQuestion = {
  request: ReagentQuestionRequest;
  resolve: (outcome: ReagentQuestionOutcome) => void;
  timer: NodeJS.Timeout;
};

const pendingQuestions = new Map<string, PendingQuestion>();

/** Park a question until the client posts an answer (or a skip), the wait runs out, or the generation stops. */
export function createQuestion(
  input: Omit<ReagentQuestionRequest, "id">,
  signal?: AbortSignal,
): { request: ReagentQuestionRequest; outcome: Promise<ReagentQuestionOutcome> } {
  const request: ReagentQuestionRequest = { id: newId(), ...input };
  const outcome = new Promise<ReagentQuestionOutcome>((resolve) => {
    const finish = (value: ReagentQuestionOutcome) => {
      const entry = pendingQuestions.get(request.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingQuestions.delete(request.id);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), QUESTION_TIMEOUT_MS);
    pendingQuestions.set(request.id, { request, resolve: finish, timer });
    signal?.addEventListener("abort", () => finish({ status: "aborted" }), { once: true });
  });
  return { request, outcome };
}

/** Null answers a skip. */
export function resolveQuestion(id: string, answer: string | null): boolean {
  const entry = pendingQuestions.get(id);
  if (!entry) return false;
  entry.resolve(answer === null ? { status: "skipped" } : { status: "answered", answer });
  return true;
}

export function listPendingQuestions(chatId?: string): ReagentQuestionRequest[] {
  return [...pendingQuestions.values()]
    .map((entry) => entry.request)
    .filter((request) => !chatId || request.chatId === chatId);
}
