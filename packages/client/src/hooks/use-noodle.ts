// ──────────────────────────────────────────────
// React Query: Noodle hooks
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useUIStore } from "../stores/ui.store";
import type {
  NoodleAccount,
  NoodleAccountKind,
  NoodleBootstrap,
  NoodleCreateInteractionInput,
  NoodleCreatePostInput,
  NoodleFillerProfile,
  NoodleFillerProfileCreateInput,
  NoodleFillerProfileUpdateInput,
  NoodleInteraction,
  NoodleInteractionUpdateInput,
  NoodlePost,
  NoodlePostUpdateInput,
  NoodleRefreshInput,
  NoodleRemoveInteractionInput,
  NoodleRescheduleRefreshInput,
  NoodleRefreshSchedulerStatus,
  NoodleSettings,
  NoodleSettingsUpdateInput,
} from "@marinara-engine/shared";
import { mergeNoodlePollVoteInteractions } from "@marinara-engine/shared";
import type { ImagePromptOverride, ImagePromptReviewItem } from "../components/ui/ImagePromptReviewModal";

export type NoodleRefreshResult = {
  bootstrap: NoodleBootstrap;
  imagePromptReviewItems: ImagePromptReviewItem[];
  createdPostIds?: string[];
};

export const noodleKeys = {
  all: ["noodle"] as const,
  bootstrap: (viewerPersonaId?: string) =>
    viewerPersonaId
      ? ([...noodleKeys.all, "bootstrap", viewerPersonaId] as const)
      : ([...noodleKeys.all, "bootstrap"] as const),
  hub: (subscriberKind: NoodleAccountKind, subscriberEntityId: string) =>
    [...noodleKeys.all, "hub", subscriberKind, subscriberEntityId] as const,
};

export type NoodlerHub = {
  owned: NoodleAccount[];
  subscribed: NoodleAccount[];
  discover: NoodleAccount[];
};

function preservePollVotes(current: NoodleBootstrap | undefined, next: NoodleBootstrap): NoodleBootstrap {
  if (!current) return next;
  const interactions = mergeNoodlePollVoteInteractions(current.interactions, next.posts, next.interactions);
  return interactions === next.interactions ? next : { ...next, interactions };
}

export function useNoodle(viewerPersonaId?: string, enabled = true) {
  return useQuery({
    queryKey: noodleKeys.bootstrap(viewerPersonaId ?? "none"),
    queryFn: () => {
      const params = viewerPersonaId ? `?viewerPersonaId=${encodeURIComponent(viewerPersonaId)}` : "";
      return api.get<NoodleBootstrap>(`/noodle${params}`);
    },
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
    structuralSharing: (current, next) =>
      preservePollVotes(current as NoodleBootstrap | undefined, next as NoodleBootstrap),
  });
}

export function useLoadOlderNoodlePosts(viewerPersonaId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (before: string) =>
      api.get<{ posts: NoodlePost[]; interactions: NoodleInteraction[]; hasMore: boolean }>(
        `/noodle/posts?before=${encodeURIComponent(before)}&limit=40${viewerPersonaId ? `&viewerPersonaId=${encodeURIComponent(viewerPersonaId)}` : ""}`,
      ),
    onSuccess: (page) => {
      qc.setQueryData<NoodleBootstrap | undefined>(noodleKeys.bootstrap(viewerPersonaId ?? "none"), (current) => {
        if (!current) return current;
        const existingPostIds = new Set(current.posts.map((post) => post.id));
        const existingInteractionIds = new Set(current.interactions.map((interaction) => interaction.id));
        return {
          ...current,
          posts: [...current.posts, ...page.posts.filter((post) => !existingPostIds.has(post.id))],
          interactions: [
            ...current.interactions,
            ...page.interactions.filter((interaction) => !existingInteractionIds.has(interaction.id)),
          ],
          hasOlderHistory: page.hasMore,
        };
      });
    },
  });
}

export function useUpdateNoodleSettings() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: "noodle-settings" },
    mutationFn: (settings: NoodleSettingsUpdateInput) => api.put<NoodleSettings>("/noodle/settings", settings),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: noodleKeys.bootstrap() });
      const previous = qc.getQueriesData<NoodleBootstrap>({ queryKey: noodleKeys.bootstrap() });
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current
          ? {
              ...current,
              settings: {
                ...current.settings,
                ...patch,
                noodler: {
                  ...current.settings.noodler,
                  ...patch.noodler,
                  creatorPosts: {
                    ...current.settings.noodler.creatorPosts,
                    ...patch.noodler?.creatorPosts,
                  },
                },
              } as NoodleSettings,
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      for (const [key, value] of context?.previous ?? []) qc.setQueryData(key, value);
    },
    onSuccess: (settings) => {
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) => {
        if (!current) return current;
        // Evict private accounts/posts/subscriptions/postUnlocks from the
        // cache immediately on disable, rather than waiting for the
        // onSettled refetch (which now returns server-scoped data — see
        // bootstrap() — but there's a window before it resolves where
        // stale private rows would otherwise still be resident).
        if (settings.enableNoodler) return { ...current, settings };
        const visibleAccountIds = new Set(
          current.accounts.filter((account) => account.visibility !== "private").map((account) => account.id),
        );
        const visiblePosts = current.posts.filter((post) => visibleAccountIds.has(post.authorAccountId));
        const visiblePostIds = new Set(visiblePosts.map((post) => post.id));
        return {
          ...current,
          settings,
          accounts: current.accounts.filter((account) => visibleAccountIds.has(account.id)),
          posts: visiblePosts,
          interactions: current.interactions.filter((interaction) => visiblePostIds.has(interaction.postId)),
          subscriptions: [],
          postUnlocks: [],
        };
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useRescheduleNoodleRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NoodleRescheduleRefreshInput) =>
      api.put<NoodleRefreshSchedulerStatus>("/noodle/refresh-schedule", input),
    onSuccess: (scheduler) => {
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current ? { ...current, scheduler } : current,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useUpdateNoodleAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<NoodleAccount>) =>
      api.put<NoodleAccount>(`/noodle/accounts/${id}`, patch),
    onSuccess: (account) => {
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current
          ? {
              ...current,
              accounts: current.accounts.map((item) => (item.id === account.id ? account : item)),
            }
          : current,
      );
      qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() });
    },
  });
}

export function useInviteNoodleCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) => api.post<NoodleAccount>("/noodle/invites", { characterId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useInviteNoodleCharacters() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (characterIds: string[]) => api.post<NoodleAccount[]>("/noodle/invites/bulk", { characterIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useRemoveNoodleCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) =>
      api.delete<NoodleAccount>(`/noodle/invites/${encodeURIComponent(characterId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

/** Clear every Noodle invitation source and refresh the bootstrap cache. */
export function useClearNoodleInvites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<NoodleBootstrap>("/noodle/invites"),
    onSuccess: (bootstrap) => {
      qc.setQueriesData<NoodleBootstrap>({ queryKey: noodleKeys.bootstrap() }, bootstrap);
      qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() });
    },
  });
}

export function useCreateNoodlePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NoodleCreatePostInput) => api.post<NoodlePost>("/noodle/posts", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useUpdateNoodlePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & NoodlePostUpdateInput) =>
      api.patch<NoodlePost>(`/noodle/posts/${encodeURIComponent(id)}`, input),
    onSuccess: (post) => {
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current
          ? {
              ...current,
              posts: current.posts.map((item) => (item.id === post.id ? post : item)),
            }
          : current,
      );
      qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() });
    },
  });
}

export function useDeleteNoodlePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<NoodlePost>(`/noodle/posts/${encodeURIComponent(id)}`),
    onSuccess: (post) => {
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current
          ? {
              ...current,
              posts: current.posts.filter((item) => item.id !== post.id),
              interactions: current.interactions.filter((interaction) => interaction.postId !== post.id),
              digests: current.digests.filter((digest) => digest.sourcePostId !== post.id),
            }
          : current,
      );
      qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() });
    },
  });
}

export function useResetNoodleTimeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<NoodleBootstrap>("/noodle/timeline"),
    onSuccess: (bootstrap) => qc.setQueriesData({ queryKey: noodleKeys.bootstrap() }, bootstrap),
    onSettled: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useCreateNoodleInteraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      ...input
    }: NoodleCreateInteractionInput & {
      postId: string;
      actorKind: NoodleAccountKind;
      actorEntityId: string;
    }) => api.post<NoodleInteraction>(`/noodle/posts/${postId}/interactions`, input),
    onSuccess: (interaction) => {
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current
          ? {
              ...current,
              interactions: current.interactions.some((item) => item.id === interaction.id)
                ? current.interactions.map((item) => (item.id === interaction.id ? interaction : item))
                : [...current.interactions, interaction],
            }
          : current,
      );
    },
  });
}

export function useRemoveNoodleInteraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      ...input
    }: NoodleRemoveInteractionInput & {
      postId: string;
      actorKind: NoodleAccountKind;
      actorEntityId: string;
    }) => {
      const params = new URLSearchParams({
        actorKind: input.actorKind,
        actorEntityId: input.actorEntityId,
        type: input.type,
      });
      if (input.parentInteractionId) params.set("parentInteractionId", input.parentInteractionId);
      return api.delete<NoodleInteraction>(`/noodle/posts/${encodeURIComponent(postId)}/interactions?${params}`);
    },
    onSuccess: (interaction) => {
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current
          ? {
              ...current,
              interactions: current.interactions.filter((item) => item.id !== interaction.id),
            }
          : current,
      );
    },
  });
}

export function useUpdateNoodleInteraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      interactionId,
      ...input
    }: NoodleInteractionUpdateInput & { postId: string; interactionId: string }) =>
      api.patch<NoodleInteraction>(
        `/noodle/posts/${encodeURIComponent(postId)}/interactions/${encodeURIComponent(interactionId)}`,
        input,
      ),
    onSuccess: (interaction) => {
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current
          ? {
              ...current,
              interactions: current.interactions.map((item) => (item.id === interaction.id ? interaction : item)),
            }
          : current,
      );
    },
  });
}

export function useDeleteNoodleInteraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, interactionId, personaId }: { postId: string; interactionId: string; personaId: string }) =>
      api.delete<NoodleInteraction[]>(
        `/noodle/posts/${encodeURIComponent(postId)}/interactions/${encodeURIComponent(interactionId)}?personaId=${encodeURIComponent(personaId)}`,
      ),
    onSuccess: (interactions) => {
      const deletedIds = new Set(interactions.map((interaction) => interaction.id));
      qc.setQueriesData<NoodleBootstrap | undefined>({ queryKey: noodleKeys.bootstrap() }, (current) =>
        current
          ? {
              ...current,
              interactions: current.interactions.filter((item) => !deletedIds.has(item.id)),
            }
          : current,
      );
    },
  });
}

export function useRefreshNoodle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Pick<NoodleRefreshInput, "personaId" | "connectionId" | "targetAccountId" | "postGuide">) =>
      api.post<NoodleRefreshResult>("/noodle/refresh", {
        ...input,
        debugMode: useUIStore.getState().debugMode,
        reviewImagePromptsBeforeSend: useUIStore.getState().reviewImagePromptsBeforeSend,
      }),
    onSuccess: (result, input) =>
      qc.setQueryData<NoodleBootstrap | undefined>(noodleKeys.bootstrap(input.personaId ?? "none"), (current) =>
        preservePollVotes(current, result.bootstrap),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useConfirmNoodleImagePrompts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prompts, personaId }: { prompts: ImagePromptOverride[]; personaId?: string }) =>
      api.post<NoodleBootstrap>("/noodle/refresh/images", {
        prompts,
        personaId,
        debugMode: useUIStore.getState().debugMode,
      }),
    onSuccess: (bootstrap, input) =>
      qc.setQueryData<NoodleBootstrap | undefined>(noodleKeys.bootstrap(input.personaId ?? "none"), (current) =>
        preservePollVotes(current, bootstrap),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useNoodleFillerProfiles(enabled = true) {
  return useQuery({
    queryKey: [...noodleKeys.all, "filler-accounts"] as const,
    queryFn: () => api.get<NoodleFillerProfile[]>("/noodle/filler-accounts"),
    enabled,
  });
}

export function useCreateNoodleFillerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NoodleFillerProfileCreateInput) =>
      api.post<NoodleFillerProfile>("/noodle/filler-accounts", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...noodleKeys.all, "filler-accounts"] }),
  });
}

export function useUpdateNoodleFillerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & NoodleFillerProfileUpdateInput) =>
      api.put<NoodleFillerProfile>(`/noodle/filler-accounts/${encodeURIComponent(id)}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...noodleKeys.all, "filler-accounts"] }),
  });
}

export function useDeleteNoodleFillerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/noodle/filler-accounts/${encodeURIComponent(id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...noodleKeys.all, "filler-accounts"] });
      qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() });
    },
  });
}
