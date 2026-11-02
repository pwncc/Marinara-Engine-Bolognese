import { useEffect, useRef } from "react";
import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { chatKeys } from "./use-chats";

export interface ReagentWorkspaceInfo {
  workspaceDir: string;
  memory: string;
  /** The simulation ledger file as text. */
  simulation: string;
  files: Array<{ path: string; kind: "file" | "dir"; bytes: number; modifiedAt: string }>;
  dossiers: Array<{ path: string; name: string; content: string }>;
}

export const reagentKeys = {
  workspace: (chatId: string) => ["reagent", "workspace", chatId] as const,
};

export function useReagentWorkspace(chatId: string | null, enabled = true) {
  const qc = useQueryClient();
  // The workspace is a fold of the transcript, so it changes whenever the messages do: after a reply,
  // a swipe, a delete, a restore. Re-read it each time the message list has been fetched again.
  const fetchingMessages = useIsFetching({ queryKey: chatKeys.messages(chatId ?? "") });
  const wasFetching = useRef(fetchingMessages);
  useEffect(() => {
    if (wasFetching.current > 0 && fetchingMessages === 0 && chatId) {
      void qc.invalidateQueries({ queryKey: reagentKeys.workspace(chatId) });
    }
    wasFetching.current = fetchingMessages;
  }, [chatId, fetchingMessages, qc]);
  return useQuery({
    queryKey: reagentKeys.workspace(chatId ?? ""),
    queryFn: () => api.get<ReagentWorkspaceInfo>(`/reagent/${chatId}/workspace`),
    enabled: !!chatId && enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** Save (or, with null content, remove) a hand-editable workspace file: memory.md or a dossier. */
export function useUpdateReagentFile(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; content: string | null }) =>
      api.put<{ path: string; content: string | null }>(`/reagent/${chatId}/file`, input),
    onSuccess: () => {
      if (chatId) qc.invalidateQueries({ queryKey: reagentKeys.workspace(chatId) });
    },
  });
}

/** Answer a question the character asked while reasoning; null skips it. */
export function respondToReagentQuestion(id: string, answer: string | null) {
  return api.post<{ ok: boolean }>(`/reagent/questions/${id}`, { answer });
}

export function respondToReagentApproval(id: string, decision: "approved" | "denied") {
  return api.post<{ ok: boolean }>(`/reagent/approvals/${id}`, { decision });
}
