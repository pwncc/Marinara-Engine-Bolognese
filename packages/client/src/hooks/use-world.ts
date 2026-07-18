// ──────────────────────────────────────────────
// Living World engine — React Query hooks
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CharacterRelationshipRecord,
  WorldEngineConfig,
  WorldEngineState,
  WorldEventRecord,
} from "@marinara-engine/shared";
import { api } from "../lib/api-client";
import { useUIStore } from "../stores/ui.store";

export const worldKeys = {
  all: ["world"] as const,
  status: () => [...worldKeys.all, "status"] as const,
  feed: (characterId: string | null) => [...worldKeys.all, "feed", characterId ?? "all"] as const,
  relationships: () => [...worldKeys.all, "relationships"] as const,
  pair: (aId: string, bId: string) => [...worldKeys.all, "pair", aId, bId] as const,
};

export interface WorldStatusResponse {
  config: WorldEngineConfig;
  state: WorldEngineState;
  timeline: { count: number; nextRunAt: string | null };
  minds: { count: number; nextWakeAt: string | null };
  provider: { ok: boolean; label?: string; error?: string };
}

export interface WorldFeedResponse {
  events: WorldEventRecord[];
  names: Record<string, string>;
}

export interface WorldRelationshipsResponse {
  relationships: CharacterRelationshipRecord[];
  names: Record<string, string>;
}

export interface WorldPairResponse {
  relationship: CharacterRelationshipRecord | null;
  events: WorldEventRecord[];
  names: Record<string, string>;
}

export interface WorldTickResponse {
  ok: boolean;
  ran: boolean;
  narration: string | null;
  actionsPlanned: number;
  queued: number;
  executedNow: number;
  skippedReason: string | null;
  error: string | null;
  events: WorldEventRecord[];
}

/** Poll only while the World panel is the visible right panel. */
function useWorldPanelVisible(): boolean {
  return useUIStore((s) => s.rightPanelOpen && s.rightPanel === "world");
}

export function useWorldStatus() {
  const visible = useWorldPanelVisible();
  return useQuery({
    queryKey: worldKeys.status(),
    queryFn: () => api.get<WorldStatusResponse>("/world/status"),
    refetchInterval: visible ? 15_000 : false,
    staleTime: 5_000,
  });
}

export function useWorldFeed(characterId: string | null) {
  const visible = useWorldPanelVisible();
  return useQuery({
    queryKey: worldKeys.feed(characterId),
    queryFn: () =>
      api.get<WorldFeedResponse>(`/world/feed?limit=120${characterId ? `&characterId=${characterId}` : ""}`),
    refetchInterval: visible ? 15_000 : false,
    staleTime: 5_000,
  });
}

export function useWorldRelationships() {
  const visible = useWorldPanelVisible();
  return useQuery({
    queryKey: worldKeys.relationships(),
    queryFn: () => api.get<WorldRelationshipsResponse>("/world/relationships"),
    refetchInterval: visible ? 30_000 : false,
    staleTime: 5_000,
  });
}

export function useWorldPair(aId: string | null, bId: string | null) {
  return useQuery({
    queryKey: worldKeys.pair(aId ?? "", bId ?? ""),
    queryFn: () => api.get<WorldPairResponse>(`/world/relationships/${aId}/${bId}`),
    enabled: !!aId && !!bId,
    staleTime: 10_000,
  });
}

export function useUpdateWorldConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: WorldEngineConfig) => api.put<WorldEngineConfig>("/world/config", config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worldKeys.status() });
    },
  });
}

export function useRunWorldTick() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<WorldTickResponse>("/world/tick", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worldKeys.all });
    },
  });
}
