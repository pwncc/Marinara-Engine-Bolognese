import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

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
  return useQuery({
    queryKey: reagentKeys.workspace(chatId ?? ""),
    queryFn: () => api.get<ReagentWorkspaceInfo>(`/reagent/${chatId}/workspace`),
    enabled: !!chatId && enabled,
    staleTime: 10_000,
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

export function respondToReagentApproval(id: string, decision: "approved" | "denied") {
  return api.post<{ ok: boolean }>(`/reagent/approvals/${id}`, { decision });
}
