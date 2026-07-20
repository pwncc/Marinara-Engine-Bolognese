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
  city: () => [...worldKeys.all, "city"] as const,
};

export interface WorldPlace {
  id: string;
  name: string;
  kind: string;
  description: string;
  interior: string;
  detail: number;
  tags: string[];
  discoveredBy: string | null;
  ownerId: string | null;
  visitCount: number;
  sceneChatId: string | null;
}

export interface WorldResident {
  characterId: string;
  name: string;
  placeId: string | null;
  money: number;
  job: string;
  needs: { energy: number; hunger: number; social: number };
}

export interface WorldCityResponse {
  places: WorldPlace[];
  residents: WorldResident[];
  peopleByPlace: Record<string, string[]>;
  names: Record<string, string>;
  /** Where YOU currently are (null = nowhere in particular). */
  userPlaceId: string | null;
}

export interface WorldAtmosphere {
  dayPart: string;
  weekday: string;
  phase: string;
  season: string;
  dateLabel: string;
  holiday: string | null;
  weather: { tempC: number; condition: string; isDay: boolean; location: string } | null;
  summary: string;
}

export interface WorldStatusResponse {
  config: WorldEngineConfig;
  state: WorldEngineState;
  timeline: { count: number; nextRunAt: string | null };
  atmosphere: WorldAtmosphere;
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

export function useWorldCity() {
  const visible = useWorldPanelVisible();
  return useQuery({
    queryKey: worldKeys.city(),
    queryFn: () => api.get<WorldCityResponse>("/world/city"),
    refetchInterval: visible ? 20_000 : false,
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

export function useResetWorld() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resetNoodle: boolean) =>
      api.post<{ ok: boolean; removedChats: number }>("/world/reset", { resetNoodle }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worldKeys.all });
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

/** Move yourself to a place (null = leave). Returns the place's chat id. */
export function useGoToPlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (placeId: string | null) =>
      api.post<{ ok: boolean; placeId: string | null; chatId: string | null }>("/world/go", { placeId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worldKeys.city() });
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

/** Create a public place of your own design. */
export function useCreatePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; kind?: string; description?: string; interior?: string }) =>
      api.post<{ ok: boolean; created: boolean; place: WorldPlace; chatId: string }>("/world/place", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: worldKeys.city() });
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

/** Open (or create) a private DM with a world character — returns its chat id. */
export function useCreateWorldUserDm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) => api.post<{ ok: boolean; chatId: string }>("/world/dm", { characterId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

/** Start a group you're in with the chosen world characters — returns its chat id. */
export function useCreateWorldGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { characterIds: string[]; name?: string }) =>
      api.post<{ ok: boolean; chatId: string }>("/world/group", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}
