// ──────────────────────────────────────────────
// REagent shell approvals: a command that needs the user's answer parks here
// until the client posts a decision, or the wait runs out.
// ──────────────────────────────────────────────

import type { ReagentApprovalRequest } from "@marinara-engine/shared";
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
