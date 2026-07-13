// ──────────────────────────────────────────────
// React Query: NoodleR (private/paywalled account) hooks
//
// Split out of use-noodle.ts: these all deal with the OnlyFans-style
// private-account mechanic (create/delete a private profile, subscribe,
// unlock a PPV post, browse the NoodleR hub) rather than the core
// Twitter-style public feed. They still share the same bootstrap query
// cache/keys as use-noodle.ts, imported from there.
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { noodleKeys, type NoodlerHub } from "./use-noodle";
import type {
  NoodleAccount,
  NoodleAccountKind,
  NoodleAccountSubscription,
  NoodleBootstrap,
  NoodleInteraction,
  NoodlePostUnlock,
  NoodlePrivateAccountCreateInput,
} from "@marinara-engine/shared";

export function useNoodlerHub(
  subscriberKind: NoodleAccountKind | undefined,
  subscriberEntityId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: noodleKeys.hub(subscriberKind ?? "persona", subscriberEntityId ?? ""),
    queryFn: () =>
      api.get<NoodlerHub>(
        `/noodle/noodler/hub?subscriberKind=${encodeURIComponent(subscriberKind!)}&subscriberEntityId=${encodeURIComponent(subscriberEntityId!)}`,
      ),
    enabled: enabled && Boolean(subscriberKind && subscriberEntityId),
    staleTime: 10_000,
  });
}

export function useCreatePrivateNoodleAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ publicAccountId, input }: { publicAccountId: string; input?: NoodlePrivateAccountCreateInput }) =>
      api.post<NoodleAccount>(`/noodle/accounts/${publicAccountId}/private`, input ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() }),
  });
}

export function useDeletePrivateNoodleAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<NoodleAccount>(`/noodle/accounts/${encodeURIComponent(id)}/private`),
    onSuccess: (account) => {
      qc.setQueryData<NoodleBootstrap | undefined>(noodleKeys.bootstrap(), (current) =>
        current
          ? (() => {
              const deletedPostIds = new Set(
                current.posts.filter((post) => post.authorAccountId === account.id).map((post) => post.id),
              );
              return {
                ...current,
                accounts: current.accounts
                  .filter((item) => item.id !== account.id)
                  .map((item) => (item.linkedAccountId === account.id ? { ...item, linkedAccountId: null } : item)),
                posts: current.posts.filter((post) => post.authorAccountId !== account.id),
                interactions: current.interactions.filter(
                  (interaction) => interaction.actorAccountId !== account.id && !deletedPostIds.has(interaction.postId),
                ),
                subscriptions: current.subscriptions.filter(
                  (subscription) =>
                    subscription.creatorAccountId !== account.id && subscription.subscriberAccountId !== account.id,
                ),
                postUnlocks: current.postUnlocks.filter(
                  (unlock) => unlock.accountId !== account.id && !deletedPostIds.has(unlock.postId),
                ),
              };
            })()
          : current,
      );
      qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() });
      qc.invalidateQueries({ queryKey: [...noodleKeys.all, "hub"] });
    },
  });
}

export function useRetryPrivateIdentityGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<NoodleAccount>(`/noodle/accounts/${encodeURIComponent(id)}/private/retry-identity`, {}),
    onSuccess: (account) => {
      qc.setQueryData<NoodleBootstrap | undefined>(noodleKeys.bootstrap(), (current) =>
        current
          ? { ...current, accounts: current.accounts.map((item) => (item.id === account.id ? account : item)) }
          : current,
      );
      qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() });
    },
  });
}

export function useSubscribeNoodleAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      creatorAccountId,
      subscriberKind,
      subscriberEntityId,
    }: {
      creatorAccountId: string;
      subscriberKind: NoodleAccountKind;
      subscriberEntityId: string;
    }) =>
      api.post<NoodleAccountSubscription & { reaction: NoodleInteraction | null }>(
        `/noodle/accounts/${encodeURIComponent(creatorAccountId)}/subscribe`,
        { subscriberKind, subscriberEntityId },
      ),
    onSuccess: (subscription) => {
      qc.setQueryData<NoodleBootstrap | undefined>(noodleKeys.bootstrap(), (current) =>
        current
          ? {
              ...current,
              subscriptions: current.subscriptions.some((item) => item.id === subscription.id)
                ? current.subscriptions
                : [...current.subscriptions, subscription],
              interactions:
                subscription.reaction && !current.interactions.some((item) => item.id === subscription.reaction!.id)
                  ? [...current.interactions, subscription.reaction]
                  : current.interactions,
            }
          : current,
      );
    },
  });
}

export function useUnsubscribeNoodleAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      creatorAccountId,
      subscriberKind,
      subscriberEntityId,
    }: {
      creatorAccountId: string;
      subscriberKind: NoodleAccountKind;
      subscriberEntityId: string;
    }) => {
      const params = new URLSearchParams({ subscriberKind, subscriberEntityId });
      return api.delete(`/noodle/accounts/${encodeURIComponent(creatorAccountId)}/subscribe?${params}`);
    },
    onSuccess: (_result, variables) => {
      qc.setQueryData<NoodleBootstrap | undefined>(noodleKeys.bootstrap(), (current) =>
        current
          ? {
              ...current,
              subscriptions: current.subscriptions.filter(
                (item) => item.creatorAccountId !== variables.creatorAccountId,
              ),
            }
          : current,
      );
    },
  });
}

export function useUnlockNoodlePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      postId,
      actorKind,
      actorEntityId,
    }: {
      postId: string;
      actorKind: NoodleAccountKind;
      actorEntityId: string;
    }) =>
      api.post<NoodlePostUnlock & { reaction: NoodleInteraction | null }>(
        `/noodle/posts/${encodeURIComponent(postId)}/unlock`,
        { actorKind, actorEntityId },
      ),
    onSuccess: (unlock) => {
      qc.setQueryData<NoodleBootstrap | undefined>(noodleKeys.bootstrap(), (current) =>
        current
          ? {
              ...current,
              postUnlocks: current.postUnlocks.some((item) => item.id === unlock.id)
                ? current.postUnlocks
                : [...current.postUnlocks, unlock],
              interactions:
                unlock.reaction && !current.interactions.some((item) => item.id === unlock.reaction!.id)
                  ? [...current.interactions, unlock.reaction]
                  : current.interactions,
            }
          : current,
      );
    },
  });
}
