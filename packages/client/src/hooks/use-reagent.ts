import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export interface ReagentWorkspaceInfo {
  workspaceDir: string;
  memory: string;
  files: Array<{ path: string; kind: "file" | "dir"; bytes: number; modifiedAt: string }>;
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

export function useUpdateReagentMemory(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.put<{ memory: string }>(`/reagent/${chatId}/memory`, { content }),
    onSuccess: () => {
      if (chatId) qc.invalidateQueries({ queryKey: reagentKeys.workspace(chatId) });
    },
  });
}

export function respondToReagentApproval(id: string, decision: "approved" | "denied") {
  return api.post<{ ok: boolean }>(`/reagent/approvals/${id}`, { decision });
}
