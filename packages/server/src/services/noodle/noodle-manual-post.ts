// ──────────────────────────────────────────────
// Service: Noodle Manual Post
// ──────────────────────────────────────────────
// Shared "create one post directly" primitive used by:
// - POST /posts (packages/server/src/routes/noodle.routes.ts)
// - the in-character Roleplay [noodle_post: ...] action
//   (packages/server/src/services/generation/noodle-post-command-runtime.ts)
//
// Both callers need the same author-account resolution, private-post
// visibility guard, @mention metadata, and activity-digest side effect that
// the original /posts handler implemented inline.
import {
  createNoodlePoll,
  extractNoodleMentionHandles,
  type NoodleAccount,
  type NoodleAccountKind,
  type NoodleCreatePostInput,
  type NoodlePost,
} from "@marinara-engine/shared";
import type { createCharactersStorage } from "../storage/characters.storage.js";
import { createNoodleStorage, parseNoodleAvatarCrop } from "../storage/noodle.storage.js";

export async function resolvePersonaAccount(
  noodle: ReturnType<typeof createNoodleStorage>,
  characters: ReturnType<typeof createCharactersStorage>,
  personaId?: string,
) {
  const personas = await characters.listPersonas();
  const persona =
    personas.find((p) => p.id === personaId) ?? personas.find((p) => p.isActive === "true") ?? personas[0];
  if (!persona) return null;
  return noodle.upsertAccountFromProfile({
    kind: "persona",
    entityId: persona.id,
    displayName: persona.convoDisplayName || persona.name || "User",
    avatarUrl: persona.avatarPath ?? null,
    avatarCrop: parseNoodleAvatarCrop(persona.avatarCrop),
    bio: persona.aboutMe || persona.description || "",
    invited: true,
  });
}

export function mentionedCharacterAccounts(accounts: NoodleAccount[], content: string): NoodleAccount[] {
  const mentionedHandles = new Set(extractNoodleMentionHandles(content));
  if (mentionedHandles.size === 0) return [];
  return accounts.filter(
    (account) => account.kind === "character" && mentionedHandles.has(account.handle.toLowerCase()),
  );
}

export function mentionedAccountMetadata(accounts: NoodleAccount[]) {
  return {
    mentionedAccountIds: accounts.map((account) => account.id),
    mentionedEntityIds: accounts.map((account) => account.entityId),
  };
}

export type CreateManualNoodlePostResult =
  | { post: NoodlePost }
  | { error: "account_not_found" | "cannot_quote_private" | "noodler_disabled" | "posting_disabled" };

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readPrivatePostingMode(account: NoodleAccount): "active" | "passive" {
  return parseRecord(account.settings.stageProfile).postingMode === "passive" ? "passive" : "active";
}

function readAutoPostEnabled(account: NoodleAccount): boolean {
  return parseRecord(account.settings.autoPost).enabled === true;
}

function readCharacterName(data: unknown): string {
  const parsed = typeof data === "string" ? safeParseRecord(data) : parseRecord(data);
  const name = parsed.name;
  return typeof name === "string" && name.trim() ? name.trim() : "Character";
}

function safeParseRecord(value: string): Record<string, unknown> {
  try {
    return parseRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

async function ensureCharacterNoodleAccount(
  noodle: ReturnType<typeof createNoodleStorage>,
  characters: ReturnType<typeof createCharactersStorage>,
  characterId: string,
): Promise<NoodleAccount | null> {
  const existing = await noodle.getAccountByEntity("character", characterId);
  if (existing) return existing;
  const row = await characters.getById(characterId);
  if (!row) return null;
  return noodle.upsertAccountFromProfile({
    kind: "character",
    entityId: characterId,
    displayName: readCharacterName(row.data),
    avatarUrl: row.avatarPath ?? null,
    avatarCrop: null,
    invited: true,
    syncIdentity: true,
  });
}

/**
 * Resolve the account for a "noodle" (public) or "noodler" (private) post target
 * given the author's entity. Private accounts share kind+entityId with their
 * linked public account, so they aren't reachable via getAccountByEntity directly —
 * resolve the public account first, then follow its linkedAccountId.
 */
export async function resolveNoodleTargetAccountId(
  noodle: ReturnType<typeof createNoodleStorage>,
  kind: NoodleAccountKind,
  entityId: string,
  target: "noodle" | "noodler",
): Promise<string | null> {
  const publicAccount = await noodle.getAccountByEntity(kind, entityId);
  if (!publicAccount) return null;
  if (target === "noodle") return publicAccount.id;
  return publicAccount.linkedAccountId ?? null;
}

export async function createManualNoodlePost(
  noodle: ReturnType<typeof createNoodleStorage>,
  characters: ReturnType<typeof createCharactersStorage>,
  params: NoodleCreatePostInput,
): Promise<CreateManualNoodlePostResult> {
  if (params.target === "noodler") {
    const settings = await noodle.getSettings();
    if (!settings.enableNoodler) return { error: "noodler_disabled" };
  }

  let account: NoodleAccount | null = null;
  if (params.target && params.authorKind === "character") {
    await ensureCharacterNoodleAccount(noodle, characters, params.authorEntityId);
  }
  if (params.authorAccountId) {
    account = await noodle.getAccountById(params.authorAccountId);
  } else if (params.target) {
    const accountId = await resolveNoodleTargetAccountId(noodle, params.authorKind, params.authorEntityId, params.target);
    account = accountId ? await noodle.getAccountById(accountId) : null;
  } else {
    account = await noodle.getAccountByEntity(params.authorKind, params.authorEntityId);
  }
  if (!account && !params.authorAccountId && !params.target && params.authorKind === "persona") {
    account = await resolvePersonaAccount(noodle, characters, params.authorEntityId);
  }
  if (!account) return { error: "account_not_found" };

  if (params.target === "noodler" && account.visibility === "private") {
    if (readPrivatePostingMode(account) === "passive" || !readAutoPostEnabled(account)) {
      return { error: "posting_disabled" };
    }
  }

  if (account.visibility === "public" && (params.parentPostId || params.quotePostId)) {
    const referencedPostId = params.parentPostId || params.quotePostId!;
    const referencedPost = await noodle.getPostById(referencedPostId);
    const referencedAuthor = referencedPost ? await noodle.getAccountById(referencedPost.authorAccountId) : null;
    if (referencedAuthor?.visibility === "private") {
      return { error: "cannot_quote_private" };
    }
  }

  const mentionedAccounts = mentionedCharacterAccounts(await noodle.listAccounts(), params.content);
  const poll = params.poll ? createNoodlePoll(params.poll) : null;
  const defaultAccess = account.visibility === "private" ? "subscriber" : "public";
  const post = await noodle.createPost({
    authorAccountId: account.id,
    content: params.content,
    imageUrl: params.imageUrl ?? null,
    imagePrompt: params.imagePrompt ?? null,
    parentPostId: params.parentPostId ?? null,
    quotePostId: params.quotePostId ?? null,
    source: "manual",
    access: params.access ?? defaultAccess,
    metadata: {
      ...mentionedAccountMetadata(mentionedAccounts),
      ...(poll ? { poll } : {}),
      ...(params.access === "ppv" && params.ppvPrice != null ? { ppvPrice: params.ppvPrice } : {}),
    },
  });
  if (!post) return { error: "account_not_found" };

  const digest = await noodle.createDigest({
    accountIds: [account.id, ...mentionedAccounts.map((mentionedAccount) => mentionedAccount.id)],
    content: `${account.displayName} posted on Noodle: ${post.content}`,
    sourcePostId: post.id,
  });
  if (!digest) return { post };
  return { post: (await noodle.updatePostMedia(post.id, { metadata: { activityDigestId: digest.id } })) ?? post };
}
