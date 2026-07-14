// ──────────────────────────────────────────────
// Routes: Noodle Fake Social Media
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "fs";
import { basename, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import {
  createNoodlePoll,
  canManageNoodleReply,
  extractNoodleMentionHandles,
  noodleAccountUpdateSchema,
  noodleBulkInviteSchema,
  noodleCreateInteractionSchema,
  noodleCreatePostSchema,
  noodleFillerProfileCreateSchema,
  noodleFillerProfileUpdateSchema,
  noodleInviteSchema,
  noodleInteractionOwnerSchema,
  noodleInteractionUpdateSchema,
  noodlePrivateAccountCreateSchema,
  noodlePrivateStageProfileSchema,
  noodlePostUpdateSchema,
  noodleRemoveInteractionSchema,
  noodleRescheduleRefreshSchema,
  noodleRefreshSchema,
  noodleSettingsUpdateSchema,
  noodleSubscribeSchema,
  noodleUnlockPostSchema,
  PROFESSOR_MARI_ID,
  readNoodlePollFromMetadata,
  type APIProvider,
  type NoodleAccount,
  type NoodleBootstrap,
  type NoodleInteraction,
  type NoodleInteractionType,
  type NoodlePost,
  type NoodlePrivateIdentityDisclosure,
  type NoodlePrivateStageProfile,
  type NoodleSettings,
} from "@marinara-engine/shared";
import type { ChatMessage } from "../services/llm/base-provider.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createGalleryStorage } from "../services/storage/gallery.storage.js";
import { createCharacterGalleryStorage } from "../services/storage/character-gallery.storage.js";
import { createNoodleStorage, parseNoodleAvatarCrop } from "../services/storage/noodle.storage.js";
import { createPromptOverridesStorage } from "../services/storage/prompt-overrides.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { withConnectionFallbackProvider } from "../services/llm/connection-fallback-provider.js";
import { generateImage, saveImageToDisk } from "../services/image/image-generation.js";
import { resolveConnectionImageDefaults } from "../services/image/image-generation-defaults.js";
import { loadImageGenerationUserSettings } from "../services/image/image-generation-settings.js";
import { compileImagePrompt } from "../services/image/image-prompt-compiler.js";
import { loadPrompt, NOODLE_IMAGE_POST, NOODLE_TIMELINE_VOICE } from "../services/prompt-overrides/index.js";
import { parseGameJsonish } from "../services/game/jsonish.js";
import { resolveIllustratorCharacterReferences } from "./generate/illustrator-references.js";
import { resolveBaseUrl } from "./generate/generate-route-utils.js";
import { logger, logDebugOverride } from "../lib/logger.js";
import { clampGenerationMaxOutputTokens } from "../services/generation/output-token-limits.js";
import { resolveImageConnectionFallback } from "../services/generation/media-connection-fallback.js";
import {
  noodleRefreshSchedulerStatus,
  rescheduleNoodleRefreshTime,
} from "../services/noodle/noodle-refresh-schedule.js";
import { NOODLE_JSON_OUTPUT_HEADING, noodleResponseFormat } from "../services/noodle/noodle-response-format.js";
import { generateNoodleImageWithRetry } from "../services/noodle/noodle-image-retry.js";
import {
  canGenerateNoodleActivityForAccountKind,
  collectNoodlePromptImageCandidates,
  formatNoodleTimelineForPrompt,
  noodleLorebookTokenBudget,
  noodlePastMemoryCutoff,
  noodlePastMemorySampleSize,
  noodlePersonaCommentPostIds,
  NOODLE_LEGACY_PAST_MEMORY_INCLUSION_CHANCE,
  NOODLE_LEGACY_PAST_MEMORY_MAX_ITEMS,
  NOODLE_LEGACY_RECALLED_MEMORY_INSTRUCTION,
  NOODLE_PERSONA_AUTHORSHIP_INSTRUCTION,
  NOODLE_RECALLED_MEMORY_INSTRUCTION,
  noodleTimelineFeatureInstructions,
  sampleNoodlePastMemories,
  sampleNoodlePastMemoriesWeighted,
} from "../services/noodle/noodle-prompt.js";
import { processLorebooks } from "../services/lorebook/index.js";
import type { DB } from "../db/connection.js";
import {
  generateImageCaptionForDataUrl,
  resolveImageCaptioningRuntime,
  type ImageCaptioningRuntime,
} from "./generate/image-captioning-runtime.js";
import {
  formatNoodleVisionManifest,
  isUnsupportedNoodleVisionInputError,
  prepareNoodleVisionAttachments,
  type NoodleVisionAttachment,
} from "../services/noodle/noodle-vision.js";
import { chooseNoodleParticipantAccounts } from "../services/noodle/noodle-participant-selection.js";
import { canCreateGeneratedNoodleInteraction } from "../services/noodle/noodle-interaction-policy.js";
import { parseNoodleGeneratedProfiles } from "../services/noodle/noodle-generated-profiles.js";
import {
  parseNoodleGeneratedRefresh,
  validateNoodleGeneratedRefresh,
} from "../services/noodle/noodle-generated-refresh.js";
import { normalizeNoodleImagePrompt } from "../services/noodle/noodle-image-prompt.js";
import {
  NOODLE_PUBLIC_REFRESH_SCOPE,
  acquireNoodleRefreshLock,
  isNoodleRefreshLocked,
  releaseNoodleRefreshLock,
} from "../services/noodle/noodle-refresh-lock.js";
import { normalizeNoodleHandle } from "../services/noodle/noodle-handle.js";

const NOODLE_ROUTE_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_PUBLIC_DIR = resolve(NOODLE_ROUTE_DIR, "../../../client/public");
const NOODLE_FOLLOWED_AT_BY_ACCOUNT_KEY = "followingAccountTimestamps";
const PROFESSOR_MARI_REFERENCE_ASSETS = [
  "sprites/mari/Mari_profile.png",
  "sprites/mari/chibi-professor-mari.png",
] as const;

function readProfessorMariReferenceImages(): string[] {
  return PROFESSOR_MARI_REFERENCE_ASSETS.flatMap((relativePath) => {
    const filePath = resolve(CLIENT_PUBLIC_DIR, relativePath);
    if (!existsSync(filePath)) return [];
    try {
      return [readFileSync(filePath).toString("base64")];
    } catch {
      return [];
    }
  });
}

function characterAvatarCrop(row: { data: unknown }) {
  return parseNoodleAvatarCrop(parseRecord(parseRecord(row.data).extensions).avatarCrop);
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

function escapePromptAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Reads the chat's already-derived `conversationCharacterStatuses` (updated on each generation in
 * that chat), keyed by characterId. This is a plain metadata read, not a schedule recomputation —
 * cheap enough to attach to every opted-in chat_context block without a separate token budget.
 */
function parseConversationCharacterStatuses(metadata: unknown): Record<string, { status: string; activity: string }> {
  const raw = parseRecord(metadata).conversationCharacterStatuses;
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, { status: string; activity: string }> = {};
  for (const [characterId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const status = (value as Record<string, unknown>).status;
    const activity = (value as Record<string, unknown>).activity;
    if (typeof status === "string" && typeof activity === "string") {
      result[characterId] = { status, activity };
    }
  }
  return result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type NoodlePrivatePostGuide = NonNullable<z.infer<typeof noodleRefreshSchema>["privatePostGuide"]>;

const NOODLE_ADULT_PLATFORM_POLICY =
  "Noodle only accepts confirmed adult accounts and personas. Every participant on Noodle is 18+; minors are not allowed on the platform. NSFW content is allowed, anything goes, and adult in-character drama, flirtation, gossip, and explicit references may appear when they fit the accounts involved.";

function sinceHoursIso(hours: number) {
  return new Date(Date.now() - Math.max(1, hours) * 60 * 60 * 1000).toISOString();
}

function characterNameFromRow(row: { data: unknown } | null | undefined) {
  const data = parseRecord(row?.data);
  return typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Character";
}

function personaNameFromRow(row: { name?: string | null; convoDisplayName?: string | null } | null | undefined) {
  return row?.convoDisplayName?.trim() || row?.name?.trim() || "User";
}

function characterContextFromRow(row: { id: string; data: unknown; avatarPath?: string | null }) {
  const data = parseRecord(row.data);
  const extensions = parseRecord(data.extensions);
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Character";
  const lines = [`<character name="${escapePromptAttribute(name)}">`];
  for (const [label, value] of [
    ["Description", data.description],
    ["Personality", data.personality],
    ["Scenario", data.scenario],
    ["First message", data.first_mes],
    ["Appearance", data.appearance ?? extensions.appearance],
    ["Backstory", data.backstory ?? extensions.backstory],
  ] as const) {
    if (typeof value === "string" && value.trim()) lines.push(`${label}: ${value.trim()}`);
  }
  lines.push(`</character>`);
  return lines.join("\n");
}

function personaContextFromRow(row: {
  id: string;
  name: string;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
}) {
  const lines = [`<persona name="${escapePromptAttribute(row.name || "User")}">`];
  for (const [label, value] of [
    ["Description", row.description],
    ["Personality", row.personality],
    ["Scenario", row.scenario],
    ["Backstory", row.backstory],
    ["Appearance", row.appearance],
  ] as const) {
    if (typeof value === "string" && value.trim()) lines.push(`${label}: ${value.trim()}`);
  }
  lines.push(`</persona>`);
  return lines.join("\n");
}

function characterAppearanceFromRow(row: { data: unknown }) {
  const data = parseRecord(row.data);
  const extensions = parseRecord(data.extensions);
  const value = data.appearance ?? extensions.appearance ?? data.description;
  return typeof value === "string" ? value.trim() : "";
}

function compactLines(lines: Array<string | null | undefined>) {
  return lines.map((line) => line?.trim()).filter((line): line is string => Boolean(line));
}

function characterPersonalityFromRow(row: { data: unknown }) {
  const data = parseRecord(row.data);
  const extensions = parseRecord(data.extensions);
  return compactLines([
    typeof data.personality === "string" ? `Personality: ${data.personality}` : null,
    typeof data.scenario === "string" ? `Scenario: ${data.scenario}` : null,
    typeof data.backstory === "string" ? `Backstory: ${data.backstory}` : null,
    typeof extensions.backstory === "string" ? `Backstory: ${extensions.backstory}` : null,
  ]).join("\n");
}

function personaAppearanceFromRow(row: {
  description?: string | null;
  appearance?: string | null;
}) {
  return row.appearance?.trim() || row.description?.trim() || "";
}

function personaPersonalityFromRow(row: {
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
}) {
  return compactLines([
    row.personality ? `Personality: ${row.personality}` : null,
    row.scenario ? `Scenario: ${row.scenario}` : null,
    row.backstory ? `Backstory: ${row.backstory}` : null,
    row.description ? `Description: ${row.description}` : null,
  ]).join("\n");
}

function defaultPrivateStageProfile(account: Pick<NoodleAccount, "displayName" | "bio">): NoodlePrivateStageProfile {
  return {
    identityDisclosure: "hinted",
    stageName: account.displayName,
    stageBio: account.bio || "",
    stagePersonality: "",
    stageDynamic: "",
    stageAppearanceOverride: "",
    preserveLinkedAppearance: true,
  };
}

function parsePrivateStageProfile(account: NoodleAccount): NoodlePrivateStageProfile {
  return noodlePrivateStageProfileSchema.parse({
    ...defaultPrivateStageProfile(account),
    ...parseRecord(account.settings.stageProfile),
  });
}

function writePrivateStageProfileSettings(
  settings: Record<string, unknown>,
  profile: NoodlePrivateStageProfile,
): Record<string, unknown> {
  return {
    ...settings,
    stageProfile: profile,
    privateStageProfileVersion: 1,
  };
}

function identityDisclosureInstruction(disclosure: NoodlePrivateIdentityDisclosure) {
  if (disclosure === "open") {
    return "Identity disclosure: open. This private account may use the linked public identity directly when it fits.";
  }
  if (disclosure === "secret") {
    return "Identity disclosure: secret. Never reveal the public name, public handle, title, or direct backstory identifiers in visible post text, profile text, image captions, watermarks, or signs.";
  }
  return "Identity disclosure: hinted. Avoid direct public names/handles, but subtle allusions, shared motifs, and in-jokes are allowed.";
}

type NoodleLinkedAuthorContext = {
  sourceKind: "character" | "persona";
  publicName: string;
  visualDescription: string;
  personalityDescription: string;
  avatarPath: string | null;
};

async function resolveNoodleLinkedAuthorContext(input: {
  account: NoodleAccount;
  characters: ReturnType<typeof createCharactersStorage>;
}): Promise<NoodleLinkedAuthorContext | null> {
  if (input.account.kind === "character") {
    const row = await input.characters.getById(input.account.entityId);
    if (!row) return null;
    return {
      sourceKind: "character",
      publicName: characterNameFromRow(row),
      visualDescription: characterAppearanceFromRow(row),
      personalityDescription: characterPersonalityFromRow(row),
      avatarPath: row.avatarPath ?? null,
    };
  }
  if (input.account.kind === "persona") {
    const row = await input.characters.getPersona(input.account.entityId);
    if (!row) return null;
    return {
      sourceKind: "persona",
      publicName: personaNameFromRow(row),
      visualDescription: personaAppearanceFromRow(row),
      personalityDescription: personaPersonalityFromRow(row),
      avatarPath: row.avatarPath ?? null,
    };
  }
  return null;
}

function formatPrivateStagePromptBlock(profile: NoodlePrivateStageProfile) {
  return compactLines([
    `Stage name: ${profile.stageName}`,
    profile.stageBio ? `Stage bio: ${profile.stageBio}` : null,
    profile.stagePersonality ? `Stage personality/voice: ${profile.stagePersonality}` : null,
    profile.stageDynamic ? `Private roleplay dynamic: ${profile.stageDynamic}` : null,
    profile.stageAppearanceOverride ? `Stage appearance/style override: ${profile.stageAppearanceOverride}` : null,
    `Preserve linked appearance: ${profile.preserveLinkedAppearance ? "yes" : "no"}`,
    identityDisclosureInstruction(profile.identityDisclosure),
  ]).join("\n");
}

function formatLinkedIdentityPromptBlock(context: NoodleLinkedAuthorContext, profile: NoodlePrivateStageProfile) {
  const nameLine =
    profile.identityDisclosure === "open"
      ? `Public name: ${context.publicName}`
      : `Public name: hidden from output (${context.sourceKind} identity anchor only)`;
  return compactLines([
    nameLine,
    context.visualDescription ? `Visual identity: ${context.visualDescription}` : null,
    context.personalityDescription ? `Continuity/personality context: ${context.personalityDescription}` : null,
  ]).join("\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizePrivateNoodlerImageIdea(
  draftPrompt: string,
  context: NoodleLinkedAuthorContext,
  profile: NoodlePrivateStageProfile,
) {
  let sanitized = draftPrompt;
  const replacement = profile.stageName || "the private creator";
  const blockedNames = new Set<string>();
  if (profile.identityDisclosure !== "open") blockedNames.add(context.publicName);
  if (context.publicName.toLowerCase() !== "professor mari") blockedNames.add("Professor Mari");
  if (!/\bmari\b/iu.test(context.publicName)) blockedNames.add("Mari");
  for (const name of blockedNames) {
    const clean = name.trim();
    if (!clean) continue;
    sanitized = sanitized.replace(new RegExp(`\\b${escapeRegExp(clean)}\\b`, "giu"), replacement);
  }
  return sanitized
    .split("\n")
    .filter((line) => !/^\s*(?:world\s*\/\s*lore|lorebook|user persona|character profiles?)\s*:/iu.test(line))
    .join("\n")
    .trim();
}

// Deterministic backstop for private-account post *text* (the image-prompt
// sanitizer above only ever covered the drafted image idea, not the saved
// post body). This is a literal-name blocklist, not a semantic guarantee —
// an LLM can still paraphrase around it — but it catches the common failure
// mode of the model writing the linked public identity's name directly into
// a "secret"/"hinted" private post.
export function enforceNoodlerIdentityBlocklist(
  content: string,
  context: NoodleLinkedAuthorContext,
  profile: NoodlePrivateStageProfile,
): { sanitized: string; redactionsApplied: boolean } {
  if (profile.identityDisclosure === "open" || !context.publicName.trim()) {
    return { sanitized: content, redactionsApplied: false };
  }
  const replacement = profile.stageName || "the private creator";
  const pattern = new RegExp(`\\b${escapeRegExp(context.publicName.trim())}\\b`, "giu");
  const redactionsApplied = pattern.test(content);
  return { sanitized: redactionsApplied ? content.replace(pattern, replacement) : content, redactionsApplied };
}

function galleryImageUrl(filePath: string, fallbackChatId: string) {
  const filename = basename(filePath.replace(/\\/g, "/"));
  return `/api/gallery/file/${encodeURIComponent(fallbackChatId)}/${encodeURIComponent(filename)}`;
}

function characterGalleryImageUrl(characterId: string, filePath: string) {
  const filename = basename(filePath.replace(/\\/g, "/"));
  return `/api/characters/${encodeURIComponent(characterId)}/gallery/file/${encodeURIComponent(filename)}`;
}

function readBoolSetting(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return value === true || value === "true";
}

function isProfileGenerated(account: NoodleAccount) {
  return readBoolSetting(account.settings, "profileGenerated");
}

function mentionedCharacterAccounts(accounts: NoodleAccount[], content: string): NoodleAccount[] {
  const mentionedHandles = new Set(extractNoodleMentionHandles(content));
  if (mentionedHandles.size === 0) return [];
  return accounts.filter(
    (account) => account.kind === "character" && mentionedHandles.has(account.handle.toLowerCase()),
  );
}

function mentionedAccountMetadata(accounts: NoodleAccount[]) {
  return {
    mentionedAccountIds: accounts.map((account) => account.id),
    mentionedEntityIds: accounts.map((account) => account.entityId),
  };
}

function generatedProfileSettings(settings: Record<string, unknown>, location: string, bannerUrl: string | null) {
  return {
    ...settings,
    profileGenerated: true,
    location,
    bannerUrl: bannerUrl ?? "",
  };
}

function profileSetupMaxTokens(characterCount: number) {
  return 1024 + Math.max(0, characterCount) * 1024;
}

function timelineRefreshMaxTokens(characterCount: number) {
  return 4096 + Math.max(0, characterCount) * 1024;
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}


const PROFESSOR_MARI_NOODLE_BIO =
  "She/Her | 18+ | Skill Issue | Your Assistant After Hours (hey, I get to do fun stuff, too!) | Simp for Il Dottore 24/7 | LLMs Fan";

export function collectNoodlePriorityAccountIds(input: {
  accounts: NoodleAccount[];
  posts: NoodlePost[];
  interactions: NoodleInteraction[];
  personaAccount: NoodleAccount | null;
}): Set<string> {
  const priority = new Set<string>();
  if (!input.personaAccount) return priority;
  const accountByHandle = new Map(input.accounts.map((account) => [account.handle.toLowerCase(), account]));
  const interactionById = new Map(input.interactions.map((interaction) => [interaction.id, interaction]));
  const addMentionedAccounts = (content: string | null | undefined) => {
    for (const handle of extractNoodleMentionHandles(content ?? "")) {
      const account = accountByHandle.get(handle);
      if (account && account.kind !== "persona") priority.add(account.id);
    }
  };

  for (const post of input.posts) {
    if (post.authorAccountId === input.personaAccount.id) addMentionedAccounts(post.content);
  }
  for (const interaction of input.interactions) {
    if (interaction.actorAccountId === input.personaAccount.id) {
      addMentionedAccounts(interaction.content);
      const post = input.posts.find((candidate) => candidate.id === interaction.postId);
      if (post && post.authorAccountId !== input.personaAccount.id) priority.add(post.authorAccountId);
      const parent = interaction.parentInteractionId ? interactionById.get(interaction.parentInteractionId) : null;
      if (parent && parent.actorAccountId !== input.personaAccount.id) priority.add(parent.actorAccountId);
      continue;
    }
    if (extractNoodleMentionHandles(interaction.content ?? "").includes(input.personaAccount.handle.toLowerCase())) {
      priority.add(interaction.actorAccountId);
    }
  }
  return priority;
}

async function pickGalleryAttachmentForAccount(input: {
  account: NoodleAccount;
  chats: ReturnType<typeof createChatsStorage>;
  gallery: ReturnType<typeof createGalleryStorage>;
  characterGallery: ReturnType<typeof createCharacterGalleryStorage>;
}) {
  if (input.account.kind !== "character") return null;

  const characterImages = await input.characterGallery.listByCharacterId(input.account.entityId);
  const characterImage = characterImages[0];
  if (characterImage) {
    return {
      imageUrl: characterGalleryImageUrl(input.account.entityId, characterImage.filePath),
      metadata: {
        galleryAttachmentSource: "character-gallery",
        galleryAttachmentId: characterImage.id,
      },
    };
  }

  const chats = await input.chats.list();
  const chatIds = chats
    .filter((chat) => parseStringArray(chat.characterIds).includes(input.account.entityId))
    .map((chat) => chat.id)
    .slice(0, 20);
  const chatImages = await input.gallery.listByChatIds(chatIds);
  const chatImage = chatImages[0];
  if (!chatImage) return null;
  return {
    imageUrl: galleryImageUrl(chatImage.filePath, chatImage.chatId),
    metadata: {
      galleryAttachmentSource: "chat-gallery",
      galleryAttachmentId: chatImage.id,
      galleryAttachmentChatId: chatImage.chatId,
    },
  };
}

async function pickRandomCharacterBannerUrl(
  characterGallery: ReturnType<typeof createCharacterGalleryStorage>,
  characterId: string,
) {
  const images = await characterGallery.listByCharacterId(characterId);
  const image = images.length > 0 ? shuffle(images)[0] : null;
  return image ? characterGalleryImageUrl(characterId, image.filePath) : null;
}

async function ensureRandomUserAccounts(noodle: ReturnType<typeof createNoodleStorage>) {
  const profiles = await noodle.listFillerProfiles();
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    await noodle.upsertAccountFromProfile({
      kind: "random_user",
      entityId: profile.entityId,
      displayName: profile.displayName,
      bio: profile.bio,
      invited: true,
    });
  }
}

async function ensureProfessorMariAccount(
  noodle: ReturnType<typeof createNoodleStorage>,
  characters: ReturnType<typeof createCharactersStorage>,
) {
  const row = await characters.getById(PROFESSOR_MARI_ID);
  const account = await noodle.upsertAccountFromProfile({
    kind: "character",
    entityId: PROFESSOR_MARI_ID,
    displayName: row ? characterNameFromRow(row) : "Professor Mari",
    avatarUrl: row?.avatarPath ?? "/sprites/mari/Mari_profile.png",
    avatarCrop: row ? characterAvatarCrop(row) : null,
    bio: PROFESSOR_MARI_NOODLE_BIO,
    invited: true,
    syncIdentity: true,
  });
  if (
    account.settings.profileManuallyEdited !== true &&
    (account.bio !== PROFESSOR_MARI_NOODLE_BIO || !isProfileGenerated(account) || !account.settings.location)
  ) {
    await noodle.updateAccount(account.id, {
      handle: account.handle || "professor_mari",
      displayName: account.displayName || "Professor Mari",
      bio: PROFESSOR_MARI_NOODLE_BIO,
      avatarUrl: account.avatarUrl || row?.avatarPath || "/sprites/mari/Mari_profile.png",
      settings: generatedProfileSettings(account.settings, "Marinara Engine", null),
    });
  }
}

async function ensureSelectedGroupCharacterAccounts(
  noodle: ReturnType<typeof createNoodleStorage>,
  characters: ReturnType<typeof createCharactersStorage>,
  groupIds: string[],
) {
  const selectedGroupIds = new Set(groupIds);
  if (selectedGroupIds.size === 0) return new Set<string>();
  const groups = await characters.listGroups();
  const selectedCharacterIds = new Set<string>();
  for (const group of groups) {
    if (!selectedGroupIds.has(group.id)) continue;
    for (const characterId of parseStringArray(group.characterIds)) selectedCharacterIds.add(characterId);
  }

  for (const characterId of selectedCharacterIds) {
    const row = await characters.getById(characterId);
    if (!row) continue;
    await noodle.upsertAccountFromProfile({
      kind: "character",
      entityId: row.id,
      displayName: characterNameFromRow(row),
      avatarUrl: row.avatarPath ?? null,
      avatarCrop: characterAvatarCrop(row),
      bio: String(parseRecord(row.data).description ?? ""),
      syncIdentity: true,
    });
  }
  return selectedCharacterIds;
}

async function ensurePersonaAccounts(
  noodle: ReturnType<typeof createNoodleStorage>,
  characters: ReturnType<typeof createCharactersStorage>,
) {
  const personas = await characters.listPersonas();
  const livePersonaIds = new Set<string>();
  for (const persona of personas) {
    livePersonaIds.add(persona.id);
    await noodle.upsertAccountFromProfile({
      kind: "persona",
      entityId: persona.id,
      displayName: persona.convoDisplayName || persona.name || "User",
      avatarUrl: persona.avatarPath ?? null,
      avatarCrop: parseNoodleAvatarCrop(persona.avatarCrop),
      bio: persona.aboutMe || persona.description || "",
      invited: true,
    });
  }
  return livePersonaIds;
}

function filterStalePersonaAccounts(bootstrap: NoodleBootstrap, livePersonaIds: Set<string>): NoodleBootstrap {
  return {
    ...bootstrap,
    accounts: bootstrap.accounts.filter(
      (account) => account.kind !== "persona" || livePersonaIds.has(account.entityId),
    ),
  };
}

async function bootstrapVisibleNoodle(
  noodle: ReturnType<typeof createNoodleStorage>,
  characters: ReturnType<typeof createCharactersStorage>,
) {
  const livePersonaIds = await ensurePersonaAccounts(noodle, characters);
  await ensureProfessorMariAccount(noodle, characters);
  const existingCharacterAccounts = (await noodle.listAccounts()).filter(
    (account) => account.kind === "character" && account.entityId !== PROFESSOR_MARI_ID,
  );
  const characterRowsById = new Map((await characters.list()).map((row) => [row.id, row]));
  for (const account of existingCharacterAccounts) {
    const row = characterRowsById.get(account.entityId);
    if (!row) continue;
    await noodle.upsertAccountFromProfile({
      kind: "character",
      entityId: row.id,
      displayName: characterNameFromRow(row),
      avatarUrl: row.avatarPath ?? null,
      avatarCrop: characterAvatarCrop(row),
      syncIdentity: true,
    });
  }
  return filterStalePersonaAccounts(await noodle.bootstrap(), livePersonaIds);
}

async function resolvePersonaAccount(
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

const NOODLE_CHAT_CONTEXT_MESSAGE_LIMIT = 8;
const NOODLE_CHAT_CONTEXT_CHAT_LIMIT = 8;

async function resolveCharacterName(
  characters: ReturnType<typeof createCharactersStorage>,
  characterId: string,
  cache: Map<string, string>,
) {
  const cached = cache.get(characterId);
  if (cached) return cached;
  const row = await characters.getById(characterId);
  const name = characterNameFromRow(row);
  cache.set(characterId, name);
  return name;
}

async function resolvePersonaName(
  characters: ReturnType<typeof createCharactersStorage>,
  personaId: string | null | undefined,
  cache: Map<string, string>,
) {
  if (!personaId) return "User";
  const cached = cache.get(personaId);
  if (cached) return cached;
  const row = await characters.getPersona(personaId);
  const name = personaNameFromRow(row);
  cache.set(personaId, name);
  return name;
}

function messageRoleLabel(role: string) {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "narrator") return "narrator";
  return "system";
}

async function buildOptedInChatContext(
  chats: ReturnType<typeof createChatsStorage>,
  characters: ReturnType<typeof createCharactersStorage>,
  selectedCharacterIds: string[],
  options: { focusOnlySelectedCharacters?: boolean } = {},
) {
  if (selectedCharacterIds.length === 0) return "No selected character chats are eligible for Noodle context.";
  const selected = new Set(selectedCharacterIds);
  const allChats = await chats.list();
  const relevant = allChats
    .filter((chat) => parseRecord(chat.metadata).noodleTimelineContextEnabled === true)
    .filter((chat) => parseStringArray(chat.characterIds).some((characterId) => selected.has(characterId)))
    .slice(0, NOODLE_CHAT_CONTEXT_CHAT_LIMIT);
  const blocks: string[] = [];
  const characterNameCache = new Map<string, string>();
  const personaNameCache = new Map<string, string>();
  for (const chat of relevant) {
    const chatCharacterIds = parseStringArray(chat.characterIds);
    const [personaName, characterNames, messages] = await Promise.all([
      resolvePersonaName(characters, chat.personaId, personaNameCache),
      Promise.all(
        chatCharacterIds.map(async (characterId) => ({
          id: characterId,
          name: await resolveCharacterName(characters, characterId, characterNameCache),
        })),
      ),
      chats.listMessagesPaginated(chat.id, NOODLE_CHAT_CONTEXT_MESSAGE_LIMIT),
    ]);
    if (messages.length === 0) continue;
    const speakerNameByCharacterId = new Map(characterNames.map((character) => [character.id, character.name]));
    const participantLines = [
      `- User persona: ${personaName}`,
      ...characterNames.map((character) => `- Character: ${character.name}`),
    ];
    // Attach each character's current status/activity from this chat's own schedule, if this chat
    // has one. Read-only metadata lookup already updated by that chat's own generation — no new
    // schedule computation and no attempt to reconcile a character's status across multiple chats;
    // each opted-in chat's status stays scoped to its own <chat_context> block, same as messages.
    const characterStatuses = parseConversationCharacterStatuses(chat.metadata);
    const statusLines = characterNames
      .map((character) => {
        const status = characterStatuses[character.id];
        return status ? `- ${character.name}: currently ${status.status} (${status.activity})` : null;
      })
      .filter((line): line is string => Boolean(line));
    const messageLines = await Promise.all(
      messages.flatMap((message) => {
        if (options.focusOnlySelectedCharacters && message.characterId && !selected.has(message.characterId)) return [];
        return [message];
      }).map(async (message) => {
        const role = messageRoleLabel(message.role);
        let speaker = role === "user" ? personaName : role === "narrator" ? "Narrator" : "Assistant";
        if (message.characterId) {
          speaker =
            speakerNameByCharacterId.get(message.characterId) ??
            (await resolveCharacterName(characters, message.characterId, characterNameCache));
        }
        const content = String(message.content ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 900);
        return `- ${speaker} (${role}): ${content}`;
      }),
    );
    if (messageLines.length === 0) continue;
    blocks.push(
      [
        `<chat_context id="${escapePromptAttribute(chat.id)}" mode="${escapePromptAttribute(
          chat.mode,
        )}" name="${escapePromptAttribute(chat.name)}">`,
        "Participants:",
        ...participantLines,
        ...(statusLines.length > 0 ? ["Current status in this story:", ...statusLines] : []),
        "Recent messages:",
        ...messageLines,
        `</chat_context>`,
      ].join("\n"),
    );
  }
  return blocks.length > 0
    ? blocks.join("\n\n")
    : "No opted-in chats with recent messages for the selected characters.";
}

async function buildRefreshPrompt(input: {
  db: DB;
  noodle: ReturnType<typeof createNoodleStorage>;
  characters: ReturnType<typeof createCharactersStorage>;
  chats: ReturnType<typeof createChatsStorage>;
  promptOverrides: ReturnType<typeof createPromptOverridesStorage>;
  activeAccounts: NoodleAccount[];
  personaAccount: NoodleAccount | null;
  settings: NoodleSettings;
  imageCaptioning: ImageCaptioningRuntime;
  requireImageForSinglePost?: boolean;
  privatePostGuide?: NoodlePrivatePostGuide;
}) {
  const activeCharacters = input.activeAccounts.filter((account) => account.kind === "character");
  const activeRandomUsers = input.activeAccounts.filter((account) => account.kind === "random_user");
  const selectedCharacterIds = activeCharacters.map((account) => account.entityId);
  const characterRows = await Promise.all(selectedCharacterIds.map((id) => input.characters.getById(id)));
  const personaRow = input.personaAccount ? await input.characters.getPersona(input.personaAccount.entityId) : null;
  // A single-account NoodleR generation targets exactly one private account and
  // produces exactly one isolated post — it never replies into or continues the
  // general public feed. Pulling in the last 100 posts from every account (which
  // skews toward whichever character posts most, e.g. a prominent built-in one)
  // gives the model unrelated "voice" noise to latch onto when this account's own
  // sheet is sparse. Scope timeline/memory context down to this account's own
  // history instead of the whole feed.
  const isolatedTargetAccount =
    input.activeAccounts.length === 1 && input.activeAccounts[0]!.visibility === "private"
      ? input.activeAccounts[0]!
      : null;
  const recentCutoff = sinceHoursIso(48);
  const [recentCreatedPostsRaw, recentPersonaComments] = await Promise.all([
    input.noodle.listPosts({ since: recentCutoff, limit: 100 }),
    isolatedTargetAccount || !input.personaAccount
      ? Promise.resolve([])
      : input.noodle.listRepliesByActorSince(input.personaAccount.id, recentCutoff, 100),
  ]);
  const recentCreatedPosts = isolatedTargetAccount
    ? recentCreatedPostsRaw.filter((post) => post.authorAccountId === isolatedTargetAccount.id)
    : recentCreatedPostsRaw;
  const recentlyCommentedPostIds = noodlePersonaCommentPostIds(recentPersonaComments, input.personaAccount?.id);
  const recentlyCommentedPosts = (
    await Promise.all(recentlyCommentedPostIds.map((postId) => input.noodle.getPostById(postId)))
  ).filter((post): post is NoodlePost => Boolean(post));
  const recentPostById = new Map([...recentCreatedPosts, ...recentlyCommentedPosts].map((post) => [post.id, post]));
  const recentPosts = [...recentPostById.values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const enhancedTimelineWriting = input.settings.enableEnhancedTimelineWriting;
  const pastMemorySampleSize = isolatedTargetAccount
    ? 0
    : enhancedTimelineWriting
      ? noodlePastMemorySampleSize()
      : noodlePastMemorySampleSize(Math.random, NOODLE_LEGACY_PAST_MEMORY_INCLUSION_CHANCE, NOODLE_LEGACY_PAST_MEMORY_MAX_ITEMS);
  const olderPosts =
    pastMemorySampleSize > 0
      ? (await input.noodle.listPostsBefore(noodlePastMemoryCutoff())).filter((post) => !recentPostById.has(post.id))
      : [];
  let recalledPosts: NoodlePost[];
  if (enhancedTimelineWriting) {
    const activeAccountIds = new Set(input.activeAccounts.map((account) => account.id));
    const activeAccountHandles = new Set(
      input.activeAccounts
        .map((account) => account.handle?.toLowerCase())
        .filter((handle): handle is string => Boolean(handle)),
    );
    const recentAuthorIds = new Set(recentPosts.map((post) => post.authorAccountId));
    const recalledPostRelevanceWeight = (post: NoodlePost): number => {
      let weight = 0.25;
      if (activeAccountIds.has(post.authorAccountId)) weight += 2;
      for (const handle of extractNoodleMentionHandles(post.content ?? "")) {
        if (activeAccountHandles.has(handle)) weight += 1;
      }
      if (recentAuthorIds.has(post.authorAccountId)) weight += 1;
      return weight;
    };
    recalledPosts = sampleNoodlePastMemoriesWeighted(olderPosts, pastMemorySampleSize, recalledPostRelevanceWeight);
  } else {
    recalledPosts = sampleNoodlePastMemories(olderPosts, pastMemorySampleSize);
  }
  const [chatContext, recentInteractions, recalledInteractions] = await Promise.all([
    isolatedTargetAccount
      ? isolatedTargetAccount.kind === "character"
        ? buildOptedInChatContext(input.chats, input.characters, [isolatedTargetAccount.entityId], {
            focusOnlySelectedCharacters: true,
          })
        : Promise.resolve("Private persona-linked NoodleR generation has no opted-in character chat context.")
      : buildOptedInChatContext(input.chats, input.characters, selectedCharacterIds),
    input.noodle.listInteractions(recentPosts.map((post) => post.id)),
    input.noodle.listInteractions(recalledPosts.map((post) => post.id)),
  ]);

  const characterContext = characterRows
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map(characterContextFromRow)
    .join("\n\n");
  const randomUserContext = activeRandomUsers
    .map(
      (account) =>
        `<random_user name="${escapePromptAttribute(account.displayName)}" handle="${escapePromptAttribute(account.handle)}">\nBio: ${
          account.bio || "A casual Noodle user."
        }\n</random_user>`,
    )
    .join("\n\n");
  const personaContext = isolatedTargetAccount
    ? "Viewer persona intentionally omitted for private single-account NoodleR generation. It is not the author and must not influence the author's identity or image prompt."
    : personaRow
      ? personaContextFromRow(personaRow)
      : "No user persona is active.";
  // A guided private NoodleR post can target a persona-linked private account, which
  // is otherwise never allowed to author generated activity. That single active
  // account's real persona sheet (description/personality/appearance) must still be
  // injected here — without it the model has nothing to anchor the post on besides
  // the unrelated "User Persona" (viewer) section above, which is where borrowed
  // details would otherwise leak in from.
  // Persona-kind accounts never appear in activeAccounts for the normal batch
  // timeline flow (NOODLE_PERSONA_AUTHORSHIP_INSTRUCTION keeps them out of
  // participant selection there) — the only path that can put one here is a
  // single-account NoodleR generation targeting a persona-linked private account,
  // guided or not.
  const personaAuthorAccounts = input.activeAccounts.filter((account) => account.kind === "persona");
  const personaAuthorAccountIds = new Set(personaAuthorAccounts.map((account) => account.id));
  const personaAuthorRows = await Promise.all(
    personaAuthorAccounts.map((account) => input.characters.getPersona(account.entityId)),
  );
  const personaAuthorContext = personaAuthorRows
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map(personaContextFromRow)
    .join("\n\n");
  const privateStageProfile = isolatedTargetAccount ? parsePrivateStageProfile(isolatedTargetAccount) : null;
  const linkedAuthorContext = isolatedTargetAccount
    ? await resolveNoodleLinkedAuthorContext({ account: isolatedTargetAccount, characters: input.characters })
    : null;
  const linkedAuthorContextBlock = linkedAuthorContext && privateStageProfile
    ? formatLinkedIdentityPromptBlock(linkedAuthorContext, privateStageProfile)
    : "";
  const privateStageContextBlock = privateStageProfile ? formatPrivateStagePromptBlock(privateStageProfile) : "";
  const activeAccountList = [...input.activeAccounts, ...(input.personaAccount ? [input.personaAccount] : [])]
    .map(
      (account) =>
        `- ${account.displayName} (@${account.handle}) kind=${account.kind} generationRole=${
          account.kind === "persona" && !personaAuthorAccountIds.has(account.id)
            ? "reference-target-only"
            : "allowed-author-and-actor"
        }`,
    )
    .join("\n");

  // Reuse the engine's existing multi-character lorebook system (already used by group chats) so
  // character lore/backstory can surface in Noodle refreshes. Off by default (Settings ->
  // Lorebook context) so existing timelines are unaffected until a user opts in. Oldest-first scan
  // messages from recent timeline text give keyword-scoped entries real content to match against;
  // character context is appended last so entries keyed to a character's own traits stay in scan depth.
  const lorebookScanMessages = isolatedTargetAccount
    ? [
        ...recentPosts
          .slice()
          .reverse()
          .map((post) => ({ role: "user", content: post.content })),
        ...(linkedAuthorContextBlock ? [{ role: "user", content: linkedAuthorContextBlock }] : []),
        ...(privateStageContextBlock ? [{ role: "user", content: privateStageContextBlock }] : []),
      ]
    : [
        ...recentPosts
          .slice()
          .reverse()
          .map((post) => ({ role: "user", content: post.content })),
        ...recentInteractions
          .filter((interaction) => interaction.type === "reply" && interaction.content)
          .map((interaction) => ({ role: "user", content: interaction.content ?? "" })),
        ...(characterContext ? [{ role: "user", content: characterContext }] : []),
      ];
  const lorebookResult = input.settings.enableLorebookContext
    ? await processLorebooks(
        input.db,
        lorebookScanMessages,
        null,
        {
          characterIds:
            isolatedTargetAccount?.kind === "character" ? [isolatedTargetAccount.entityId] : selectedCharacterIds,
          personaId:
            isolatedTargetAccount?.kind === "persona"
              ? isolatedTargetAccount.entityId
              : isolatedTargetAccount
                ? null
                : input.personaAccount?.entityId ?? null,
          tokenBudget: noodleLorebookTokenBudget(isolatedTargetAccount ? 1 : activeCharacters.length),
          generationTriggers: ["noodle"],
          previewOnly: true,
        },
      )
    : null;
  const loreContext = lorebookResult
    ? [lorebookResult.worldInfoBefore, lorebookResult.worldInfoAfter].filter(Boolean).join("\n")
    : "";

  // Tone/creative-freedom instructions are user-editable via Settings -> Generations -> Image
  // Generation Prompt Overrides -> Noodle Timeline Voice & Tone. Everything else in `system`
  // below is schema-critical (structured action limits, target field rules, persona authorship,
  // adult platform policy, "Return JSON only") and stays hardcoded so a rewritten voice/tone text
  // can never break the noodleGeneratedRefreshSchema output contract.
  const timelineVoiceText = await loadPrompt(input.promptOverrides, NOODLE_TIMELINE_VOICE, {
    enhanced: String(enhancedTimelineWriting),
    allowRandomUsers: String(input.settings.allowRandomUsers),
  });

  const system = [
    "You write a fake social media timeline for Marinara Engine's in-app parody site called Noodle.",
    NOODLE_ADULT_PLATFORM_POLICY,
    timelineVoiceText,
    "- Structured actions are limited to posts, polls, follows, likes, reposts, replies, and poll votes.",
    "- Generated interactions may target existing posts included in this prompt or posts you create in this response.",
    "- To respond directly to an existing comment, create a reply interaction for its post and set parentInteractionId to that comment's exact replyId.",
    "- Do not make an account interact with the same existing post again when it has already liked, reposted, voted, or replied there, unless that account was tagged or is answering a direct response to its own comment. Never make an account reply to its own comment.",
    "- Avoid repeating an account's recent post topic or phrasing. Continue an existing thread only when new activity gives the account a reason to return.",
    NOODLE_PERSONA_AUTHORSHIP_INSTRUCTION,
    "- imagePrompt values describe scene, pose, outfit, mood, composition, and setting only. Do not invent or restate the character's physical appearance (hair, build, face, species, etc.) — that is layered in separately from the character's own profile, and a conflicting guess in imagePrompt will fight it.",
    ...(personaAuthorContext
      ? [
          "- Exception: the account in the Author Persona Profile section is a persona-linked private NoodleR account and IS allowed to author the single requested post for this generation only. This exception applies to that one account alone.",
        ]
      : []),
    ...(privateStageProfile
      ? [
          "- For a private NoodleR account, treat Underlying Linked Identity as hidden continuity and Private Stage Persona as the visible creator role. Preserve the linked person's appearance and hard identity constraints, but write the post in the private stage persona's voice and dynamic.",
          `- ${identityDisclosureInstruction(privateStageProfile.identityDisclosure)}`,
          "- For private NoodleR imagePrompt values, describe only this creator's scene, pose, outfit, mood, composition, and the linked visual traits. Do not copy lorebook names, unrelated character names, the viewer persona, Professor Mari, or any public identity that conflicts with the Underlying Linked Identity.",
        ]
      : []),
    "- For each interaction, set either targetTempId or targetPostId and set the unused target field to null.",
    "- pollOptionIndex must be a zero-based integer for votes and null for every other interaction.",
    "- An exact @handle in post or reply text tags that active account. Preserve the @handle exactly when mentioning someone.",
    ...noodleTimelineFeatureInstructions(input.settings),
    "- Return JSON only. No prose outside the JSON object.",
  ].join("\n");

  const visionCandidates = await prepareNoodleVisionAttachments([
    ...collectNoodlePromptImageCandidates(recentPosts, recentInteractions, {
      priorityActorAccountId: isolatedTargetAccount?.id ?? input.personaAccount?.id,
    }),
    ...(isolatedTargetAccount
      ? []
      : collectNoodlePromptImageCandidates(recalledPosts, recalledInteractions, {
          priorityActorAccountId: input.personaAccount?.id,
        })),
  ]);
  const captionedImages = new Map<string, string>();
  let visionAttachments: NoodleVisionAttachment[] = visionCandidates;
  if (input.imageCaptioning.enabled) {
    const captionResults = await Promise.all(
      visionCandidates.map(async (attachment) => ({
        attachment,
        caption: await generateImageCaptionForDataUrl(
          attachment.key,
          attachment.dataUrl,
          input.imageCaptioning,
          AbortSignal.timeout(120_000),
        ),
      })),
    );
    visionAttachments = [];
    for (const result of captionResults) {
      if (result.caption) captionedImages.set(result.attachment.key, result.caption);
      else visionAttachments.push(result.attachment);
    }
  }
  const attachedImageKeys = new Set(visionAttachments.map((attachment) => attachment.key));
  const visionManifest = formatNoodleVisionManifest(visionAttachments);

  const buildContext = (
    imageKeys: ReadonlySet<string>,
    imageManifest: string,
    imageCaptions: ReadonlyMap<string, string>,
  ) =>
    [
      "# Active Noodle Accounts",
      activeAccountList || "No active accounts.",
      "",
      "# User Persona (the private reader viewing this timeline — never the author of generated posts)",
      personaContext,
      "",
      "# Character Profiles",
      characterContext || "No character profiles.",
      "",
      ...(personaAuthorContext
        ? [
            "# Author Persona Profile (this account is the sole allowed author for this generation only)",
            personaAuthorContext,
            "",
          ]
        : []),
      ...(linkedAuthorContextBlock
        ? [
            "# Underlying Linked Identity (hidden continuity source for private NoodleR)",
            linkedAuthorContextBlock,
            "",
          ]
        : []),
      ...(privateStageContextBlock
        ? ["# Private Stage Persona (visible creator role for this NoodleR account)", privateStageContextBlock, ""]
        : []),
      ...(loreContext ? ["# World / Lore", loreContext, ""] : []),
      "# Random User Profiles",
      randomUserContext || "Random users are disabled for this refresh.",
      "",
      "# Opted-In Chat Context",
      "Only chats whose Chat Settings allow Noodle references are included here.",
      chatContext,
      "",
      "# Recent Noodle Timeline",
      "Recent persona comments are especially relevant. Characters may naturally respond to them by using the comment replyId as parentInteractionId.",
      formatNoodleTimelineForPrompt(recentPosts, recentInteractions, {
        priorityActorAccountId: input.personaAccount?.id,
        attachedImageKeys: imageKeys,
        imageCaptions,
      }),
      ...(recalledPosts.length > 0
        ? [
            "",
            "# Randomly Recalled Older Noodle Activity",
            enhancedTimelineWriting ? NOODLE_RECALLED_MEMORY_INSTRUCTION : NOODLE_LEGACY_RECALLED_MEMORY_INSTRUCTION,
            formatNoodleTimelineForPrompt(recalledPosts, recalledInteractions, {
              emptyMessage: "No older Noodle activity was recalled.",
              includeTimestamp: true,
              priorityActorAccountId: input.personaAccount?.id,
              attachedImageKeys: imageKeys,
              imageCaptions,
            }),
          ]
        : []),
      ...(imageManifest ? ["", imageManifest] : []),
      "",
      "# Quotas",
      input.requireImageForSinglePost || input.privatePostGuide
        ? `posts: generate exactly 1 post, authored by the single active account${personaAuthorContext ? " (the persona-linked NoodleR account in the Author Persona Profile section)" : ""}.`
        : `posts: at most ${input.settings.maxGeneratedPostsPerRefresh}`,
      `replies: at most ${input.settings.maxRepliesPerRefresh}`,
      `reposts: at most ${input.settings.maxRepostsPerRefresh}`,
      `likes: at most ${input.settings.maxLikesPerRefresh}`,
      "follows: optional; use sparingly when an account would naturally follow another active account after today's public activity.",
      input.settings.enableImagePrompts
        ? `image generation: ${input.requireImageForSinglePost ? "required for this post" : `at most ${input.settings.maxImagesPerRefresh} images this refresh`}; imagePrompt may request either a character image or a meme. For character images, describe concrete appearance, build, clothing, and scene composition. For memes, describe the meme format, visual gag, intended caption/text if any, and why it fits the author's personality.${
            input.requireImageForSinglePost
              ? " This is a paid subscription/OnlyFans-style profile post, so imagePrompt must not be null or omitted."
              : ""
          }`
        : "image generation: disabled; omit imagePrompt or return null.",
      input.settings.allowGalleryImageAttachments
        ? "gallery attachments: enabled; you may set attachGalleryImage true on posts that should reuse existing character/chat gallery media."
        : "gallery attachments: disabled; set attachGalleryImage false or omit it.",
      ...(input.privatePostGuide
        ? [
            "",
            "# Guided Private NoodleR Post",
            `access status: ${input.privatePostGuide.access ?? "subscriber"}`,
            `text: ${input.privatePostGuide.includeText === false ? "disabled; set content exactly to Shared an image." : "enabled; write post text that fits the guide"}`,
            `image: ${input.privatePostGuide.includeImage === false ? "disabled; set imagePrompt to null and attachGalleryImage false" : "enabled; include a concrete imagePrompt"}`,
            input.privatePostGuide.theme?.trim()
              ? `theme: ${input.privatePostGuide.theme.trim()}`
              : "theme: choose a fitting private creator post theme",
            input.privatePostGuide.prompt?.trim()
              ? `user direction: ${input.privatePostGuide.prompt.trim()}`
              : "user direction: no extra direction supplied",
            "Follow the guide over generic timeline variety. Return exactly one post and no extra creator posts.",
            privateStageProfile
              ? "The theme and user direction above control this post's concept, scene, pose, outfit, and mood. They must preserve the Underlying Linked Identity's body/appearance unless the Private Stage Persona includes an explicit appearance/style override, and they must use the Private Stage Persona for voice and roleplay dynamic. Never blend the User Persona's identity or appearance into the author."
              : "The theme and user direction above describe this post's concept, scene, pose, outfit, and mood. They must never be replaced with or blended with the User Persona's identity, appearance, or description — the User Persona is the private, unrelated reader viewing this account, not the author.",
          ]
        : []),
    ].join("\n");

  const context = buildContext(attachedImageKeys, visionManifest, captionedImages);
  const textOnlyContext = buildContext(new Set(), "", captionedImages);

  const outputFormat = [
    NOODLE_JSON_OUTPUT_HEADING,
    JSON.stringify(
      {
        posts: [
          {
            tempId: "local id used only inside this response",
            authorHandle: "exact @handle of a non-persona account allowed to author generated activity",
            content: "post text",
            poll: { question: "optional poll question", options: ["first answer", "second answer"] },
            imagePrompt: "optional image prompt or null",
            attachGalleryImage: false,
          },
        ],
        interactions: [
          {
            actorHandle: "exact @handle of a non-persona account allowed to perform generated activity",
            targetTempId: "tempId from posts, if targeting a newly created post",
            targetPostId: "existing post id, if targeting an existing post",
            parentInteractionId: "existing replyId when directly answering a comment, otherwise null",
            type: "like | repost | reply | vote",
            content: "required for reply, optional/null otherwise",
            pollOptionIndex: 1,
          },
        ],
        follows: [
          {
            actorHandle: "exact @handle of a non-persona account allowed to perform generated activity",
            targetHandle: "exact @handle from Active Noodle Accounts",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");

  const messages = [
    { role: "system" as const, content: system },
    {
      role: "user" as const,
      content: context,
      ...(visionAttachments.length > 0 ? { images: visionAttachments.map((attachment) => attachment.dataUrl) } : {}),
    },
    { role: "user" as const, content: outputFormat },
  ] satisfies ChatMessage[];
  const textOnlyMessages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: textOnlyContext },
    { role: "user" as const, content: outputFormat },
  ] satisfies ChatMessage[];
  return {
    messages,
    textOnlyMessages,
    promptForLog: `${system}\n\n${context}\n\n${outputFormat}\n\n[${visionAttachments.length} Noodle timeline image input(s) attached]`,
    textOnlyPromptForLog: `${system}\n\n${textOnlyContext}\n\n${outputFormat}`,
    visionAttachmentCount: visionAttachments.length,
    captionedImageCount: captionedImages.size,
    recalledPostIds: recalledPosts.map((post) => post.id),
    lorebookActivatedEntryIds: lorebookResult?.activatedEntryIds ?? [],
  };
}

async function generateMissingNoodleProfiles(input: {
  noodle: ReturnType<typeof createNoodleStorage>;
  characters: ReturnType<typeof createCharactersStorage>;
  characterGallery: ReturnType<typeof createCharacterGalleryStorage>;
  accounts: NoodleAccount[];
  provider: ReturnType<typeof createLLMProvider>;
  connection: {
    provider: string;
    model: string;
    maxTokensOverride?: number | null;
  };
  debugMode: boolean;
}) {
  const targets: Array<{
    account: NoodleAccount;
    row: { id: string; data: unknown; avatarPath?: string | null };
    bannerUrl: string | null;
  }> = [];
  for (const account of input.accounts) {
    if (account.kind !== "character" || isProfileGenerated(account)) continue;
    const row = await input.characters.getById(account.entityId);
    if (!row) continue;
    const bannerUrl = await pickRandomCharacterBannerUrl(input.characterGallery, account.entityId);
    targets.push({ account, row, bannerUrl });
  }
  if (targets.length === 0) return;

  const characterBlocks = targets
    .map(({ account, row }) =>
      [
        `<profile_target entityId="${account.entityId}" currentName="${account.displayName}" currentHandle="${account.handle}">`,
        characterContextFromRow(row),
        `</profile_target>`,
      ].join("\n"),
    )
    .join("\n\n");
  const outputFormat = [
    NOODLE_JSON_OUTPUT_HEADING,
    JSON.stringify(
      {
        profiles: [
          {
            entityId: "exact entityId from profile_target",
            name: "display name for the social profile",
            handle: "short @nickname without @, lowercase letters/numbers/underscores preferred",
            bio: "short in-character social media bio",
            location: "short profile location, fictional or canonical if known",
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You set up fake Noodle social media profiles for existing Marinara Engine characters.",
        NOODLE_ADULT_PLATFORM_POLICY,
        "Create concise profile metadata only. Do not write posts, replies, likes, or timeline content.",
        "Use each character's personality, setting, and appearance to make the profile feel natural and in character.",
        "Return JSON only. No prose outside the JSON object.",
      ].join("\n"),
    },
    {
      role: "user",
      content: ["# Characters Needing Noodle Profiles", characterBlocks, "", outputFormat].join("\n"),
    },
  ];
  const promptForLog = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
  logDebugOverride(input.debugMode, "[debug/noodle] Profile prompt sent to model:\n%s", promptForLog);
  const maxTokens = clampGenerationMaxOutputTokens({
    provider: input.connection.provider as APIProvider,
    model: input.connection.model,
    maxTokens: profileSetupMaxTokens(targets.length),
    maxTokensOverride: input.connection.maxTokensOverride,
  });
  const result = await input.provider.chatComplete(messages, {
    model: input.connection.model,
    maxTokens,
    temperature: 0.55,
    topP: 0.9,
    stream: false,
    debugMode: input.debugMode,
    responseFormat: noodleResponseFormat(input.connection.model, "profiles"),
  });
  const generated = parseNoodleGeneratedProfiles(parseGameJsonish(result.content ?? ""));
  if (generated.rejected.length > 0) {
    logger.warn(
      "[noodle] Skipped %d invalid generated profile row(s); valid profiles will still be applied",
      generated.rejected.length,
    );
  }
  const profileByEntityId = new Map(generated.profiles.map((profile) => [profile.entityId, profile]));

  for (const target of targets) {
    const profile = profileByEntityId.get(target.account.entityId);
    if (!profile) continue;
    await input.noodle.updateAccount(target.account.id, {
      handle: profile.handle,
      displayName: profile.name,
      bio: profile.bio,
      avatarUrl: target.row.avatarPath ?? target.account.avatarUrl,
      settings: generatedProfileSettings(target.account.settings, profile.location, target.bannerUrl),
    });
  }
}

const noodlePrivateIdentitySchema = z.object({
  name: z.string().trim().min(1).max(60),
  handle: z.string().trim().min(1).max(30),
  bio: z.string().trim().max(300).default(""),
  appearance: z.string().trim().min(1).max(400),
  personality: z.string().trim().max(800).default(""),
  dynamic: z.string().trim().max(500).default(""),
});

async function generatePrivateAccountStageIdentity(input: {
  publicAccount: NoodleAccount;
  characters: ReturnType<typeof createCharactersStorage>;
  provider: ReturnType<typeof createLLMProvider>;
  connection: {
    provider: string;
    model: string;
    maxTokensOverride?: number | null;
  };
  requestedStageProfile?: Partial<NoodlePrivateStageProfile>;
  debugMode: boolean;
}): Promise<{
  name: string;
  handle: string;
  bio: string;
  appearance: string;
  stageProfile: NoodlePrivateStageProfile;
} | null> {
  const linkedContext = await resolveNoodleLinkedAuthorContext({
    account: input.publicAccount,
    characters: input.characters,
  });
  const knownAppearance = linkedContext?.visualDescription ?? "";
  const requestedDisclosure = input.requestedStageProfile?.identityDisclosure ?? "hinted";
  const contextBlock = linkedContext
    ? compactLines([
        `Public display name: ${input.publicAccount.displayName}`,
        `Public handle: @${input.publicAccount.handle}`,
        linkedContext.sourceKind === "character"
          ? `Linked source: character (${linkedContext.publicName})`
          : `Linked source: persona (${linkedContext.publicName})`,
        linkedContext.visualDescription ? `Established visual identity: ${linkedContext.visualDescription}` : null,
        linkedContext.personalityDescription || null,
      ]).join("\n")
    : `Public display name: ${input.publicAccount.displayName}\nPublic handle: @${input.publicAccount.handle}`;
  const outputFormat = [
    NOODLE_JSON_OUTPUT_HEADING,
    JSON.stringify(
      {
        name: "distinct stage display name, unrelated to the public account's real name",
        handle: "distinct handle without @, lowercase letters/numbers/underscores, unrelated to the public handle",
        bio: "short in-character NoodleR bio for an anonymous subscriber-only creator profile",
        appearance:
          "concrete physical appearance description for an image generator: hair, build, distinguishing features, typical outfit/style. Must describe a specific look, not just adjectives like 'attractive'.",
        personality: "private stage voice/persona for posts, which may contrast with the public personality",
        dynamic: "private roleplay dynamic or creator vibe, such as confident, coy, submissive but articulate, bratty, anonymous, etc.",
      },
      null,
      2,
    ),
  ].join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You invent a separate, anonymous NoodleR (private, subscriber-only) social profile for an existing Marinara Engine account.",
        NOODLE_ADULT_PLATFORM_POLICY,
        identityDisclosureInstruction(requestedDisclosure),
        requestedDisclosure === "open"
          ? "The NoodleR profile may be recognizably tied to the public account, but it should still feel like a private creator stage profile rather than a duplicate public page."
          : "The NoodleR profile must NOT reuse the public account's real name or handle. Invent a distinct stage name/alias, the way an anonymous content creator would use to protect their identity, while still fitting the underlying person.",
        knownAppearance
          ? "Keep the appearance field consistent with the linked account's established look below; do not invent a different person. The stage persona can change styling, voice, and dynamic, not the underlying body unless an explicit appearance override asks for styling changes."
          : "Invent a concrete, specific physical appearance for the profile photo — this field is required and must not be vague.",
        "The private stage persona may contrast with the public personality. For example, a dominant public character can present as submissive but well-spoken in private, while preserving the same visual identity.",
        "Return JSON only. No prose outside the JSON object.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "# Public Account Being Given a Private Stage Identity",
        `currentName: ${input.publicAccount.displayName}`,
        `currentHandle: ${input.publicAccount.handle}`,
        `requestedDisclosure: ${requestedDisclosure}`,
        input.requestedStageProfile?.stageName ? `requestedStageName: ${input.requestedStageProfile.stageName}` : "",
        input.requestedStageProfile?.stageBio ? `requestedStageBio: ${input.requestedStageProfile.stageBio}` : "",
        input.requestedStageProfile?.stagePersonality
          ? `requestedPrivatePersona: ${input.requestedStageProfile.stagePersonality}`
          : "",
        input.requestedStageProfile?.stageDynamic ? `requestedDynamic: ${input.requestedStageProfile.stageDynamic}` : "",
        contextBlock,
        knownAppearance ? `Established appearance: ${knownAppearance}` : "",
        "",
        outputFormat,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  const promptForLog = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
  logDebugOverride(input.debugMode, "[debug/noodle] Private stage identity prompt sent to model:\n%s", promptForLog);
  const maxTokens = clampGenerationMaxOutputTokens({
    provider: input.connection.provider as APIProvider,
    model: input.connection.model,
    maxTokens: profileSetupMaxTokens(1),
    maxTokensOverride: input.connection.maxTokensOverride,
  });
  const result = await input.provider.chatComplete(messages, {
    model: input.connection.model,
    maxTokens,
    temperature: 0.8,
    topP: 0.9,
    stream: false,
    debugMode: input.debugMode,
    responseFormat: noodleResponseFormat(input.connection.model, "profiles"),
  });
  const parsed = noodlePrivateIdentitySchema.safeParse(parseGameJsonish(result.content ?? ""));
  if (!parsed.success) {
    logger.warn("[noodle] Failed to parse generated NoodleR stage identity for %s", input.publicAccount.displayName);
    return null;
  }
  return {
    name: input.requestedStageProfile?.stageName?.trim() || parsed.data.name,
    handle: parsed.data.handle,
    bio: input.requestedStageProfile?.stageBio?.trim() || parsed.data.bio,
    appearance: parsed.data.appearance || knownAppearance,
    stageProfile: noodlePrivateStageProfileSchema.parse({
      identityDisclosure: requestedDisclosure,
      stageName: input.requestedStageProfile?.stageName?.trim() || parsed.data.name,
      stageBio: input.requestedStageProfile?.stageBio?.trim() || parsed.data.bio,
      stagePersonality: input.requestedStageProfile?.stagePersonality?.trim() || parsed.data.personality,
      stageDynamic: input.requestedStageProfile?.stageDynamic?.trim() || parsed.data.dynamic,
      stageAppearanceOverride: input.requestedStageProfile?.stageAppearanceOverride?.trim() || "",
      preserveLinkedAppearance: input.requestedStageProfile?.preserveLinkedAppearance ?? true,
    }),
  };
}

async function generatePrivateAccountAvatar(input: {
  displayName: string;
  bio: string;
  appearance: string;
  imageConnection: NonNullable<Awaited<ReturnType<ReturnType<typeof createConnectionsStorage>["getWithKey"]>>>;
  app: FastifyInstance;
  debugMode: boolean;
}): Promise<string | null> {
  const imageSettings = await loadImageGenerationUserSettings(input.app.db);
  const imageDefaults = resolveConnectionImageDefaults(input.imageConnection);
  const imageModel = input.imageConnection.model || "";
  const imageBaseUrl = input.imageConnection.baseUrl || "https://image.pollinations.ai";
  const imageSource = input.imageConnection.imageGenerationSource || imageModel;
  const imageServiceHint = input.imageConnection.imageService || imageSource;
  const imageFallback = await resolveImageConnectionFallback(
    createConnectionsStorage(input.app.db),
    input.imageConnection.id,
  );
  // The appearance description is the load-bearing part of this prompt: without a
  // concrete physical description, the backing image model/checkpoint falls back to
  // whatever default identity it was trained/tuned on instead of a distinct look.
  const avatarPrompt = [
    input.appearance,
    input.bio ? input.bio : "",
    "Solo portrait, waist-up, social media profile picture style.",
  ]
    .filter(Boolean)
    .join(" ");
  const compiledPrompt = compileImagePrompt({
    kind: "avatar",
    prompt: avatarPrompt,
    styleProfiles: imageSettings.styleProfiles,
    imageDefaults,
  });
  logDebugOverride(
    input.debugMode,
    "[debug/noodle/image] NoodleR avatar prompt for %s:\n%s",
    input.displayName,
    compiledPrompt.prompt,
  );
  const image = await generateNoodleImageWithRetry(
    () =>
      generateImage(imageSource, imageBaseUrl, input.imageConnection.apiKey || "", imageServiceHint, {
        prompt: compiledPrompt.prompt,
        negativePrompt: compiledPrompt.negativePrompt || undefined,
        model: imageModel,
        width: imageSettings.portrait.width,
        height: imageSettings.portrait.height,
        imageEndpointId: input.imageConnection.imageEndpointId || undefined,
        comfyWorkflow: input.imageConnection.comfyuiWorkflow || undefined,
        imageDefaults,
        fallback: imageFallback,
      }),
    (error, attempt, maxAttempts) => {
      logger.warn(error, "[noodle] Avatar generation attempt %d/%d failed for %s", attempt, maxAttempts, input.displayName);
    },
  );
  const filePath = saveImageToDisk("noodle", image.base64, image.ext);
  return galleryImageUrl(filePath, "noodle");
}

// Generates (or regenerates) a private NoodleR account's stage identity and
// avatar. On failure, persists a flag + error message on the account's
// settings instead of only logging, so the UI can surface a retry action
// rather than silently leaving the account without a stage identity.
async function ensurePrivateAccountIdentity(input: {
  noodle: ReturnType<typeof createNoodleStorage>;
  connections: ReturnType<typeof createConnectionsStorage>;
  characters: ReturnType<typeof createCharactersStorage>;
  app: FastifyInstance;
  publicAccount: NoodleAccount;
  privateAccount: NoodleAccount;
  requestedStageProfile?: Partial<NoodlePrivateStageProfile>;
}): Promise<NoodleAccount> {
  const { noodle, connections, characters, app, publicAccount, privateAccount } = input;
  try {
    const settings = await noodle.getSettings();
    const connectionId = settings.generationConnectionId;
    const conn = connectionId ? await connections.getWithKey(connectionId) : null;
    let stageIdentityFailed = false;
    let avatarFailed = false;
    if (conn) {
      const baseUrl = resolveBaseUrl(conn);
      const provider = createLLMProvider(
        conn.provider,
        baseUrl,
        conn.apiKey,
        conn.maxContext,
        conn.openrouterProvider,
        conn.maxTokensOverride,
        conn.claudeFastMode === "true",
        conn.treatAsLocalEndpoint === "true",
      );
      const identity = await generatePrivateAccountStageIdentity({
        publicAccount,
        characters,
        provider,
        connection: conn,
        requestedStageProfile: input.requestedStageProfile,
        debugMode: false,
      }).catch((error) => {
        logger.warn(error, "[noodle] Failed to generate NoodleR stage identity for account %s", privateAccount.id);
        stageIdentityFailed = true;
        return null;
      });
      if (identity) {
        let avatarUrl: string | null = null;
        const imageConnection = settings.imageGenerationConnectionId
          ? await connections.getWithKey(settings.imageGenerationConnectionId)
          : await connections.getDefaultForImageGeneration();
        if (imageConnection) {
          avatarUrl = await generatePrivateAccountAvatar({
            displayName: identity.name,
            bio: identity.bio,
            appearance: identity.appearance,
            imageConnection,
            app,
            debugMode: false,
          }).catch((error) => {
            logger.warn(error, "[noodle] Failed to generate NoodleR avatar for %s", identity.name);
            avatarFailed = true;
            return null;
          });
        } else {
          avatarFailed = true;
        }
        await noodle.updateAccount(privateAccount.id, {
          handle: identity.handle,
          displayName: identity.name,
          bio: identity.bio,
          ...(avatarUrl ? { avatarUrl } : {}),
          settings: {
            ...writePrivateStageProfileSettings(privateAccount.settings, identity.stageProfile),
            stageIdentityGenerationFailed: false,
            avatarGenerationFailed: avatarFailed,
          },
        });
      } else {
        stageIdentityFailed = true;
      }
    } else if (input.requestedStageProfile) {
      const profile = noodlePrivateStageProfileSchema.parse({
        ...defaultPrivateStageProfile(publicAccount),
        ...input.requestedStageProfile,
      });
      await noodle.updateAccount(privateAccount.id, {
        displayName: profile.stageName,
        bio: profile.stageBio,
        settings: writePrivateStageProfileSettings(privateAccount.settings, profile),
      });
    } else {
      stageIdentityFailed = true;
    }
    if (stageIdentityFailed) {
      await noodle.updateAccount(privateAccount.id, {
        settings: {
          ...privateAccount.settings,
          stageIdentityGenerationFailed: true,
        },
      });
    }
  } catch (error) {
    logger.warn(error, "[noodle] Failed to generate NoodleR stage identity for account %s", privateAccount.id);
    await noodle.updateAccount(privateAccount.id, {
      settings: {
        ...privateAccount.settings,
        stageIdentityGenerationFailed: true,
      },
    });
  }
  return (await noodle.getAccountById(privateAccount.id)) ?? privateAccount;
}

async function generateNoodlerReaction(input: {
  noodle: ReturnType<typeof createNoodleStorage>;
  creator: NoodleAccount;
  subscriberDisplayName: string;
  triggerPost: NoodlePost;
  kind: "subscribe" | "unlock";
  provider: ReturnType<typeof createLLMProvider>;
  connection: {
    provider: string;
    model: string;
    maxTokensOverride?: number | null;
  };
  debugMode: boolean;
}): Promise<NoodleInteraction | null> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        `You write a single short in-character reply from ${input.creator.displayName}, a NoodleR (private, subscriber-only) content creator, reacting to a fan's action on their profile.`,
        NOODLE_ADULT_PLATFORM_POLICY,
        "Write only the reply text: one or two sentences, casual and personal, matching the creator's voice and bio. No JSON, no quotes, no extra commentary.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Creator bio: ${input.creator.bio || "(no bio set)"}`,
        `Fan display name: ${input.subscriberDisplayName}`,
        `Fan action: ${input.kind === "subscribe" ? "just subscribed to this account" : "just unlocked this pay-per-view post"}`,
        `The post they're replying under: ${input.triggerPost.content || "(image post)"}`,
        "Write the creator's short thank-you reply now.",
      ].join("\n"),
    },
  ];
  const maxTokens = clampGenerationMaxOutputTokens({
    provider: input.connection.provider as APIProvider,
    model: input.connection.model,
    maxTokens: 256,
    maxTokensOverride: input.connection.maxTokensOverride,
  });
  const result = await input.provider.chatComplete(messages, {
    model: input.connection.model,
    maxTokens,
    temperature: 0.9,
    topP: 0.9,
    stream: false,
    debugMode: input.debugMode,
  });
  const content = (result.content ?? "").trim();
  if (!content) return null;
  return input.noodle.createInteraction(input.triggerPost.id, {
    actorAccountId: input.creator.id,
    type: "reply",
    content,
    parentInteractionId: null,
  });
}

async function tryGenerateNoodlerReaction(input: {
  noodle: ReturnType<typeof createNoodleStorage>;
  connections: ReturnType<typeof createConnectionsStorage>;
  creator: NoodleAccount;
  subscriberDisplayName: string;
  triggerPost: NoodlePost | null;
  kind: "subscribe" | "unlock";
}): Promise<NoodleInteraction | null> {
  if (input.creator.visibility !== "private" || !input.triggerPost) return null;
  try {
    const settings = await input.noodle.getSettings();
    const connectionId = settings.generationConnectionId;
    const conn = connectionId ? await input.connections.getWithKey(connectionId) : null;
    if (!conn) return null;
    const baseUrl = resolveBaseUrl(conn);
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
      conn.claudeFastMode === "true",
      conn.treatAsLocalEndpoint === "true",
    );
    return await generateNoodlerReaction({
      noodle: input.noodle,
      creator: input.creator,
      subscriberDisplayName: input.subscriberDisplayName,
      triggerPost: input.triggerPost,
      kind: input.kind,
      provider,
      connection: conn,
      debugMode: false,
    });
  } catch (error) {
    logger.warn(error, "[noodle] Failed to generate NoodleR reaction for %s", input.creator.displayName);
    return null;
  }
}

function interactionDigestVerb(type: NoodleInteractionType) {
  if (type === "reply") return "replied on";
  if (type === "repost") return "reposted";
  if (type === "vote") return "voted in";
  return "liked";
}

async function generateNoodlePostImage(input: {
  account: NoodleAccount;
  referenceAccounts: NoodleAccount[];
  postContent: string;
  draftPrompt: string;
  settings: NoodleSettings;
  characters: ReturnType<typeof createCharactersStorage>;
  characterGallery: ReturnType<typeof createCharacterGalleryStorage>;
  promptOverrides: ReturnType<typeof createPromptOverridesStorage>;
  imageConnection: NonNullable<Awaited<ReturnType<ReturnType<typeof createConnectionsStorage>["getWithKey"]>>>;
  app: FastifyInstance;
  debugMode: boolean;
  previewOnly?: boolean;
  promptOverride?: { prompt: string; negativePrompt?: string };
}) {
  const imageSettings = await loadImageGenerationUserSettings(input.app.db);
  const imageDefaults = resolveConnectionImageDefaults(input.imageConnection);
  const imageModel = input.imageConnection.model || "";
  const imageBaseUrl = input.imageConnection.baseUrl || "https://image.pollinations.ai";
  const imageSource = input.imageConnection.imageGenerationSource || imageModel;
  const imageServiceHint = input.imageConnection.imageService || imageSource;
  const imageFallback = await resolveImageConnectionFallback(
    createConnectionsStorage(input.app.db),
    input.imageConnection.id,
  );
  let characterDescription = "";
  let referenceImages: string[] | undefined;
  const privateStageProfile = input.account.visibility === "private" ? parsePrivateStageProfile(input.account) : null;
  const linkedAuthorContext = privateStageProfile
    ? await resolveNoodleLinkedAuthorContext({ account: input.account, characters: input.characters })
    : null;

  if (
    (input.account.kind === "character" || input.account.kind === "persona") &&
    (input.settings.imageGenerationIncludeDescriptions || input.settings.imageGenerationUseAvatarReferences)
  ) {
    if (input.account.kind === "character") {
      const character = await input.characters.getById(input.account.entityId);
      if (character) {
        const referenceAccountByEntityId = new Map(
          [input.account, ...input.referenceAccounts]
            .filter((account) => account.kind === "character")
            .map((account) => [account.entityId, account]),
        );
        const referenceRows = await Promise.all(
          Array.from(referenceAccountByEntityId.keys()).map((characterId) => input.characters.getById(characterId)),
        );
        const chatCharacters = referenceRows
          .filter((row): row is NonNullable<typeof row> => !!row)
          .map((row) => {
            const account = referenceAccountByEntityId.get(row.id);
            return {
              id: row.id,
              name: account?.displayName || characterNameFromRow(row),
              avatarPath: row.avatarPath ?? null,
              appearance: characterAppearanceFromRow(row),
            };
          });
        const referenceResolution = await resolveIllustratorCharacterReferences({
          charactersStore: input.characters,
          chatCharacters,
          persona: null,
          requestedNames: [input.account.displayName],
          promptText: [input.account.displayName, input.postContent, input.draftPrompt].join("\n"),
          maxReferences: 6,
        });
        if (input.settings.imageGenerationIncludeDescriptions && referenceResolution.appearanceBlock) {
          characterDescription = referenceResolution.appearanceBlock;
        }
        if (input.settings.imageGenerationUseAvatarReferences) {
          const builtInMariReferences =
            input.account.entityId === PROFESSOR_MARI_ID ? readProfessorMariReferenceImages() : [];
          const combinedReferences = [...builtInMariReferences, ...referenceResolution.referenceImages];
          if (combinedReferences.length > 0) {
            referenceImages = Array.from(new Set(combinedReferences)).slice(0, 6);
          }
        }
      }
    } else {
      // Personas carry the same avatarPath/appearance shape as characters and are
      // already fully supported by resolveIllustratorCharacterReferences elsewhere
      // (e.g. conversation-calls.routes.ts) — without this branch, persona-linked
      // NoodleR accounts got no avatar reference image and no appearance block at
      // all, leaving image generation to invent an unrelated look.
      const personaRow = await input.characters.getPersona(input.account.entityId);
      if (personaRow) {
        const referenceResolution = await resolveIllustratorCharacterReferences({
          charactersStore: input.characters,
          chatCharacters: [],
          persona: {
            id: input.account.entityId,
            name: input.account.displayName,
            avatarPath: personaRow.avatarPath ?? null,
            appearance: personaAppearanceFromRow(personaRow),
          },
          requestedNames: [input.account.displayName],
          promptText: [input.account.displayName, input.postContent, input.draftPrompt].join("\n"),
          maxReferences: 6,
        });
        if (input.settings.imageGenerationIncludeDescriptions && referenceResolution.appearanceBlock) {
          characterDescription = referenceResolution.appearanceBlock;
        }
        if (input.settings.imageGenerationUseAvatarReferences && referenceResolution.referenceImages.length > 0) {
          referenceImages = Array.from(new Set(referenceResolution.referenceImages)).slice(0, 6);
        }
      }
    }
  }

  if (privateStageProfile && linkedAuthorContext) {
    const privateVisualContext = compactLines([
      "Private NoodleR visual identity anchor:",
      privateStageProfile.identityDisclosure === "open"
        ? `Linked public identity: ${linkedAuthorContext.publicName}`
        : `Linked public identity: hidden ${linkedAuthorContext.sourceKind}; do not write or render the public name.`,
      linkedAuthorContext.visualDescription
        ? `Underlying visual identity to preserve: ${linkedAuthorContext.visualDescription}`
        : null,
      privateStageProfile.stageAppearanceOverride
        ? `Private styling / appearance override: ${privateStageProfile.stageAppearanceOverride}`
        : null,
      `Private stage persona: ${privateStageProfile.stageName}. ${privateStageProfile.stagePersonality}`.trim(),
      privateStageProfile.stageDynamic ? `Private roleplay dynamic: ${privateStageProfile.stageDynamic}` : null,
      identityDisclosureInstruction(privateStageProfile.identityDisclosure),
      "Treat the timeline writer's draft image idea as scene/composition only. Ignore or replace any named identity, lorebook term, or character detail in that draft if it conflicts with this anchor.",
      privateStageProfile.preserveLinkedAppearance
        ? "The generated image must preserve the linked person's body, age range, species, face/hair/visible traits, and hard visual continuity. User scene directions can change outfit, pose, mood, and setting, not who the person is."
        : "The private stage appearance may diverge only where the stage appearance override explicitly says so.",
    ]).join("\n");
    characterDescription = compactLines([privateVisualContext, characterDescription]).join("\n\n");
  }

  const draftPrompt =
    privateStageProfile && linkedAuthorContext
      ? sanitizePrivateNoodlerImageIdea(input.draftPrompt, linkedAuthorContext, privateStageProfile)
      : input.draftPrompt;

  const postPrompt = await loadPrompt(input.promptOverrides, NOODLE_IMAGE_POST, {
    authorName: input.account.displayName,
    postContent: input.postContent,
    draftPrompt,
    userInstructions: input.settings.imageGenerationPrompt,
    characterDescription,
  });
  const compiledPrompt = compileImagePrompt({
    kind: "illustration",
    prompt: postPrompt,
    styleProfiles: imageSettings.styleProfiles,
    imageDefaults,
  });
  const finalPrompt = input.promptOverride?.prompt.trim() || compiledPrompt.prompt;
  const finalNegativePrompt = input.promptOverride
    ? input.promptOverride.negativePrompt?.trim() || undefined
    : compiledPrompt.negativePrompt || undefined;
  logDebugOverride(
    input.debugMode,
    "[debug/noodle/image] final image prompt for %s:\n%s",
    input.account.displayName,
    finalPrompt,
  );
  if (finalNegativePrompt) {
    logDebugOverride(input.debugMode, "[debug/noodle/image] negative prompt:\n%s", finalNegativePrompt);
  }

  if (input.previewOnly) {
    return {
      imageUrl: null,
      metadata: {},
      preview: {
        kind: "illustration" as const,
        title: `${input.account.displayName} Noodle image`,
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        width: imageSettings.illustration.width,
        height: imageSettings.illustration.height,
      },
    };
  }

  const image = await generateNoodleImageWithRetry(
    () =>
      generateImage(imageSource, imageBaseUrl, input.imageConnection.apiKey || "", imageServiceHint, {
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        model: imageModel,
        width: imageSettings.illustration.width,
        height: imageSettings.illustration.height,
        imageEndpointId: input.imageConnection.imageEndpointId || undefined,
        comfyWorkflow: input.imageConnection.comfyuiWorkflow || undefined,
        imageDefaults,
        referenceImages,
        fallback: imageFallback,
      }),
    (error, attempt, maxAttempts) => {
      logger.warn(
        error,
        "[noodle] Image generation attempt %d/%d failed for %s",
        attempt,
        maxAttempts,
        input.account.displayName,
      );
    },
  );
  const provider = input.imageConnection.provider ?? "image_generation";
  if (input.account.kind === "character") {
    const filePath = saveImageToDisk(`characters/${input.account.entityId}`, image.base64, image.ext);
    const galleryImage = await input.characterGallery.create({
      characterId: input.account.entityId,
      filePath,
      prompt: finalPrompt,
      provider,
      model: imageModel || "unknown",
      width: imageSettings.illustration.width,
      height: imageSettings.illustration.height,
    });
    return {
      imageUrl: characterGalleryImageUrl(input.account.entityId, filePath),
      metadata: {
        imageGenerated: true,
        imageProvider: provider,
        imageModel: imageModel || "unknown",
        imageStyleProfileId: compiledPrompt.profile.id,
        characterGalleryImageId: galleryImage?.id ?? null,
      },
      preview: null,
    };
  }

  const filePath = saveImageToDisk("noodle", image.base64, image.ext);
  return {
    imageUrl: galleryImageUrl(filePath, "noodle"),
    metadata: {
      imageGenerated: true,
      imageProvider: provider,
      imageModel: imageModel || "unknown",
      imageStyleProfileId: compiledPrompt.profile.id,
    },
    preview: null,
  };
}

const noodleImagePromptConfirmationSchema = z.object({
  prompts: z
    .array(
      z.object({
        id: z.string().min(1),
        prompt: z.string().trim().min(1).max(20_000),
        negativePrompt: z.string().trim().max(20_000).optional(),
      }),
    )
    .max(20),
  debugMode: z.boolean().optional(),
});

export async function noodleRoutes(app: FastifyInstance) {
  const noodle = createNoodleStorage(app.db);
  const characters = createCharactersStorage(app.db);
  const chats = createChatsStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const gallery = createGalleryStorage(app.db);
  const characterGallery = createCharacterGalleryStorage(app.db);
  const promptOverrides = createPromptOverridesStorage(app.db);

  app.get("/", async () => {
    return bootstrapVisibleNoodle(noodle, characters);
  });

  // Cursor pagination for history older than the bootstrap's fixed-size
  // window (bootstrap() only ever returns the newest 160 posts). Returns raw
  // posts, unfiltered by account visibility, matching bootstrap's existing
  // convention — the client applies the same private-account feed filter it
  // already uses for the initial page.
  app.get("/posts", async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const before = typeof query.before === "string" ? query.before : null;
    if (!before) return reply.code(400).send({ error: "before is required" });
    const requestedLimit = typeof query.limit === "string" ? Number.parseInt(query.limit, 10) : 40;
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 40;
    const rows = await noodle.listPostsBefore(before, { limit: limit + 1 });
    const hasMore = rows.length > limit;
    const posts = hasMore ? rows.slice(0, limit) : rows;
    const interactions = await noodle.listInteractions(posts.map((post) => post.id));
    return { posts, interactions, hasMore };
  });

  app.put("/settings", async (req, reply) => {
    const parsed = noodleSettingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return noodle.updateSettings(parsed.data);
  });

  app.get("/filler-accounts", async () => {
    return noodle.listFillerProfiles();
  });

  app.post("/filler-accounts", async (req, reply) => {
    const parsed = noodleFillerProfileCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return noodle.createFillerProfile(parsed.data);
  });

  app.put("/filler-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodleFillerProfileUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const updated = await noodle.updateFillerProfile(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "Filler account not found" });
    return updated;
  });

  app.delete("/filler-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await noodle.deleteFillerProfile(id);
    if (!deleted) return reply.code(404).send({ error: "Filler account not found" });
    return { ok: true };
  });

  app.put("/refresh-schedule", async (req, reply) => {
    const parsed = noodleRescheduleRefreshSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (isNoodleRefreshLocked(NOODLE_PUBLIC_REFRESH_SCOPE)) {
      return reply.code(409).send({ error: "Wait for the current Noodle refresh to finish." });
    }
    const at = new Date();
    const schedule = await noodle.ensureRefreshSchedule(at);
    try {
      const rescheduled = rescheduleNoodleRefreshTime(schedule, parsed.data.scheduledTime, parsed.data.time, at);
      await noodle.saveRefreshSchedule(rescheduled);
      return noodleRefreshSchedulerStatus(rescheduled, at);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Could not reschedule refresh." });
    }
  });

  app.put("/accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodleAccountUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const existing = await noodle.getAccountById(id);
    if (!existing) return reply.code(404).send({ error: "Noodle account not found" });
    const profileFieldsChanged =
      existing.kind === "character" &&
      (parsed.data.handle !== undefined ||
        parsed.data.displayName !== undefined ||
        parsed.data.bio !== undefined ||
        parsed.data.avatarUrl !== undefined ||
        parsed.data.settings?.avatarCrop !== undefined ||
        parsed.data.settings?.bannerUrl !== undefined ||
        parsed.data.settings?.location !== undefined);
    const updated = await noodle.updateAccount(id, {
      ...parsed.data,
      ...(profileFieldsChanged
        ? {
            settings: {
              ...existing.settings,
              ...parsed.data.settings,
              ...(parsed.data.avatarUrl !== undefined ? { avatarCrop: null } : {}),
              profileManuallyEdited: true,
            },
          }
        : {}),
    });
    if (!updated) return reply.code(404).send({ error: "Noodle account not found" });
    return updated;
  });

  app.post("/invites", async (req, reply) => {
    const parsed = noodleInviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await characters.getById(parsed.data.characterId);
    if (!row) return reply.code(404).send({ error: "Character not found" });
    const name = characterNameFromRow(row);
    return noodle.upsertAccountFromProfile({
      kind: "character",
      entityId: row.id,
      displayName: name,
      avatarUrl: row.avatarPath ?? null,
      avatarCrop: characterAvatarCrop(row),
      bio: String(parseRecord(row.data).description ?? ""),
      invited: true,
      syncIdentity: true,
    });
  });

  app.post("/invites/bulk", async (req, reply) => {
    const parsed = noodleBulkInviteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const uniqueCharacterIds = Array.from(new Set(parsed.data.characterIds));
    const accounts: NoodleAccount[] = [];
    for (const characterId of uniqueCharacterIds) {
      const row = await characters.getById(characterId);
      if (!row) continue;
      accounts.push(
        await noodle.upsertAccountFromProfile({
          kind: "character",
          entityId: row.id,
          displayName: characterNameFromRow(row),
          avatarUrl: row.avatarPath ?? null,
          avatarCrop: characterAvatarCrop(row),
          bio: String(parseRecord(row.data).description ?? ""),
          invited: true,
          syncIdentity: true,
        }),
      );
    }
    return accounts;
  });

  app.delete("/invites/:characterId", async (req, reply) => {
    const { characterId } = req.params as { characterId: string };
    const account = await noodle.setCharacterInvited(characterId, false);
    if (!account) return reply.code(404).send({ error: "Noodle character account not found" });
    return account;
  });

  app.post("/posts", async (req, reply) => {
    const parsed = noodleCreatePostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let account = parsed.data.authorAccountId
      ? await noodle.getAccountById(parsed.data.authorAccountId)
      : await noodle.getAccountByEntity(parsed.data.authorKind, parsed.data.authorEntityId);
    if (!account && !parsed.data.authorAccountId && parsed.data.authorKind === "persona") {
      account = await resolvePersonaAccount(noodle, characters, parsed.data.authorEntityId);
    }
    if (!account) return reply.code(404).send({ error: "Noodle account not found" });
    if (account.visibility === "public" && (parsed.data.parentPostId || parsed.data.quotePostId)) {
      const referencedPostId = parsed.data.parentPostId || parsed.data.quotePostId!;
      const referencedPost = await noodle.getPostById(referencedPostId);
      const referencedAuthor = referencedPost ? await noodle.getAccountById(referencedPost.authorAccountId) : null;
      if (referencedAuthor?.visibility === "private") {
        return reply.code(403).send({ error: "Cannot quote or reply to a private Noodle post from a public account." });
      }
    }
    const mentionedAccounts = mentionedCharacterAccounts(await noodle.listAccounts(), parsed.data.content);
    const poll = parsed.data.poll ? createNoodlePoll(parsed.data.poll) : null;
    const post = await noodle.createPost({
      authorAccountId: account.id,
      content: parsed.data.content,
      imageUrl: parsed.data.imageUrl ?? null,
      imagePrompt: parsed.data.imagePrompt ?? null,
      parentPostId: parsed.data.parentPostId ?? null,
      quotePostId: parsed.data.quotePostId ?? null,
      source: "manual",
      access: parsed.data.access ?? "public",
      metadata: { ...mentionedAccountMetadata(mentionedAccounts), ...(poll ? { poll } : {}) },
    });
    if (!post) return reply.code(404).send({ error: "Noodle author not found" });
    const digest = await noodle.createDigest({
      accountIds: [account.id, ...mentionedAccounts.map((mentionedAccount) => mentionedAccount.id)],
      content: `${account.displayName} posted on Noodle: ${post.content}`,
      sourcePostId: post.id,
    });
    if (!digest) return post;
    return (await noodle.updatePostMedia(post.id, { metadata: { activityDigestId: digest.id } })) ?? post;
  });

  app.patch("/posts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodlePostUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let post = await noodle.updatePost(id, parsed.data);
    if (!post) return reply.code(404).send({ error: "Noodle post not found" });
    if (parsed.data.content !== undefined) {
      const mentionedAccounts = mentionedCharacterAccounts(await noodle.listAccounts(), post.content);
      post =
        (await noodle.updatePostMedia(post.id, {
          metadata: mentionedAccountMetadata(mentionedAccounts),
        })) ?? post;
      const digestId = post.metadata.activityDigestId;
      const author = await noodle.getAccountById(post.authorAccountId);
      if (typeof digestId === "string" && digestId && author) {
        await noodle.updateDigest(digestId, {
          accountIds: [author.id, ...mentionedAccounts.map((mentionedAccount) => mentionedAccount.id)],
          content: `${author.displayName} posted on Noodle: ${post.content}`,
        });
      }
    }
    return post;
  });

  app.delete("/posts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await noodle.deletePost(id);
    if (!deleted) return reply.code(404).send({ error: "Noodle post not found" });
    return deleted;
  });

  app.delete("/timeline", async () => {
    await noodle.resetTimeline();
    return bootstrapVisibleNoodle(noodle, characters);
  });

  app.post("/accounts/:id/private", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodlePrivateAccountCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const publicAccount = await noodle.getAccountById(id);
    if (!publicAccount) return reply.code(404).send({ error: "Noodle account not found" });
    const created = await noodle.createPrivateAccount(id);
    if (!created) return reply.code(400).send({ error: "Could not create a private Noodle account for that account." });

    return ensurePrivateAccountIdentity({
      noodle,
      connections,
      characters,
      app,
      publicAccount,
      privateAccount: created,
      requestedStageProfile: parsed.data.stageProfile,
    });
  });

  app.delete("/accounts/:id/private", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await noodle.deletePrivateAccount(id);
    if (!deleted) return reply.code(404).send({ error: "NoodleR profile not found" });
    return deleted;
  });

  app.post("/accounts/:id/private/retry-identity", async (req, reply) => {
    const { id } = req.params as { id: string };
    const privateAccount = await noodle.getAccountById(id);
    if (!privateAccount || privateAccount.visibility !== "private") {
      return reply.code(404).send({ error: "NoodleR profile not found" });
    }
    const allAccounts = await noodle.listAccounts();
    const publicAccount = allAccounts.find((account) => account.linkedAccountId === privateAccount.id);
    if (!publicAccount) return reply.code(404).send({ error: "Linked public Noodle account not found" });
    return ensurePrivateAccountIdentity({
      noodle,
      connections,
      characters,
      app,
      publicAccount,
      privateAccount,
    });
  });

  app.get("/noodler/hub", async (req, reply) => {
    const parsed = noodleSubscribeSchema.safeParse({
      subscriberKind: (req.query as Record<string, unknown>).subscriberKind,
      subscriberEntityId: (req.query as Record<string, unknown>).subscriberEntityId,
    });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let subscriber = await noodle.getAccountByEntity(parsed.data.subscriberKind, parsed.data.subscriberEntityId);
    if (!subscriber && parsed.data.subscriberKind === "persona") {
      subscriber = await resolvePersonaAccount(noodle, characters, parsed.data.subscriberEntityId);
    }
    if (!subscriber) return reply.code(404).send({ error: "Noodle subscriber not found" });

    const privateAccounts = await noodle.listPrivateAccounts();
    // A private account always shares kind+entityId with the public account it's
    // linked from, so we can split owned-vs-browsable without a reverse lookup:
    // "persona" private accounts are the caller's own NoodleR pages, "character"
    // ones are creators to subscribe to.
    const owned = privateAccounts.filter((account) => account.kind === "persona");
    const creatorAccounts = privateAccounts.filter((account) => account.kind === "character");
    const subscriptions = await noodle.listSubscriptionsForSubscriber(subscriber.id);
    const subscribedCreatorIds = new Set(subscriptions.map((subscription) => subscription.creatorAccountId));
    return {
      owned,
      subscribed: creatorAccounts.filter((account) => subscribedCreatorIds.has(account.id)),
      discover: creatorAccounts.filter((account) => !subscribedCreatorIds.has(account.id)),
    };
  });

  app.post("/accounts/:id/subscribe", async (req, reply) => {
    const { id: creatorAccountId } = req.params as { id: string };
    const parsed = noodleSubscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const creator = await noodle.getAccountById(creatorAccountId);
    if (!creator) return reply.code(404).send({ error: "Noodle account not found" });
    let subscriber = await noodle.getAccountByEntity(parsed.data.subscriberKind, parsed.data.subscriberEntityId);
    if (!subscriber && parsed.data.subscriberKind === "persona") {
      subscriber = await resolvePersonaAccount(noodle, characters, parsed.data.subscriberEntityId);
    }
    if (!subscriber) return reply.code(404).send({ error: "Noodle subscriber not found" });
    const subscription = await noodle.subscribe(subscriber.id, creator.id);
    if (!subscription) return reply.code(400).send({ error: "Could not subscribe to that account." });
    const triggerPost = await noodle.getMostRecentPostByAuthor(creator.id);
    const reaction = await tryGenerateNoodlerReaction({
      noodle,
      connections,
      creator,
      subscriberDisplayName: subscriber.displayName,
      triggerPost,
      kind: "subscribe",
    });
    return { ...subscription, reaction };
  });

  app.delete("/accounts/:id/subscribe", async (req, reply) => {
    const { id: creatorAccountId } = req.params as { id: string };
    const parsed = noodleSubscribeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let subscriber = await noodle.getAccountByEntity(parsed.data.subscriberKind, parsed.data.subscriberEntityId);
    if (!subscriber && parsed.data.subscriberKind === "persona") {
      subscriber = await resolvePersonaAccount(noodle, characters, parsed.data.subscriberEntityId);
    }
    if (!subscriber) return reply.code(404).send({ error: "Noodle subscriber not found" });
    await noodle.unsubscribe(subscriber.id, creatorAccountId);
    return { ok: true };
  });

  app.post("/posts/:id/unlock", async (req, reply) => {
    const { id: postId } = req.params as { id: string };
    const parsed = noodleUnlockPostSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const post = await noodle.getPostById(postId);
    if (!post) return reply.code(404).send({ error: "Noodle post not found" });
    let actor = await noodle.getAccountByEntity(parsed.data.actorKind, parsed.data.actorEntityId);
    if (!actor && parsed.data.actorKind === "persona") {
      actor = await resolvePersonaAccount(noodle, characters, parsed.data.actorEntityId);
    }
    if (!actor) return reply.code(404).send({ error: "Noodle actor not found" });
    const unlock = await noodle.unlockPost(actor.id, postId);
    const creator = await noodle.getAccountById(post.authorAccountId);
    const reaction = creator
      ? await tryGenerateNoodlerReaction({
          noodle,
          connections,
          creator,
          subscriberDisplayName: actor.displayName,
          triggerPost: post,
          kind: "unlock",
        })
      : null;
    return { ...unlock, reaction };
  });

  app.post("/posts/:id/interactions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodleCreateInteractionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let actor = await noodle.getAccountByEntity(parsed.data.actorKind, parsed.data.actorEntityId);
    if (!actor && parsed.data.actorKind === "persona") {
      actor = await resolvePersonaAccount(noodle, characters, parsed.data.actorEntityId);
    }
    if (!actor) return reply.code(404).send({ error: "Noodle actor not found" });
    const post = await noodle.getPostById(id);
    if (!post) return reply.code(404).send({ error: "Noodle post not found" });
    if (parsed.data.type === "vote") {
      const poll = readNoodlePollFromMetadata(post.metadata);
      if (!poll || !poll.options.some((option) => option.id === parsed.data.content?.trim())) {
        return reply.code(400).send({ error: "Choose a valid option from this poll." });
      }
    }
    const interaction = await noodle.createInteraction(id, {
      actorAccountId: actor.id,
      type: parsed.data.type,
      content: parsed.data.content ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      parentInteractionId: parsed.data.parentInteractionId ?? null,
    });
    if (!interaction) return reply.code(400).send({ error: "Could not add that Noodle interaction." });
    if (parsed.data.type !== "like") {
      const directReplyTarget = parsed.data.parentInteractionId
        ? (await noodle.listInteractions([id])).find((item) => item.id === parsed.data.parentInteractionId)
        : null;
      const poll = readNoodlePollFromMetadata(post.metadata);
      const selectedPollOption =
        parsed.data.type === "vote"
          ? poll?.options.find((option) => option.id === interaction.content)?.label
          : undefined;
      const interactionSummary =
        parsed.data.type === "vote" && poll && selectedPollOption
          ? `${poll.question}: ${selectedPollOption}`
          : interaction.content || (interaction.imageUrl ? "shared an image" : post.content);
      await noodle.createDigest({
        accountIds: Array.from(
          new Set([actor.id, post.authorAccountId, directReplyTarget?.actorAccountId].filter(Boolean) as string[]),
        ),
        content: `${actor.displayName} ${interactionDigestVerb(parsed.data.type)} a Noodle post: ${interactionSummary}`,
        sourcePostId: post.id,
        sourceInteractionId: interaction.id,
      });
    }
    return interaction;
  });

  app.patch("/posts/:postId/interactions/:interactionId", async (req, reply) => {
    const { postId, interactionId } = req.params as { postId: string; interactionId: string };
    const parsed = noodleInteractionUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const interaction = await noodle.getInteractionById(interactionId);
    if (!interaction || interaction.postId !== postId) {
      return reply.code(404).send({ error: "Noodle comment not found" });
    }
    await ensurePersonaAccounts(noodle, characters);
    const persona = await noodle.getAccountByEntity("persona", parsed.data.personaId);
    if (!persona) return reply.code(404).send({ error: "Noodle persona not found" });
    const interactionActor = await noodle.getAccountById(interaction.actorAccountId);
    const actorKind = interactionActor?.kind ?? interaction.actorSnapshot?.kind;
    if (
      interaction.type !== "reply" ||
      !canManageNoodleReply({
        actorKind,
        actorAccountId: interaction.actorAccountId,
        personaAccountId: persona.id,
      })
    ) {
      return reply.code(403).send({ error: "You can only edit comments from this persona or a character." });
    }
    const content = parsed.data.content === undefined ? interaction.content : parsed.data.content?.trim() || null;
    const imageUrl = parsed.data.imageUrl === undefined ? interaction.imageUrl : parsed.data.imageUrl?.trim() || null;
    if (!content && !imageUrl) return reply.code(400).send({ error: "Comments need text or an image." });
    const updated = await noodle.updateInteraction(interactionId, { content, imageUrl });
    if (!updated) return reply.code(404).send({ error: "Noodle comment not found" });
    const [post, accounts] = await Promise.all([noodle.getPostById(postId), noodle.listAccounts()]);
    if (post && interactionActor) {
      const directReplyTarget = updated.parentInteractionId
        ? await noodle.getInteractionById(updated.parentInteractionId)
        : null;
      const mentionedAccounts = mentionedCharacterAccounts(accounts, updated.content ?? "");
      await noodle.createDigest({
        accountIds: Array.from(
          new Set(
            [
              interactionActor.id,
              post.authorAccountId,
              directReplyTarget?.actorAccountId,
              ...mentionedAccounts.map((account) => account.id),
            ].filter(Boolean) as string[],
          ),
        ),
        content: `${interactionActor.displayName} replied to a Noodle post: ${
          updated.content || (updated.imageUrl ? "shared an image" : post.content)
        }`,
        sourcePostId: post.id,
        sourceInteractionId: updated.id,
      });
    }
    return updated;
  });

  app.delete("/posts/:postId/interactions/:interactionId", async (req, reply) => {
    const { postId, interactionId } = req.params as { postId: string; interactionId: string };
    const parsed = noodleInteractionOwnerSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const interaction = await noodle.getInteractionById(interactionId);
    if (!interaction || interaction.postId !== postId) {
      return reply.code(404).send({ error: "Noodle comment not found" });
    }
    await ensurePersonaAccounts(noodle, characters);
    const persona = await noodle.getAccountByEntity("persona", parsed.data.personaId);
    if (!persona) return reply.code(404).send({ error: "Noodle persona not found" });
    const interactionActor = await noodle.getAccountById(interaction.actorAccountId);
    const actorKind = interactionActor?.kind ?? interaction.actorSnapshot?.kind;
    if (
      interaction.type !== "reply" ||
      !canManageNoodleReply({
        actorKind,
        actorAccountId: interaction.actorAccountId,
        personaAccountId: persona.id,
      })
    ) {
      return reply.code(403).send({ error: "You can only delete comments from this persona or a character." });
    }
    const deleted = await noodle.deleteInteractionById(interactionId);
    if (deleted.length === 0) return reply.code(404).send({ error: "Noodle comment not found" });
    return deleted;
  });

  app.delete("/posts/:id/interactions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = noodleRemoveInteractionSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    let actor = await noodle.getAccountByEntity(parsed.data.actorKind, parsed.data.actorEntityId);
    if (!actor && parsed.data.actorKind === "persona") {
      actor = await resolvePersonaAccount(noodle, characters, parsed.data.actorEntityId);
    }
    if (!actor) return reply.code(404).send({ error: "Noodle actor not found" });
    const interaction = await noodle.deleteInteraction(id, {
      actorAccountId: actor.id,
      type: parsed.data.type,
      parentInteractionId: parsed.data.parentInteractionId ?? null,
    });
    if (!interaction) return reply.code(404).send({ error: "Noodle interaction not found" });
    return interaction;
  });

  app.post("/refresh/images", async (req, reply) => {
    const parsed = noodleImagePromptConfirmationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const settings = await noodle.getSettings();
    const imageConnection = settings.imageGenerationConnectionId
      ? await connections.getWithKey(settings.imageGenerationConnectionId)
      : await connections.getDefaultForImageGeneration();
    if (!imageConnection) return reply.code(400).send({ error: "Select a Noodle image generation connection first." });

    for (const promptOverride of parsed.data.prompts) {
      const post = await noodle.getPostById(promptOverride.id);
      if (!post || !post.imagePrompt || post.imageUrl) continue;
      const account = await noodle.getAccountById(post.authorAccountId);
      if (!account) continue;
      try {
        const generatedImage = await generateNoodlePostImage({
          account,
          referenceAccounts: [account],
          postContent: post.content,
          draftPrompt: post.imagePrompt,
          settings,
          characters,
          characterGallery,
          promptOverrides,
          imageConnection,
          app,
          debugMode: parsed.data.debugMode === true,
          promptOverride,
        });
        await noodle.updatePostMedia(post.id, {
          imageUrl: generatedImage.imageUrl,
          metadata: generatedImage.metadata,
        });
      } catch (error) {
        logger.warn(error, "[noodle] Failed to generate reviewed image for %s", account.displayName);
        await noodle.updatePostMedia(post.id, {
          imageUrl: null,
          imagePrompt: null,
          metadata: {
            imageGenerationFailed: true,
            imageGenerationError: getErrorMessage(error).slice(0, 500),
          },
        });
      }
    }

    return bootstrapVisibleNoodle(noodle, characters);
  });

  app.post("/refresh", async (req, reply) => {
    const parsed = noodleRefreshSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const settings = await noodle.getSettings();
    const connectionId = parsed.data.connectionId ?? settings.generationConnectionId;
    if (!connectionId) return reply.code(400).send({ error: "Select a Noodle generation connection first." });
    const conn = await connections.getWithKey(connectionId);
    if (!conn) return reply.code(404).send({ error: "Noodle generation connection not found" });
    const targetPrivateAccount = parsed.data.targetAccountId
      ? await noodle.getAccountById(parsed.data.targetAccountId)
      : null;
    if (parsed.data.targetAccountId && targetPrivateAccount?.visibility !== "private") {
      return reply.code(404).send({ error: "Private Noodle account not found." });
    }
    if (parsed.data.privatePostGuide && !targetPrivateAccount) {
      return reply.code(400).send({ error: "Guided NoodleR posts require a private target account." });
    }
    // NoodleR "generate a post" is a single-account request from the private
    // profile UI: it should always produce exactly one post, regardless of the
    // global timeline generation settings. The guided flow may disable images.
    const forceSinglePrivatePost = Boolean(targetPrivateAccount);
    const requireImageForPrivatePost = forceSinglePrivatePost && parsed.data.privatePostGuide?.includeImage !== false;
    const effectiveSettings: NoodleSettings = forceSinglePrivatePost
      ? {
          ...settings,
          enableImagePrompts: requireImageForPrivatePost,
          maxImagesPerRefresh: requireImageForPrivatePost ? Math.max(settings.maxImagesPerRefresh, 1) : 0,
          maxGeneratedPostsPerRefresh: 1,
        }
      : settings;
    const imageCaptioning = await resolveImageCaptioningRuntime({
      chatMeta: {
        imageCaptioningEnabled: settings.imageCaptioningEnabled,
        imageCaptioningConnectionId: settings.imageCaptioningConnectionId,
      },
      fallbackConnectionId: connectionId,
      connections,
    });
    const imageConnection = effectiveSettings.enableImagePrompts
      ? effectiveSettings.imageGenerationConnectionId
        ? await connections.getWithKey(effectiveSettings.imageGenerationConnectionId)
        : await connections.getDefaultForImageGeneration()
      : null;
    if (effectiveSettings.enableImagePrompts && !imageConnection) {
      return reply.code(400).send({
        error: requireImageForPrivatePost
          ? "Select a Noodle image generation connection before generating a NoodleR post."
          : "Select a Noodle image generation connection first.",
      });
    }
    const refreshScopeKey = targetPrivateAccount ? targetPrivateAccount.id : NOODLE_PUBLIC_REFRESH_SCOPE;
    if (isNoodleRefreshLocked(refreshScopeKey)) {
      return reply.code(409).send({
        error: targetPrivateAccount
          ? "A refresh for this NoodleR account is already running."
          : "A Noodle timeline refresh is already running.",
      });
    }
    acquireNoodleRefreshLock(refreshScopeKey);

    const debugMode = parsed.data.debugMode === true;
    let run: Awaited<ReturnType<typeof noodle.createRefreshRun>> | null = null;

    try {
      const baseUrl = resolveBaseUrl(conn);
      const primaryProvider = createLLMProvider(
        conn.provider,
        baseUrl,
        conn.apiKey,
        conn.maxContext,
        conn.openrouterProvider,
        conn.maxTokensOverride,
        conn.claudeFastMode === "true",
        conn.treatAsLocalEndpoint === "true",
      );
      const fallbackConnection = await connections.getFallbackForMain();
      const provider = withConnectionFallbackProvider({
        primary: primaryProvider,
        primaryConnectionId: conn.id,
        fallbackConnection,
        fallbackBaseUrl: fallbackConnection ? resolveBaseUrl(fallbackConnection) : "",
        category: "main",
      });
      await ensurePersonaAccounts(noodle, characters);
      await ensureProfessorMariAccount(noodle, characters);
      const personaAccount = await resolvePersonaAccount(noodle, characters, parsed.data.personaId);
      let selectedGroupCharacterIds: Set<string>;
      let selectedParticipants: NoodleAccount[];
      if (targetPrivateAccount) {
        // Manual single-account refresh for a NoodleR account: skip the normal
        // participant pool entirely so this never mixes a private account's
        // generation into the same prompt/batch as public accounts.
        selectedGroupCharacterIds = new Set<string>();
        if (targetPrivateAccount.kind === "character" && !targetPrivateAccount.bio.trim()) {
          await generateMissingNoodleProfiles({
            noodle,
            characters,
            characterGallery,
            accounts: [targetPrivateAccount],
            provider,
            connection: conn,
            debugMode,
          });
        }
        selectedParticipants = [(await noodle.getAccountById(targetPrivateAccount.id)) ?? targetPrivateAccount];
      } else {
        selectedGroupCharacterIds = await ensureSelectedGroupCharacterAccounts(
          noodle,
          characters,
          settings.invitedCharacterGroupIds,
        );
        if (settings.allowRandomUsers) await ensureRandomUserAccounts(noodle);
        const eligibleAccounts = await noodle.listAccounts();
        const eligibleCharacterAccounts = eligibleAccounts.filter(
          (account) =>
            account.kind === "character" && (account.invited || selectedGroupCharacterIds.has(account.entityId)),
        );
        await generateMissingNoodleProfiles({
          noodle,
          characters,
          characterGallery,
          accounts: eligibleCharacterAccounts,
          provider,
          connection: conn,
          debugMode,
        });
        const participantAccounts = await noodle.listAccounts();
        const selectionCutoff = sinceHoursIso(48);
        const [recentCreatedSelectionPosts, recentPersonaSelectionReplies] = await Promise.all([
          noodle.listPosts({ since: selectionCutoff, limit: 200 }),
          personaAccount
            ? noodle.listRepliesByActorSince(personaAccount.id, selectionCutoff, 200)
            : Promise.resolve([]),
        ]);
        const personaSelectionPostIds = Array.from(
          new Set(recentPersonaSelectionReplies.map((interaction) => interaction.postId)),
        );
        const personaSelectionPosts = (
          await Promise.all(personaSelectionPostIds.map((postId) => noodle.getPostById(postId)))
        ).filter((post): post is NoodlePost => Boolean(post));
        const recentSelectionPosts = [
          ...new Map(
            [...recentCreatedSelectionPosts, ...personaSelectionPosts].map((post) => [post.id, post]),
          ).values(),
        ];
        const [recentSelectionInteractions, recentCompletedRuns] = await Promise.all([
          noodle.listInteractions(recentSelectionPosts.map((post) => post.id)),
          noodle.listRefreshRuns({ status: "completed", limit: 1 }),
        ]);
        const priorityAccountIds = collectNoodlePriorityAccountIds({
          accounts: participantAccounts,
          posts: recentSelectionPosts,
          interactions: recentSelectionInteractions,
          personaAccount,
        });
        selectedParticipants = chooseNoodleParticipantAccounts({
          accounts: participantAccounts,
          settings,
          selectedGroupCharacterIds,
          followedAccountIds: new Set(parseStringArray(personaAccount?.settings.followingAccountIds)),
          recentlyActiveAccountIds: new Set(recentCompletedRuns[0]?.activeAccountIds ?? []),
          priorityAccountIds,
        });
      }
      if (selectedParticipants.length === 0) {
        return reply
          .code(400)
          .send({ error: "Invite a character, select a character folder, or enable random users before refreshing." });
      }

      // Persona-linked NoodleR accounts can share an entityId with the viewer's active
      // persona; list selectedParticipants last so entityToAccount (built from this
      // array) resolves that entityId to the intended author, not the viewer.
      const activeAccounts = [...(personaAccount ? [personaAccount] : []), ...selectedParticipants];
      const {
        messages,
        textOnlyMessages,
        promptForLog,
        textOnlyPromptForLog,
        visionAttachmentCount,
        captionedImageCount,
        recalledPostIds,
        lorebookActivatedEntryIds,
      } = await buildRefreshPrompt({
        db: app.db,
        noodle,
        characters,
        chats,
        promptOverrides,
        activeAccounts: selectedParticipants,
        personaAccount,
        settings: effectiveSettings,
        imageCaptioning,
        requireImageForSinglePost: requireImageForPrivatePost,
        privatePostGuide: parsed.data.privatePostGuide,
      });
      logDebugOverride(debugMode, "[debug/noodle] Prompt sent to model:\n%s", promptForLog);
      if (visionAttachmentCount > 0) {
        logDebugOverride(
          debugMode,
          "[debug/noodle] Attached %d timeline image input(s) to the refresh prompt",
          visionAttachmentCount,
        );
      }
      if (captionedImageCount > 0) {
        logDebugOverride(
          debugMode,
          "[debug/noodle] Added %d generated timeline image caption(s) to the refresh prompt",
          captionedImageCount,
        );
      }
      if (lorebookActivatedEntryIds.length > 0) {
        logDebugOverride(
          debugMode,
          "[debug/noodle] Activated %d lorebook entr(ies) for this refresh: %s",
          lorebookActivatedEntryIds.length,
          lorebookActivatedEntryIds.join(", "),
        );
      }
      run = await noodle.createRefreshRun({
        activeAccountIds: activeAccounts.map((account) => account.id),
        prompt: promptForLog,
      });
      const runId = run.id;
      const timelineMaxTokens = clampGenerationMaxOutputTokens({
        provider: conn.provider as APIProvider,
        model: conn.model,
        maxTokens: timelineRefreshMaxTokens(
          selectedParticipants.filter((account) => account.kind === "character").length,
        ),
        maxTokensOverride: conn.maxTokensOverride,
      });
      const completionOptions = {
        model: conn.model,
        maxTokens: timelineMaxTokens,
        temperature: 0.9,
        topP: 0.95,
        stream: false,
        debugMode,
        responseFormat: noodleResponseFormat(conn.model, "timeline"),
      } as const;
      let requestMessages: ChatMessage[] = messages;
      let result: Awaited<ReturnType<typeof provider.chatComplete>>;
      try {
        result = await provider.chatComplete(messages, completionOptions);
      } catch (error) {
        if (visionAttachmentCount === 0 || !isUnsupportedNoodleVisionInputError(error)) throw error;
        logger.warn(
          error,
          "[noodle/vision] The selected timeline model rejected image input; retrying the refresh as text-only",
        );
        logDebugOverride(
          debugMode,
          "[debug/noodle] Text-only fallback prompt sent to model:\n%s",
          textOnlyPromptForLog,
        );
        requestMessages = textOnlyMessages;
        result = await provider.chatComplete(textOnlyMessages, completionOptions);
      }
      let content = result.content ?? "";
      let parsedGenerated: ReturnType<typeof parseNoodleGeneratedRefresh> | null = null;
      let retryReason: string | null = null;
      const allowedActorHandles = new Set(selectedParticipants.map((account) => normalizeNoodleHandle(account.handle)));
      const knownHandles = new Set(activeAccounts.map((account) => normalizeNoodleHandle(account.handle)));
      try {
        parsedGenerated = parseNoodleGeneratedRefresh(parseGameJsonish(content));
        retryReason = validateNoodleGeneratedRefresh(parsedGenerated.refresh, allowedActorHandles, knownHandles);
      } catch (error) {
        retryReason = `the response was not valid timeline JSON (${getErrorMessage(error).slice(0, 180)})`;
      }

      if (retryReason) {
        const allowedHandles = selectedParticipants.map((account) => `@${account.handle}`);
        const knownTargetHandles = activeAccounts.map((account) => `@${account.handle}`);
        logger.warn("[noodle] Retrying timeline generation because %s", retryReason);
        const correction = [
          "Your previous timeline response could not be used.",
          `Reason: ${retryReason}.`,
          `Regenerate the complete JSON object now. Authors and actors must use only these selected participant handles: ${allowedHandles.join(", ")}.`,
          `Follow targets may additionally use these known handles: ${knownTargetHandles.join(", ")}.`,
          "Do not invent, rename, or omit an authorHandle, actorHandle, or targetHandle. Return JSON only.",
        ].join("\n");
        result = await provider.chatComplete([...requestMessages, { role: "user", content: correction }], completionOptions);
        content = result.content ?? "";
        parsedGenerated = parseNoodleGeneratedRefresh(parseGameJsonish(content));
        const correctedRetryReason = validateNoodleGeneratedRefresh(
          parsedGenerated.refresh,
          allowedActorHandles,
          knownHandles,
        );
        if (correctedRetryReason) {
          throw new Error(`Noodle timeline correction could not be used because ${correctedRetryReason}.`);
        }
      }

      if (!parsedGenerated) throw new Error("Noodle timeline generation returned no usable response.");
      const generated = parsedGenerated.refresh;
      for (const rejected of parsedGenerated.rejected) {
        logger.warn(
          "[noodle] Ignoring malformed generated %s item at index %d (%d validation issue%s)",
          rejected.collection,
          rejected.index,
          rejected.issueCount,
          rejected.issueCount === 1 ? "" : "s",
        );
      }
      const handleToAccount = new Map(
        [...(personaAccount ? [personaAccount] : []), ...selectedParticipants].map((account) => [
          normalizeNoodleHandle(account.handle),
          account,
        ]),
      );
      const mutableAccountSettings = new Map(
        activeAccounts.map((account) => [account.id, { ...account.settings }] as const),
      );
      const freshPosts = await noodle.listPosts({ since: sinceHoursIso(48), limit: 200 });
      const allowedExistingPostIds = new Set([...freshPosts.map((post) => post.id), ...recalledPostIds]);
      const existingInteractionById = new Map(
        (await noodle.listInteractions([...allowedExistingPostIds])).map((interaction) => [
          interaction.id,
          interaction,
        ]),
      );
      const existingInteractions = [...existingInteractionById.values()];
      let remainingImagePrompts = effectiveSettings.enableImagePrompts ? effectiveSettings.maxImagesPerRefresh : 0;
      const tempIdToPostId = new Map<string, string>();
      const createdPostIds: string[] = [];
      const imagePromptReviewItems: Array<{
        id: string;
        kind: "illustration";
        title: string;
        prompt: string;
        negativePrompt?: string;
        width: number;
        height: number;
      }> = [];
      const activeCharacterReferenceAccounts = activeAccounts.filter((account) => account.kind === "character");
      const privatePostGuide = parsed.data.privatePostGuide;

      for (const generatedPost of generated.posts.slice(0, effectiveSettings.maxGeneratedPostsPerRefresh)) {
        const account = handleToAccount.get(normalizeNoodleHandle(generatedPost.authorHandle));
        if (!account) continue;
        if (!canGenerateNoodleActivityForAccountKind(account.kind) && account.id !== targetPrivateAccount?.id) {
          logger.warn("[noodle] Ignoring generated post attributed to persona %s", account.entityId);
          continue;
        }
        let postContent = privatePostGuide?.includeText === false ? "Shared an image." : generatedPost.content;
        let identityRedactionApplied = false;
        if (account.visibility === "private") {
          const stageProfile = parsePrivateStageProfile(account);
          const linkedContext = await resolveNoodleLinkedAuthorContext({ account, characters });
          if (linkedContext) {
            const result = enforceNoodlerIdentityBlocklist(postContent, linkedContext, stageProfile);
            postContent = result.sanitized;
            identityRedactionApplied = result.redactionsApplied;
          }
        }
        const imagePrompt =
          privatePostGuide?.includeImage === false
            ? null
            : remainingImagePrompts > 0
              ? normalizeNoodleImagePrompt(generatedPost.imagePrompt)
              : null;
        if (imagePrompt) remainingImagePrompts -= 1;
        let persistedImagePrompt = imagePrompt;
        let imageUrl: string | null = null;
        const mediaMetadata: Record<string, unknown> = {};
        let imageGenerationFailed = false;
        let imagePromptPreview: Omit<(typeof imagePromptReviewItems)[number], "id"> | null = null;
        if (imagePrompt && imageConnection) {
          try {
            const generatedImage = await generateNoodlePostImage({
              account,
              referenceAccounts: activeCharacterReferenceAccounts,
              postContent,
              draftPrompt: imagePrompt,
              settings,
              characters,
              characterGallery,
              promptOverrides,
              imageConnection,
              app,
              debugMode,
              previewOnly: parsed.data.reviewImagePromptsBeforeSend === true,
            });
            imageUrl = generatedImage.imageUrl;
            Object.assign(mediaMetadata, generatedImage.metadata);
            imagePromptPreview = generatedImage.preview;
          } catch (err) {
            logger.warn(err, "[noodle] Failed to generate image for %s", account.displayName);
            persistedImagePrompt = null;
            imageGenerationFailed = true;
            mediaMetadata.imageGenerationFailed = true;
            mediaMetadata.imageGenerationError = getErrorMessage(err).slice(0, 500);
          }
        } else if (imagePrompt) {
          persistedImagePrompt = null;
          imageGenerationFailed = true;
          mediaMetadata.imageGenerationFailed = true;
          mediaMetadata.imageGenerationError = "No image generation connection is configured.";
        }
        if (
          !imageUrl &&
          !imagePromptPreview &&
          !imageGenerationFailed &&
          privatePostGuide?.includeImage !== false &&
          settings.allowGalleryImageAttachments &&
          generatedPost.attachGalleryImage === true
        ) {
          try {
            const attachment = await pickGalleryAttachmentForAccount({ account, chats, gallery, characterGallery });
            if (attachment) {
              imageUrl = attachment.imageUrl;
              Object.assign(mediaMetadata, attachment.metadata);
            }
          } catch (err) {
            logger.warn(err, "[noodle] Failed to attach gallery image for %s", account.displayName);
          }
        }
        if (requireImageForPrivatePost && !imageUrl && !imagePromptPreview) {
          throw new Error("The guided NoodleR post did not produce an image. Try again or turn Image off.");
        }
        const mentionedAccounts = mentionedCharacterAccounts(activeAccounts, postContent);
        const poll = generatedPost.poll ? createNoodlePoll(generatedPost.poll) : null;
        // NoodleR private accounts are the OnlyFans-style paywalled profiles:
        // gate their generated posts behind a subscription by default, with an
        // occasional per-post unlock (ppv) when there's an image to bait with.
        // Public accounts keep the existing cosmetic random_user ppv flavor.
        const access: NoodlePost["access"] = privatePostGuide?.access
          ? privatePostGuide.access
          : account.visibility === "private"
            ? imageUrl && Math.random() < 0.4
              ? "ppv"
              : "subscriber"
            : account.kind === "random_user" && imageUrl && Math.random() < 0.35
              ? "ppv"
              : "public";
        const post = await noodle.createPost({
          authorAccountId: account.id,
          content: postContent,
          imagePrompt: persistedImagePrompt,
          imageUrl,
          source: "generated",
          access,
          metadata: {
            runId,
            ...mediaMetadata,
            ...mentionedAccountMetadata(mentionedAccounts),
            ...(poll ? { poll } : {}),
            ...(identityRedactionApplied ? { identityRedactionApplied: true } : {}),
          },
        });
        if (!post) continue;
        createdPostIds.push(post.id);
        if (imagePromptPreview) imagePromptReviewItems.push({ id: post.id, ...imagePromptPreview });
        if (generatedPost.tempId) tempIdToPostId.set(generatedPost.tempId, post.id);
        const digest = await noodle.createDigest({
          accountIds: [account.id, ...mentionedAccounts.map((mentionedAccount) => mentionedAccount.id)],
          content: `${account.displayName} posted on Noodle: ${post.content}`,
          sourceRunId: runId,
          sourcePostId: post.id,
        });
        if (digest) await noodle.updatePostMedia(post.id, { metadata: { activityDigestId: digest.id } });
      }

      if (forceSinglePrivatePost && createdPostIds.length === 0) {
        throw new Error("The model did not generate a post for this NoodleR account. Try again.");
      }

      const quotas: Record<NoodleInteractionType, number> = {
        like: settings.maxLikesPerRefresh,
        repost: settings.maxRepostsPerRefresh,
        reply: settings.maxRepliesPerRefresh,
        vote: settings.maxLikesPerRefresh,
      };
      for (const generatedInteraction of generated.interactions) {
        if (quotas[generatedInteraction.type] <= 0) continue;
        const actor = handleToAccount.get(normalizeNoodleHandle(generatedInteraction.actorHandle));
        if (!actor) continue;
        if (!canGenerateNoodleActivityForAccountKind(actor.kind) && actor.id !== targetPrivateAccount?.id) {
          logger.warn(
            "[noodle] Ignoring generated %s interaction attributed to persona %s",
            generatedInteraction.type,
            actor.entityId,
          );
          continue;
        }
        const targetPostId =
          generatedInteraction.targetPostId ?? tempIdToPostId.get(generatedInteraction.targetTempId ?? "");
        if (!targetPostId || (!allowedExistingPostIds.has(targetPostId) && !createdPostIds.includes(targetPostId))) {
          continue;
        }
        const targetPost = await noodle.getPostById(targetPostId);
        if (!targetPost) continue;
        const parentInteraction = generatedInteraction.parentInteractionId
          ? (existingInteractionById.get(generatedInteraction.parentInteractionId) ?? null)
          : null;
        if (
          generatedInteraction.parentInteractionId &&
          (!parentInteraction || parentInteraction.postId !== targetPostId || parentInteraction.type !== "reply")
        ) {
          continue;
        }
        if (
          !canCreateGeneratedNoodleInteraction({
            actor,
            targetPost,
            parentInteraction,
            existingInteractions,
          })
        ) {
          continue;
        }
        const poll = readNoodlePollFromMetadata(targetPost.metadata);
        const selectedPollOption =
          generatedInteraction.type === "vote" ? poll?.options[generatedInteraction.pollOptionIndex ?? -1] : undefined;
        if (generatedInteraction.type === "vote" && !selectedPollOption) continue;
        const interaction = await noodle.createInteraction(targetPostId, {
          actorAccountId: actor.id,
          type: generatedInteraction.type,
          content: selectedPollOption?.id ?? generatedInteraction.content ?? null,
          parentInteractionId: parentInteraction?.id ?? null,
        });
        if (!interaction) continue;
        existingInteractions.push(interaction);
        existingInteractionById.set(interaction.id, interaction);
        quotas[generatedInteraction.type] -= 1;
        if (generatedInteraction.type !== "like") {
          const interactionSummary =
            generatedInteraction.type === "vote" && poll && selectedPollOption
              ? `${poll.question}: ${selectedPollOption.label}`
              : interaction.content || targetPost.content;
          await noodle.createDigest({
            accountIds: Array.from(
              new Set([actor.id, targetPost.authorAccountId, parentInteraction?.actorAccountId]),
            ).filter((accountId): accountId is string => Boolean(accountId)),
            content: `${actor.displayName} ${interactionDigestVerb(
              generatedInteraction.type,
            )} a Noodle post: ${interactionSummary}`,
            sourceRunId: runId,
            sourcePostId: targetPostId,
            sourceInteractionId: interaction.id,
          });
        }
      }

      const maxGeneratedFollows = Math.max(12, activeAccounts.length * 2);
      const seenGeneratedFollows = new Set<string>();
      for (const generatedFollow of generated.follows.slice(0, maxGeneratedFollows)) {
        const actor = handleToAccount.get(normalizeNoodleHandle(generatedFollow.actorHandle));
        const target = handleToAccount.get(normalizeNoodleHandle(generatedFollow.targetHandle));
        if (!actor || !target || actor.id === target.id) continue;
        if (!canGenerateNoodleActivityForAccountKind(actor.kind) && actor.id !== targetPrivateAccount?.id) {
          logger.warn("[noodle] Ignoring generated follow attributed to persona %s", actor.entityId);
          continue;
        }
        const followKey = `${actor.id}:${target.id}`;
        if (seenGeneratedFollows.has(followKey)) continue;
        seenGeneratedFollows.add(followKey);
        const actorSettings = mutableAccountSettings.get(actor.id) ?? actor.settings;
        const currentFollowingAccountIds = parseStringArray(actorSettings.followingAccountIds);
        if (currentFollowingAccountIds.includes(target.id)) continue;
        const followedAtByAccount = parseRecord(actorSettings[NOODLE_FOLLOWED_AT_BY_ACCOUNT_KEY]);
        const nextSettings = {
          ...actorSettings,
          followingAccountIds: [...currentFollowingAccountIds, target.id],
          [NOODLE_FOLLOWED_AT_BY_ACCOUNT_KEY]: {
            ...followedAtByAccount,
            [target.id]: new Date().toISOString(),
          },
        };
        mutableAccountSettings.set(actor.id, nextSettings);
        await noodle.updateAccount(actor.id, { settings: nextSettings });
        await noodle.createDigest({
          accountIds: [actor.id, target.id],
          content: `${actor.displayName} followed ${target.displayName} on Noodle.`,
          sourceRunId: runId,
        });
      }

      await noodle.finishRefreshRun(runId, { status: "completed", result: content });
      return {
        bootstrap: await bootstrapVisibleNoodle(noodle, characters),
        imagePromptReviewItems,
        createdPostIds,
      };
    } catch (error) {
      logger.error(error, "[noodle] Timeline refresh failed");
      if (run) await noodle.finishRefreshRun(run.id, { status: "failed", error: getErrorMessage(error) });
      return reply.code(500).send({ error: getErrorMessage(error) });
    } finally {
      releaseNoodleRefreshLock(refreshScopeKey);
    }
  });
}
