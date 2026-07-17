// ──────────────────────────────────────────────
// Storage: Noodle Fake Social Media
// ──────────────────────────────────────────────
import { and, desc, eq, gt, inArray, isNull, lt, or } from "../../db/file-query.js";
import {
  DEFAULT_NOODLE_SETTINGS,
  noodleSettingsSchema,
  readNoodlePollFromMetadata,
  type NoodleAccount,
  type NoodleAccountKind,
  type NoodleAccountVisibility,
  type NoodleAvatarCrop,
  type NoodleAuthorSnapshot,
  type NoodleBootstrap,
  type NoodleCreateInteractionInput,
  type NoodleCreatePostInput,
  type NoodleDigestEntry,
  type NoodleFillerProfile,
  type NoodleInteraction,
  type NoodleInteractionType,
  type NoodleCarryoverMode,
  type NoodleCarryoverTarget,
  type NoodleAccountSubscription,
  type NoodlePost,
  type NoodlePostAccess,
  type NoodlePostUpdateInput,
  type NoodlePostSource,
  type NoodlePostUnlock,
  type NoodleRefreshAttempt,
  type NoodleRefreshRun,
  type NoodleRemoveInteractionInput,
  type NoodleSettings,
  type NoodleSettingsUpdateInput,
  type NoodleSurface,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { isFileUniqueConstraintError } from "../../db/file-schema.js";
import {
  noodleAccounts,
  noodleAccountSubscriptions,
  noodleActivityDigests,
  noodleFillerProfiles,
  noodleInteractions,
  noodlePosts,
  noodlePostUnlocks,
  noodleRefreshRuns,
  noodlerCreatorProjects,
  noodlerProjectMilestones,
} from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import { createAppSettingsStorage } from "./app-settings.storage.js";
import {
  clearNoodleRefreshFailure,
  noodleRefreshSchedulerStatus,
  parsePersistedNoodleRefreshSchedule,
  reconcileNoodleRefreshSchedule,
  type PersistedNoodleRefreshSchedule,
} from "../noodle/noodle-refresh-schedule.js";

const NOODLE_SETTINGS_KEY = "noodle.settings";
const NOODLE_REFRESH_SCHEDULE_KEY = "noodle.refresh-schedule";
const NOODLER_CREATOR_POST_SCHEDULE_KEY = "noodle.noodler-creator-post-schedule";
const NOODLE_CARRYOVER_TARGETS: NoodleCarryoverTarget[] = ["conversation", "roleplay", "game"];

// Default Noodle "random user" filler roster, seeded once (lazily, on first
// read) into noodle_filler_profiles so it becomes user-editable data instead
// of a hardcoded constant.
const DEFAULT_NOODLE_FILLER_PROFILES: Array<{ entityId: string; displayName: string; bio: string }> = [
  {
    entityId: "random_user:thread-countess",
    displayName: "Thread Countess",
    bio: "Chronically online textile hobbyist who treats every Noodle argument like court gossip.",
  },
  {
    entityId: "random_user:packet-soup",
    displayName: "Packet Soup",
    bio: "Friendly lurker, recipe collector, and accidental drama amplifier.",
  },
  {
    entityId: "random_user:orbit-notice",
    displayName: "Orbit Notice",
    bio: "Posts vague observations, likes too quickly, and follows anyone with interesting chaos.",
  },
  {
    entityId: "random_user:glass-bulletin",
    displayName: "Glass Bulletin",
    bio: "Local rumor account with polished manners and questionable sources.",
  },
  {
    entityId: "random_user:moth-hour",
    displayName: "Moth Hour",
    bio: "Night-scroller who replies with eerie encouragement and niche memes.",
  },
  {
    entityId: "random_user:brine-index",
    displayName: "Brine Index",
    bio: "Overconfident commentator who keeps a spreadsheet of everyone else's scandals.",
  },
];

type AccountRow = typeof noodleAccounts.$inferSelect;
type PostRow = typeof noodlePosts.$inferSelect;
type InteractionRow = typeof noodleInteractions.$inferSelect;
type DigestRow = typeof noodleActivityDigests.$inferSelect;
type RefreshRunRow = typeof noodleRefreshRuns.$inferSelect;
type SubscriptionRow = typeof noodleAccountSubscriptions.$inferSelect;
type PostUnlockRow = typeof noodlePostUnlocks.$inferSelect;
type FillerProfileRow = typeof noodleFillerProfiles.$inferSelect;

function normalizePostAccess(value: string): NoodlePostAccess {
  return value === "subscriber" || value === "ppv" ? value : "public";
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

function parseRefreshAttempts(value: unknown): NoodleRefreshAttempt[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): NoodleRefreshAttempt[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    const kind = candidate.kind;
    if (kind !== "initial" && kind !== "text_only_fallback" && kind !== "correction") return [];
    if (
      typeof candidate.sequence !== "number" ||
      !Number.isInteger(candidate.sequence) ||
      candidate.sequence < 1 ||
      typeof candidate.response !== "string" ||
      (candidate.rejectionReason !== null && typeof candidate.rejectionReason !== "string") ||
      typeof candidate.createdAt !== "string"
    ) {
      return [];
    }
    return [
      {
        sequence: candidate.sequence,
        kind,
        response: candidate.response,
        rejectionReason: candidate.rejectionReason,
        createdAt: candidate.createdAt,
      },
    ];
  });
}

export function parseNoodleAvatarCrop(value: unknown): NoodleAvatarCrop | null {
  let parsed = value;
  if (typeof parsed === "string") {
    if (!parsed.trim()) return null;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const crop = parsed as Record<string, unknown>;
  const finite = (entry: unknown): entry is number => typeof entry === "number" && Number.isFinite(entry);
  if (
    finite(crop.srcX) &&
    finite(crop.srcY) &&
    finite(crop.srcWidth) &&
    finite(crop.srcHeight) &&
    crop.srcWidth > 0 &&
    crop.srcHeight > 0
  ) {
    return { srcX: crop.srcX, srcY: crop.srcY, srcWidth: crop.srcWidth, srcHeight: crop.srcHeight };
  }
  if (finite(crop.zoom) && finite(crop.offsetX) && finite(crop.offsetY) && crop.zoom > 0) {
    return {
      zoom: crop.zoom,
      offsetX: crop.offsetX,
      offsetY: crop.offsetY,
      ...(crop.fullImage === true ? { fullImage: true } : {}),
    };
  }
  return null;
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

function parseAuthorSnapshot(value: unknown): NoodleAuthorSnapshot | null {
  const parsed = parseRecord(value);
  const id = typeof parsed.id === "string" ? parsed.id : "";
  const kind =
    parsed.kind === "persona" || parsed.kind === "character" || parsed.kind === "random_user" ? parsed.kind : null;
  const entityId = typeof parsed.entityId === "string" ? parsed.entityId : "";
  const handle = typeof parsed.handle === "string" ? parsed.handle : "";
  const displayName = typeof parsed.displayName === "string" ? parsed.displayName : "";
  if (!id || !kind || !entityId || !handle || !displayName) return null;
  return {
    id,
    kind,
    entityId,
    handle,
    displayName,
    avatarUrl: typeof parsed.avatarUrl === "string" && parsed.avatarUrl ? parsed.avatarUrl : null,
    avatarCrop: parseNoodleAvatarCrop(parsed.avatarCrop),
  };
}

function normalizeBool(value: unknown): boolean {
  return value === true || value === "true";
}

function normalizeHandle(name: string, fallback: string) {
  const base = (name || fallback || "noodle")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return base || "noodle";
}

// normalizeHandle only sanitizes formatting; nothing else in this file (or the
// schema — no unique index on `handle`) prevents two accounts from ending up
// with the same handle. Handle-keyed lookups (e.g. @mention resolution during
// timeline refresh) silently pick whichever account comes later, so callers
// that assign a handle should route through this to append a numeric suffix
// on collision instead.
async function resolveUniqueHandle(db: DB, name: string, fallback: string, excludeAccountId?: string): Promise<string> {
  const base = normalizeHandle(name, fallback);
  const rows = await db.select({ id: noodleAccounts.id, handle: noodleAccounts.handle }).from(noodleAccounts);
  const taken = new Set(rows.filter((row) => row.id !== excludeAccountId).map((row) => row.handle.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const trimmedBase = base.slice(0, 32);
  let suffix = 2;
  let candidate = `${trimmedBase}_${suffix}`;
  while (taken.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${trimmedBase}_${suffix}`;
  }
  return candidate;
}

function normalizeAccountKind(kind: string): NoodleAccountKind {
  if (kind === "character" || kind === "random_user") return kind;
  return "persona";
}

function legacyCarryoverTargets(mode: NoodleCarryoverMode): NoodleCarryoverTarget[] {
  if (mode === "all") return [...NOODLE_CARRYOVER_TARGETS];
  if (mode === "conversation" || mode === "roleplay" || mode === "game") return [mode];
  return [];
}

function legacyCarryoverMode(targets: NoodleCarryoverTarget[]): NoodleCarryoverMode {
  const selected = new Set(targets);
  if (NOODLE_CARRYOVER_TARGETS.every((target) => selected.has(target))) return "all";
  if (targets.length === 1) return targets[0]!;
  return "off";
}

function isToggleInteractionType(type: NoodleInteractionType) {
  return type === "like" || type === "repost";
}

export function normalizeNoodleSettings(raw: unknown): NoodleSettings {
  const rawRecord = parseRecord(raw);
  const migratedMaxImagesPerRefresh =
    rawRecord.maxImagesPerRefresh ?? rawRecord.maxImagePromptsPerDay ?? DEFAULT_NOODLE_SETTINGS.maxImagesPerRefresh;
  const rawNoodler = parseRecord(rawRecord.noodler);
  const rawCreatorPosts = parseRecord(rawNoodler.creatorPosts);
  const migratedNoodler = {
    ...DEFAULT_NOODLE_SETTINGS.noodler,
    ...rawNoodler,
    enableFanActivityScheduler:
      rawNoodler.enableFanActivityScheduler ??
      rawRecord.enableNoodlerFanActivityScheduler ??
      DEFAULT_NOODLE_SETTINGS.noodler.enableFanActivityScheduler,
    creatorPosts: {
      ...DEFAULT_NOODLE_SETTINGS.noodler.creatorPosts,
      ...rawCreatorPosts,
    },
  };
  const parsed = noodleSettingsSchema.safeParse({
    ...DEFAULT_NOODLE_SETTINGS,
    ...rawRecord,
    maxImagesPerRefresh: migratedMaxImagesPerRefresh,
    noodler: migratedNoodler,
  });
  if (!parsed.success) return noodleSettingsSchema.parse(DEFAULT_NOODLE_SETTINGS);
  const min = Math.min(parsed.data.participantMin, parsed.data.participantMax);
  const max = Math.max(parsed.data.participantMin, parsed.data.participantMax);
  const providedCarryoverModes = Array.isArray(rawRecord.carryoverModes);
  const carryoverModes = Array.from(
    new Set(parsed.data.carryoverModes.filter((mode) => NOODLE_CARRYOVER_TARGETS.includes(mode))),
  );
  const normalizedCarryoverModes =
    carryoverModes.length > 0 || providedCarryoverModes
      ? carryoverModes
      : legacyCarryoverTargets(parsed.data.carryoverMode);
  return {
    ...parsed.data,
    participantMin: min,
    participantMax: max,
    carryoverModes: normalizedCarryoverModes,
    carryoverMode: legacyCarryoverMode(normalizedCarryoverModes),
  };
}

function normalizeVisibility(value: unknown): NoodleAccountVisibility {
  return value === "private" ? "private" : "public";
}

function mapAccount(row: AccountRow): NoodleAccount {
  const settings = parseRecord(row.settings);
  return {
    id: row.id,
    kind: normalizeAccountKind(row.kind),
    entityId: row.entityId,
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio ?? "",
    avatarUrl: row.avatarUrl ?? null,
    avatarCrop: parseNoodleAvatarCrop(settings.avatarCrop),
    invited: normalizeBool(row.invited),
    settings,
    visibility: normalizeVisibility(row.visibility),
    linkedAccountId: row.linkedAccountId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapFillerProfile(row: FillerProfileRow): NoodleFillerProfile {
  return {
    id: row.id,
    entityId: row.entityId,
    displayName: row.displayName,
    bio: row.bio ?? "",
    enabled: normalizeBool(row.enabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function snapshotForAccount(account: NoodleAccount): NoodleAuthorSnapshot {
  return {
    id: account.id,
    kind: account.kind,
    entityId: account.entityId,
    handle: account.handle,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    avatarCrop: account.avatarCrop,
  };
}

function mapPost(row: PostRow): NoodlePost {
  return {
    id: row.id,
    authorAccountId: row.authorAccountId,
    content: row.content ?? "",
    imageUrl: row.imageUrl ?? null,
    imagePrompt: row.imagePrompt ?? null,
    parentPostId: row.parentPostId ?? null,
    quotePostId: row.quotePostId ?? null,
    source: row.source === "generated" ? "generated" : "manual",
    access: normalizePostAccess(row.access),
    metadata: parseRecord(row.metadata),
    authorSnapshot: parseAuthorSnapshot(row.authorSnapshot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapInteraction(row: InteractionRow): NoodleInteraction {
  return {
    id: row.id,
    postId: row.postId,
    parentInteractionId: row.parentInteractionId ?? null,
    actorAccountId: row.actorAccountId,
    type:
      row.type === "repost" || row.type === "reply" || row.type === "like" || row.type === "vote"
        ? (row.type as NoodleInteractionType)
        : "like",
    content: row.content ?? null,
    imageUrl: row.imageUrl ?? null,
    actorSnapshot: parseAuthorSnapshot(row.actorSnapshot),
    createdAt: row.createdAt,
  };
}

function mapDigest(row: DigestRow): NoodleDigestEntry {
  return {
    id: row.id,
    accountIds: parseStringArray(row.accountIds),
    content: row.content ?? "",
    sourceRunId: row.sourceRunId ?? null,
    sourcePostId: row.sourcePostId ?? null,
    sourceInteractionId: row.sourceInteractionId ?? null,
    createdAt: row.createdAt,
  };
}

function mapSubscription(row: SubscriptionRow): NoodleAccountSubscription {
  return {
    id: row.id,
    subscriberAccountId: row.subscriberAccountId,
    creatorAccountId: row.creatorAccountId,
    createdAt: row.createdAt,
  };
}

function mapPostUnlock(row: PostUnlockRow): NoodlePostUnlock {
  return {
    id: row.id,
    accountId: row.accountId,
    postId: row.postId,
    createdAt: row.createdAt,
  };
}

function mapRefreshRun(row: RefreshRunRow): NoodleRefreshRun {
  return {
    id: row.id,
    status: row.status === "completed" || row.status === "failed" ? row.status : "running",
    activeAccountIds: parseStringArray(row.activeAccountIds),
    prompt: row.prompt ?? "",
    result: row.result ?? null,
    error: row.error ?? null,
    attempts: parseRefreshAttempts(row.attempts),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createNoodleStorage(db: DB) {
  const settingsStore = createAppSettingsStorage(db);

  return {
    async getSettings(): Promise<NoodleSettings> {
      const raw = await settingsStore.get(NOODLE_SETTINGS_KEY);
      return normalizeNoodleSettings(raw);
    },

    async updateSettings(input: NoodleSettingsUpdateInput): Promise<NoodleSettings> {
      const current = await this.getSettings();
      const next = normalizeNoodleSettings({
        ...current,
        ...input,
        noodler: {
          ...current.noodler,
          ...input.noodler,
          creatorPosts: { ...current.noodler.creatorPosts, ...input.noodler?.creatorPosts },
        },
      });
      await settingsStore.set(NOODLE_SETTINGS_KEY, JSON.stringify(next));
      const currentSchedule = await this.getRefreshSchedule();
      const reconciled = reconcileNoodleRefreshSchedule(currentSchedule, next.refreshesPerDay, new Date());
      await this.saveRefreshSchedule(clearNoodleRefreshFailure(reconciled));
      const currentNoodlerSchedule = await this.getNoodlerCreatorPostSchedule();
      const reconciledNoodler = reconcileNoodleRefreshSchedule(
        currentNoodlerSchedule,
        next.noodler.creatorPosts.enabled ? next.noodler.creatorPosts.postsPerDay : 0,
        new Date(),
      );
      await this.saveNoodlerCreatorPostSchedule(clearNoodleRefreshFailure(reconciledNoodler));
      return this.getSettings();
    },

    async getRefreshSchedule(): Promise<PersistedNoodleRefreshSchedule | null> {
      const raw = await settingsStore.get(NOODLE_REFRESH_SCHEDULE_KEY);
      if (!raw) return null;
      try {
        return parsePersistedNoodleRefreshSchedule(JSON.parse(raw));
      } catch {
        return null;
      }
    },

    async saveRefreshSchedule(schedule: PersistedNoodleRefreshSchedule): Promise<void> {
      await settingsStore.set(NOODLE_REFRESH_SCHEDULE_KEY, JSON.stringify(schedule));
    },

    async ensureRefreshSchedule(
      at = new Date(),
      settingsOverride?: NoodleSettings,
    ): Promise<PersistedNoodleRefreshSchedule> {
      const settings = settingsOverride ?? (await this.getSettings());
      const current = await this.getRefreshSchedule();
      const reconciled = reconcileNoodleRefreshSchedule(current, settings.refreshesPerDay, at);
      if (!current || JSON.stringify(current) !== JSON.stringify(reconciled)) {
        await this.saveRefreshSchedule(reconciled);
      }
      return reconciled;
    },

    async getNoodlerCreatorPostSchedule(): Promise<PersistedNoodleRefreshSchedule | null> {
      const raw = await settingsStore.get(NOODLER_CREATOR_POST_SCHEDULE_KEY);
      if (!raw) return null;
      try {
        return parsePersistedNoodleRefreshSchedule(JSON.parse(raw));
      } catch {
        return null;
      }
    },

    async saveNoodlerCreatorPostSchedule(schedule: PersistedNoodleRefreshSchedule): Promise<void> {
      await settingsStore.set(NOODLER_CREATOR_POST_SCHEDULE_KEY, JSON.stringify(schedule));
    },

    async ensureNoodlerCreatorPostSchedule(
      at = new Date(),
      settingsOverride?: NoodleSettings,
    ): Promise<PersistedNoodleRefreshSchedule> {
      const settings = settingsOverride ?? (await this.getSettings());
      const current = await this.getNoodlerCreatorPostSchedule();
      const count = settings.noodler.creatorPosts.enabled ? settings.noodler.creatorPosts.postsPerDay : 0;
      const reconciled = reconcileNoodleRefreshSchedule(current, count, at);
      if (!current || JSON.stringify(current) !== JSON.stringify(reconciled)) {
        await this.saveNoodlerCreatorPostSchedule(reconciled);
      }
      return reconciled;
    },

    async listFillerProfiles(): Promise<NoodleFillerProfile[]> {
      const rows = await db.select().from(noodleFillerProfiles).orderBy(desc(noodleFillerProfiles.createdAt));
      if (rows.length === 0) {
        // Lazily seed the default roster on first read instead of during a
        // startup migration, so this works uniformly for both the legacy
        // SQLite backend and the default file-native store.
        const timestamp = now();
        await db.insert(noodleFillerProfiles).values(
          DEFAULT_NOODLE_FILLER_PROFILES.map((profile) => ({
            id: newId(),
            entityId: profile.entityId,
            displayName: profile.displayName,
            bio: profile.bio,
            enabled: "true",
            createdAt: timestamp,
            updatedAt: timestamp,
          })),
        );
        return this.listFillerProfiles();
      }
      return rows.map(mapFillerProfile);
    },

    async createFillerProfile(input: {
      displayName: string;
      bio?: string;
      enabled?: boolean;
    }): Promise<NoodleFillerProfile> {
      const id = newId();
      const timestamp = now();
      await db.insert(noodleFillerProfiles).values({
        id,
        entityId: `random_user:${id}`,
        displayName: input.displayName,
        bio: input.bio ?? "",
        enabled: input.enabled === false ? "false" : "true",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const rows = await db.select().from(noodleFillerProfiles).where(eq(noodleFillerProfiles.id, id));
      return mapFillerProfile(rows[0]!);
    },

    async updateFillerProfile(
      id: string,
      patch: { displayName?: string; bio?: string; enabled?: boolean },
    ): Promise<NoodleFillerProfile | null> {
      const existing = await db.select().from(noodleFillerProfiles).where(eq(noodleFillerProfiles.id, id));
      if (!existing[0]) return null;
      await db
        .update(noodleFillerProfiles)
        .set({
          ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
          ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled ? "true" : "false" } : {}),
          updatedAt: now(),
        })
        .where(eq(noodleFillerProfiles.id, id));
      const rows = await db.select().from(noodleFillerProfiles).where(eq(noodleFillerProfiles.id, id));
      return rows[0] ? mapFillerProfile(rows[0]) : null;
    },

    async deleteFillerProfile(id: string): Promise<boolean> {
      const existing = await db.select().from(noodleFillerProfiles).where(eq(noodleFillerProfiles.id, id));
      if (!existing[0]) return false;
      const accounts = await db
        .select()
        .from(noodleAccounts)
        .where(and(eq(noodleAccounts.kind, "random_user"), eq(noodleAccounts.entityId, existing[0].entityId)));
      const accountIds = accounts.map((account) => account.id);
      const posts =
        accountIds.length > 0
          ? await db.select().from(noodlePosts).where(inArray(noodlePosts.authorAccountId, accountIds))
          : [];
      const postIds = posts.map((post) => post.id);
      const allInteractions = await db.select().from(noodleInteractions);
      const interactionIdSet = new Set(
        allInteractions
          .filter(
            (interaction) => accountIds.includes(interaction.actorAccountId) || postIds.includes(interaction.postId),
          )
          .map((interaction) => interaction.id),
      );
      let foundChild = true;
      while (foundChild) {
        foundChild = false;
        for (const interaction of allInteractions) {
          if (
            !interactionIdSet.has(interaction.id) &&
            interaction.parentInteractionId &&
            interactionIdSet.has(interaction.parentInteractionId)
          ) {
            interactionIdSet.add(interaction.id);
            foundChild = true;
          }
        }
      }
      const interactionIds = [...interactionIdSet];
      const digests = await db.select().from(noodleActivityDigests);
      const digestIds = digests
        .filter((digest) => {
          try {
            const ids = JSON.parse(digest.accountIds);
            return Array.isArray(ids) && ids.some((accountId) => accountIds.includes(accountId));
          } catch {
            return false;
          }
        })
        .map((digest) => digest.id);

      await db.transaction(async (tx) => {
        await tx.delete(noodleFillerProfiles).where(eq(noodleFillerProfiles.id, id));
        if (digestIds.length > 0)
          await tx.delete(noodleActivityDigests).where(inArray(noodleActivityDigests.id, digestIds));
        if (postIds.length > 0) {
          await tx.delete(noodleActivityDigests).where(inArray(noodleActivityDigests.sourcePostId, postIds));
          await tx.delete(noodlePostUnlocks).where(inArray(noodlePostUnlocks.postId, postIds));
          await tx.delete(noodlePosts).where(inArray(noodlePosts.id, postIds));
        }
        if (interactionIds.length > 0) {
          await tx
            .delete(noodleActivityDigests)
            .where(inArray(noodleActivityDigests.sourceInteractionId, interactionIds));
          await tx.delete(noodleInteractions).where(inArray(noodleInteractions.id, interactionIds));
        }
        if (accountIds.length > 0) {
          await tx
            .delete(noodleAccountSubscriptions)
            .where(
              or(
                inArray(noodleAccountSubscriptions.subscriberAccountId, accountIds),
                inArray(noodleAccountSubscriptions.creatorAccountId, accountIds),
              ),
            );
          await tx.delete(noodlePostUnlocks).where(inArray(noodlePostUnlocks.accountId, accountIds));
          await tx.delete(noodleAccounts).where(inArray(noodleAccounts.id, accountIds));
        }
      });
      return true;
    },

    async listAccounts(options: { includePrivate?: boolean } = {}): Promise<NoodleAccount[]> {
      const includePrivate = options.includePrivate ?? true;
      const rows = includePrivate
        ? await db.select().from(noodleAccounts).orderBy(desc(noodleAccounts.updatedAt))
        : await db
            .select()
            .from(noodleAccounts)
            .where(eq(noodleAccounts.visibility, "public"))
            .orderBy(desc(noodleAccounts.updatedAt));
      return rows.map(mapAccount);
    },

    async getAccountById(id: string): Promise<NoodleAccount | null> {
      const rows = await db.select().from(noodleAccounts).where(eq(noodleAccounts.id, id));
      return rows[0] ? mapAccount(rows[0]) : null;
    },

    async getAccountByEntity(kind: NoodleAccountKind, entityId: string): Promise<NoodleAccount | null> {
      // Scoped to public accounts: a private (NoodleR) account can share kind+entityId
      // with its linked public account, and entity-keyed sync logic must only ever
      // resolve the public one.
      const rows = await db
        .select()
        .from(noodleAccounts)
        .where(
          and(
            eq(noodleAccounts.kind, kind),
            eq(noodleAccounts.entityId, entityId),
            eq(noodleAccounts.visibility, "public"),
          ),
        );
      return rows[0] ? mapAccount(rows[0]) : null;
    },

    async getAccountsByEntities(kind: NoodleAccountKind, entityIds: string[]): Promise<NoodleAccount[]> {
      if (entityIds.length === 0) return [];
      const rows = await db
        .select()
        .from(noodleAccounts)
        .where(
          and(
            eq(noodleAccounts.kind, kind),
            inArray(noodleAccounts.entityId, entityIds),
            eq(noodleAccounts.visibility, "public"),
          ),
        );
      return rows.map(mapAccount);
    },

    async listPrivateAccounts(): Promise<NoodleAccount[]> {
      const rows = await db.select().from(noodleAccounts).where(eq(noodleAccounts.visibility, "private"));
      return rows.map(mapAccount);
    },

    async createPrivateAccount(publicAccountId: string): Promise<NoodleAccount | null> {
      const publicAccount = await this.getAccountById(publicAccountId);
      if (!publicAccount || publicAccount.visibility !== "public" || publicAccount.linkedAccountId) return null;
      if (publicAccount.kind !== "persona" && publicAccount.kind !== "character") return null;
      const timestamp = now();
      const id = newId();
      const handle = await resolveUniqueHandle(db, `${publicAccount.handle}_private`, publicAccount.entityId);
      await db.insert(noodleAccounts).values({
        id,
        kind: publicAccount.kind,
        entityId: publicAccount.entityId,
        handle,
        displayName: publicAccount.displayName,
        bio: "",
        avatarUrl: null,
        invited: "false",
        // Defaults new private accounts to requiring a separate PPV unlock
        // even for subscribers. Accounts created before this flag existed
        // read as `undefined` and keep the legacy subscription-includes-PPV
        // behavior (see canRevealPostAccess in NoodleView.tsx).
        settings: JSON.stringify({ subscriptionIncludesPpv: false }),
        visibility: "private",
        linkedAccountId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await db
        .update(noodleAccounts)
        .set({ linkedAccountId: id, updatedAt: now() })
        .where(eq(noodleAccounts.id, publicAccountId));
      return this.getAccountById(id);
    },

    async deletePrivateAccount(id: string): Promise<NoodleAccount | null> {
      const existing = await this.getAccountById(id);
      if (!existing || existing.visibility !== "private") return null;

      const posts = await db.select().from(noodlePosts).where(eq(noodlePosts.authorAccountId, id));
      const postIds = posts.map((post) => post.id);
      const postInteractions =
        postIds.length > 0
          ? await db.select().from(noodleInteractions).where(inArray(noodleInteractions.postId, postIds))
          : [];
      const actorInteractions = await db
        .select()
        .from(noodleInteractions)
        .where(eq(noodleInteractions.actorAccountId, id));
      const allInteractions = await db.select().from(noodleInteractions);
      const interactionIdSet = new Set(
        [...postInteractions, ...actorInteractions].map((interaction) => interaction.id),
      );
      let foundChild = true;
      while (foundChild) {
        foundChild = false;
        for (const interaction of allInteractions) {
          if (
            !interactionIdSet.has(interaction.id) &&
            interaction.parentInteractionId &&
            interactionIdSet.has(interaction.parentInteractionId)
          ) {
            interactionIdSet.add(interaction.id);
            foundChild = true;
          }
        }
      }
      const interactionIds = [...interactionIdSet];

      await db.transaction(async (tx) => {
        const creatorProjects = await tx
          .select()
          .from(noodlerCreatorProjects)
          .where(eq(noodlerCreatorProjects.creatorAccountId, id));
        const creatorProjectIds = creatorProjects.map((project) => project.id);
        if (creatorProjectIds.length > 0) {
          await tx
            .delete(noodlerProjectMilestones)
            .where(inArray(noodlerProjectMilestones.projectId, creatorProjectIds));
          await tx.delete(noodlerCreatorProjects).where(inArray(noodlerCreatorProjects.id, creatorProjectIds));
        }
        if (postIds.length > 0) {
          await tx.delete(noodleActivityDigests).where(inArray(noodleActivityDigests.sourcePostId, postIds));
          await tx.delete(noodlePostUnlocks).where(inArray(noodlePostUnlocks.postId, postIds));
          await tx.delete(noodlePosts).where(inArray(noodlePosts.id, postIds));
        }
        if (interactionIds.length > 0) {
          await tx
            .delete(noodleActivityDigests)
            .where(inArray(noodleActivityDigests.sourceInteractionId, interactionIds));
          await tx.delete(noodleInteractions).where(inArray(noodleInteractions.id, interactionIds));
        }
        await tx
          .delete(noodleAccountSubscriptions)
          .where(
            or(
              eq(noodleAccountSubscriptions.subscriberAccountId, id),
              eq(noodleAccountSubscriptions.creatorAccountId, id),
            ),
          );
        await tx.delete(noodlePostUnlocks).where(eq(noodlePostUnlocks.accountId, id));
        await tx
          .update(noodleAccounts)
          .set({ linkedAccountId: null, updatedAt: now() })
          .where(eq(noodleAccounts.linkedAccountId, id));
        await tx.delete(noodleAccounts).where(eq(noodleAccounts.id, id));
      });

      return existing;
    },

    async upsertAccountFromProfile(input: {
      kind: NoodleAccountKind;
      entityId: string;
      displayName: string;
      avatarUrl?: string | null;
      avatarCrop?: NoodleAvatarCrop | null;
      bio?: string | null;
      invited?: boolean;
      /** Keep entity-owned identity fields current without replacing generated profile copy. */
      syncIdentity?: boolean;
    }): Promise<NoodleAccount> {
      const existing = await this.getAccountByEntity(input.kind, input.entityId);
      if (existing) {
        const updates: Record<string, unknown> = { updatedAt: now() };
        const profileManuallyEdited = existing.settings.profileManuallyEdited === true;
        if (input.syncIdentity && !profileManuallyEdited) {
          updates.displayName = input.displayName.trim().slice(0, 120) || existing.handle;
          if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl;
        } else if (!existing.displayName.trim()) {
          updates.displayName = input.displayName || existing.handle;
        }
        if (!profileManuallyEdited && !existing.bio.trim() && input.bio) updates.bio = input.bio;
        if (!input.syncIdentity && !existing.avatarUrl && input.avatarUrl) updates.avatarUrl = input.avatarUrl;
        if (input.avatarCrop !== undefined && !profileManuallyEdited) {
          updates.settings = JSON.stringify({ ...existing.settings, avatarCrop: input.avatarCrop });
        }
        if (input.invited !== undefined) updates.invited = String(input.invited);
        await db.update(noodleAccounts).set(updates).where(eq(noodleAccounts.id, existing.id));
        return (await this.getAccountById(existing.id)) ?? existing;
      }

      const timestamp = now();
      const id = newId();
      const displayName = input.displayName.trim() || (input.kind === "persona" ? "User" : "Character");
      const handle = await resolveUniqueHandle(db, displayName, input.entityId);
      await db.insert(noodleAccounts).values({
        id,
        kind: input.kind,
        entityId: input.entityId,
        handle,
        displayName,
        bio: input.bio?.trim() ?? "",
        avatarUrl: input.avatarUrl ?? null,
        invited: String(input.invited ?? input.kind === "persona"),
        settings: JSON.stringify(input.avatarCrop !== undefined ? { avatarCrop: input.avatarCrop } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return (await this.getAccountById(id))!;
    },

    async updateAccount(id: string, input: Partial<NoodleAccount>): Promise<NoodleAccount | null> {
      const existing = await this.getAccountById(id);
      if (!existing) return null;
      const handle =
        input.handle !== undefined ? await resolveUniqueHandle(db, input.handle, existing.entityId, id) : undefined;
      await db
        .update(noodleAccounts)
        .set({
          ...(handle !== undefined && { handle }),
          ...(input.displayName !== undefined && { displayName: input.displayName.trim().slice(0, 120) }),
          ...(input.bio !== undefined && { bio: input.bio.slice(0, 500) }),
          ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
          ...(input.invited !== undefined && { invited: String(input.invited) }),
          ...(input.settings !== undefined && { settings: JSON.stringify(input.settings) }),
          updatedAt: now(),
        })
        .where(eq(noodleAccounts.id, id));
      return this.getAccountById(id);
    },

    async setCharacterInvited(characterId: string, invited: boolean): Promise<NoodleAccount | null> {
      const existing = await this.getAccountByEntity("character", characterId);
      if (!existing) return null;
      return this.updateAccount(existing.id, { invited });
    },

    /** Mark every currently invited character account as uninvited. */
    async clearCharacterInvites(): Promise<void> {
      await db
        .update(noodleAccounts)
        .set({ invited: "false", updatedAt: now() })
        .where(and(eq(noodleAccounts.kind, "character"), eq(noodleAccounts.invited, "true")));
    },

    async listPosts(options: { limit?: number; since?: string } = {}): Promise<NoodlePost[]> {
      const limit = Math.max(1, Math.min(300, Math.floor(options.limit ?? 120)));
      const rows = options.since
        ? await db
            .select()
            .from(noodlePosts)
            .where(gt(noodlePosts.createdAt, options.since))
            .orderBy(desc(noodlePosts.createdAt))
            .limit(limit)
        : await db.select().from(noodlePosts).orderBy(desc(noodlePosts.createdAt)).limit(limit);
      return rows.map(mapPost);
    },

    async listSurfacePosts(
      surface: NoodleSurface,
      options: { limit?: number; since?: string; authorAccountId?: string } = {},
    ): Promise<NoodlePost[]> {
      const accounts = await this.listAccounts({ includePrivate: true });
      const accountIds = new Set(
        accounts
          .filter(
            (account) =>
              account.visibility === surface &&
              (options.authorAccountId === undefined || account.id === options.authorAccountId),
          )
          .map((account) => account.id),
      );
      if (accountIds.size === 0) return [];
      const rows = options.since
        ? await db
            .select()
            .from(noodlePosts)
            .where(gt(noodlePosts.createdAt, options.since))
            .orderBy(desc(noodlePosts.createdAt))
        : await db.select().from(noodlePosts).orderBy(desc(noodlePosts.createdAt));
      const limit = Math.max(1, Math.min(300, Math.floor(options.limit ?? 120)));
      return rows
        .filter((row) => accountIds.has(row.authorAccountId))
        .slice(0, limit)
        .map(mapPost);
    },

    async getMostRecentPostByAuthor(authorAccountId: string): Promise<NoodlePost | null> {
      const rows = await db
        .select()
        .from(noodlePosts)
        .where(eq(noodlePosts.authorAccountId, authorAccountId))
        .orderBy(desc(noodlePosts.createdAt))
        .limit(1);
      return rows[0] ? mapPost(rows[0]) : null;
    },

    async listRecentPostsByAuthor(authorAccountId: string, limit = 8): Promise<NoodlePost[]> {
      const rows = await db
        .select()
        .from(noodlePosts)
        .where(eq(noodlePosts.authorAccountId, authorAccountId))
        .orderBy(desc(noodlePosts.createdAt))
        .limit(Math.max(1, Math.min(50, Math.floor(limit))));
      return rows.map(mapPost);
    },

    async listPostsBefore(before: string, options: { limit?: number } = {}): Promise<NoodlePost[]> {
      const query = db
        .select()
        .from(noodlePosts)
        .where(lt(noodlePosts.createdAt, before))
        .orderBy(desc(noodlePosts.createdAt));
      const rows = options.limit
        ? await query.limit(Math.max(1, Math.min(200, Math.floor(options.limit))))
        : await query;
      return rows.map(mapPost);
    },

    async listSurfacePostsBefore(
      surface: NoodleSurface,
      before: string,
      options: { limit?: number; authorAccountId?: string } = {},
    ): Promise<NoodlePost[]> {
      const accounts = await this.listAccounts({ includePrivate: true });
      const accountIds = new Set(
        accounts
          .filter(
            (account) =>
              account.visibility === surface &&
              (options.authorAccountId === undefined || account.id === options.authorAccountId),
          )
          .map((account) => account.id),
      );
      if (accountIds.size === 0) return [];
      const rows = await db
        .select()
        .from(noodlePosts)
        .where(lt(noodlePosts.createdAt, before))
        .orderBy(desc(noodlePosts.createdAt));
      const filtered = rows.filter((row) => accountIds.has(row.authorAccountId));
      const limited = options.limit
        ? filtered.slice(0, Math.max(1, Math.min(200, Math.floor(options.limit))))
        : filtered;
      return limited.map(mapPost);
    },

    async hasPostsBefore(before: string): Promise<boolean> {
      const rows = await db
        .select({ id: noodlePosts.id })
        .from(noodlePosts)
        .where(lt(noodlePosts.createdAt, before))
        .limit(1);
      return rows.length > 0;
    },

    async hasSurfacePostsBefore(surface: NoodleSurface, before: string): Promise<boolean> {
      return (await this.listSurfacePostsBefore(surface, before, { limit: 1 })).length > 0;
    },

    async createPost(
      input: Omit<NoodleCreatePostInput, "authorKind" | "authorEntityId"> & {
        authorAccountId: string;
        source?: NoodlePostSource;
        access?: NoodlePostAccess;
        metadata?: Record<string, unknown>;
      },
    ): Promise<NoodlePost | null> {
      const account = await this.getAccountById(input.authorAccountId);
      if (!account) return null;
      const timestamp = now();
      const id = newId();
      await db.insert(noodlePosts).values({
        id,
        authorAccountId: input.authorAccountId,
        content: input.content,
        imageUrl: input.imageUrl ?? null,
        imagePrompt: input.imagePrompt ?? null,
        parentPostId: input.parentPostId ?? null,
        quotePostId: input.quotePostId ?? null,
        source: input.source ?? "manual",
        access: input.access ?? "public",
        metadata: JSON.stringify(input.metadata ?? {}),
        authorSnapshot: JSON.stringify(snapshotForAccount(account)),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return (await this.getPostById(id))!;
    },

    async getPostById(id: string): Promise<NoodlePost | null> {
      const rows = await db.select().from(noodlePosts).where(eq(noodlePosts.id, id));
      return rows[0] ? mapPost(rows[0]) : null;
    },

    async getPostSurface(id: string): Promise<NoodleSurface | null> {
      const post = await this.getPostById(id);
      if (!post) return null;
      const account = await this.getAccountById(post.authorAccountId);
      return account?.visibility ?? null;
    },

    async updatePostMedia(
      id: string,
      input: { imageUrl?: string | null; imagePrompt?: string | null; metadata?: Record<string, unknown> },
    ): Promise<NoodlePost | null> {
      const existing = await this.getPostById(id);
      if (!existing) return null;
      await db
        .update(noodlePosts)
        .set({
          ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
          ...(input.imagePrompt !== undefined && { imagePrompt: input.imagePrompt }),
          ...(input.metadata !== undefined && {
            metadata: JSON.stringify({ ...existing.metadata, ...input.metadata }),
          }),
          updatedAt: now(),
        })
        .where(eq(noodlePosts.id, id));
      return this.getPostById(id);
    },

    async updatePost(id: string, input: NoodlePostUpdateInput): Promise<NoodlePost | null> {
      const existing = await this.getPostById(id);
      if (!existing) return null;
      await db
        .update(noodlePosts)
        .set({
          ...(input.content !== undefined && { content: input.content.trim().slice(0, 4000) }),
          ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
          ...(input.imagePrompt !== undefined && { imagePrompt: input.imagePrompt }),
          updatedAt: now(),
        })
        .where(eq(noodlePosts.id, id));
      return this.getPostById(id);
    },

    async deletePost(id: string): Promise<NoodlePost | null> {
      const existing = await this.getPostById(id);
      if (!existing) return null;
      await db.transaction(async (tx) => {
        await tx.delete(noodleInteractions).where(eq(noodleInteractions.postId, id));
        await tx.delete(noodleActivityDigests).where(eq(noodleActivityDigests.sourcePostId, id));
        await tx.delete(noodlePostUnlocks).where(eq(noodlePostUnlocks.postId, id));
        await tx
          .update(noodlerProjectMilestones)
          .set({
            status: "ready",
            generatedPostId: null,
            completionSummary: "",
            completedAt: null,
            updatedAt: now(),
          })
          .where(eq(noodlerProjectMilestones.generatedPostId, id));
        await tx.delete(noodlePosts).where(eq(noodlePosts.id, id));
      });
      return existing;
    },

    async resetTimeline(): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.delete(noodleInteractions);
        await tx.delete(noodleActivityDigests);
        await tx.delete(noodleRefreshRuns);
        await tx.delete(noodlePostUnlocks);
        await tx.update(noodlerProjectMilestones).set({
          status: "ready",
          generatedPostId: null,
          completionSummary: "",
          completedAt: null,
          updatedAt: now(),
        });
        await tx.delete(noodlePosts);
      });
    },

    async listInteractions(postIds: string[] = []): Promise<NoodleInteraction[]> {
      if (postIds.length === 0) return [];
      const rows = await db
        .select()
        .from(noodleInteractions)
        .where(inArray(noodleInteractions.postId, postIds))
        .orderBy(noodleInteractions.createdAt);
      return rows.map(mapInteraction);
    },

    async listRepliesByActorSince(actorAccountId: string, since: string, limit = 100): Promise<NoodleInteraction[]> {
      const rows = await db
        .select()
        .from(noodleInteractions)
        .where(
          and(
            eq(noodleInteractions.actorAccountId, actorAccountId),
            eq(noodleInteractions.type, "reply"),
            gt(noodleInteractions.createdAt, since),
          ),
        )
        .orderBy(desc(noodleInteractions.createdAt))
        .limit(Math.max(1, Math.min(200, Math.floor(limit))));
      return rows.map(mapInteraction);
    },

    async getInteractionById(id: string): Promise<NoodleInteraction | null> {
      const rows = await db.select().from(noodleInteractions).where(eq(noodleInteractions.id, id));
      return rows[0] ? mapInteraction(rows[0]) : null;
    },

    async updateInteraction(
      id: string,
      input: { content?: string | null; imageUrl?: string | null },
    ): Promise<NoodleInteraction | null> {
      const existing = await this.getInteractionById(id);
      if (!existing) return null;
      await db
        .update(noodleInteractions)
        .set({
          ...(input.content !== undefined && { content: input.content?.trim() || null }),
          ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl?.trim() || null }),
        })
        .where(eq(noodleInteractions.id, id));
      return this.getInteractionById(id);
    },

    async deleteInteractionById(id: string): Promise<NoodleInteraction[]> {
      const existing = await this.getInteractionById(id);
      if (!existing) return [];
      const rows = await db.select().from(noodleInteractions).where(eq(noodleInteractions.postId, existing.postId));
      const deletedIds = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of rows) {
          if (deletedIds.has(row.id) || !row.parentInteractionId || !deletedIds.has(row.parentInteractionId)) continue;
          deletedIds.add(row.id);
          changed = true;
        }
      }
      const deletedRows = rows.filter((row) => deletedIds.has(row.id));
      await db.transaction(async (tx) => {
        await tx
          .delete(noodleActivityDigests)
          .where(inArray(noodleActivityDigests.sourceInteractionId, [...deletedIds]));
        await tx.delete(noodleInteractions).where(inArray(noodleInteractions.id, [...deletedIds]));
      });
      return deletedRows.map(mapInteraction);
    },

    async createInteraction(
      postId: string,
      input: Omit<NoodleCreateInteractionInput, "actorKind" | "actorEntityId"> & { actorAccountId: string },
    ): Promise<NoodleInteraction | null> {
      const [post, actor] = await Promise.all([this.getPostById(postId), this.getAccountById(input.actorAccountId)]);
      if (!post || !actor) return null;

      const parentInteractionId = input.parentInteractionId ?? null;
      if (parentInteractionId) {
        const parentRows = await db
          .select()
          .from(noodleInteractions)
          .where(eq(noodleInteractions.id, parentInteractionId));
        const parent = parentRows[0];
        if (!parent || parent.postId !== postId || parent.type !== "reply") return null;
      }

      if (input.type === "vote") {
        if (parentInteractionId) return null;
        const poll = readNoodlePollFromMetadata(post.metadata);
        const optionId = input.content?.trim() ?? "";
        if (!poll || !poll.options.some((option) => option.id === optionId)) return null;
        const existingVotes = await db
          .select()
          .from(noodleInteractions)
          .where(
            and(
              eq(noodleInteractions.postId, postId),
              eq(noodleInteractions.actorAccountId, input.actorAccountId),
              eq(noodleInteractions.type, "vote"),
              isNull(noodleInteractions.parentInteractionId),
            ),
          );
        const existingVote = existingVotes[0];
        if (existingVote) {
          await db
            .update(noodleInteractions)
            .set({
              content: optionId,
              actorSnapshot: JSON.stringify(snapshotForAccount(actor)),
            })
            .where(eq(noodleInteractions.id, existingVote.id));
          const updated = await db.select().from(noodleInteractions).where(eq(noodleInteractions.id, existingVote.id));
          return updated[0] ? mapInteraction(updated[0]) : null;
        }
      }

      const readExistingToggleInteraction = async () => {
        if (!isToggleInteractionType(input.type)) return null;
        const existing = await db
          .select()
          .from(noodleInteractions)
          .where(
            and(
              eq(noodleInteractions.postId, postId),
              eq(noodleInteractions.actorAccountId, input.actorAccountId),
              eq(noodleInteractions.type, input.type),
              parentInteractionId
                ? eq(noodleInteractions.parentInteractionId, parentInteractionId)
                : isNull(noodleInteractions.parentInteractionId),
            ),
          );
        return existing[0] ? mapInteraction(existing[0]) : null;
      };

      const existingToggleInteraction = await readExistingToggleInteraction();
      if (existingToggleInteraction) return existingToggleInteraction;

      const id = newId();
      try {
        await db.insert(noodleInteractions).values({
          id,
          postId,
          parentInteractionId,
          actorAccountId: input.actorAccountId,
          type: input.type,
          content: input.content?.trim() || null,
          imageUrl: input.imageUrl?.trim() || null,
          actorSnapshot: JSON.stringify(snapshotForAccount(actor)),
          createdAt: now(),
        });
      } catch (error) {
        const toggleKeys = ["postId", "actorAccountId", "type", "parentInteractionId"];
        if (
          isToggleInteractionType(input.type) &&
          isFileUniqueConstraintError(error, "noodle_interactions", toggleKeys)
        ) {
          const existing = await readExistingToggleInteraction();
          if (existing) return existing;
        }
        throw error;
      }
      const rows = await db.select().from(noodleInteractions).where(eq(noodleInteractions.id, id));
      return rows[0] ? mapInteraction(rows[0]) : null;
    },

    async deleteInteraction(
      postId: string,
      input: Omit<NoodleRemoveInteractionInput, "actorKind" | "actorEntityId"> & { actorAccountId: string },
    ): Promise<NoodleInteraction | null> {
      const rows = await db
        .select()
        .from(noodleInteractions)
        .where(
          and(
            eq(noodleInteractions.postId, postId),
            eq(noodleInteractions.actorAccountId, input.actorAccountId),
            eq(noodleInteractions.type, input.type),
            input.parentInteractionId
              ? eq(noodleInteractions.parentInteractionId, input.parentInteractionId)
              : isNull(noodleInteractions.parentInteractionId),
          ),
        );
      const existing = rows[0];
      if (!existing) return null;
      await db.transaction(async (tx) => {
        await tx.delete(noodleActivityDigests).where(eq(noodleActivityDigests.sourceInteractionId, existing.id));
        await tx.delete(noodleInteractions).where(eq(noodleInteractions.id, existing.id));
      });
      return mapInteraction(existing);
    },

    async createDigest(input: {
      accountIds: string[];
      content: string;
      sourceRunId?: string | null;
      sourcePostId?: string | null;
      sourceInteractionId?: string | null;
    }): Promise<NoodleDigestEntry | null> {
      const id = newId();
      const uniqueAccountIds = Array.from(new Set(input.accountIds.filter(Boolean)));
      // NoodleR (private) activity must never surface in the shared activity
      // digest — it feeds both the notification tray and chat/roleplay carryover
      // context, either of which would leak a "secret" account's existence.
      if (uniqueAccountIds.length > 0) {
        const involvedAccounts = await db
          .select()
          .from(noodleAccounts)
          .where(inArray(noodleAccounts.id, uniqueAccountIds));
        if (
          involvedAccounts.length !== uniqueAccountIds.length ||
          involvedAccounts.some((row) => row.visibility === "private")
        )
          return null;
      }
      if (input.sourcePostId && (await this.getPostSurface(input.sourcePostId)) !== "public") return null;
      if (input.sourceInteractionId) {
        const sourceInteractions = await db
          .select()
          .from(noodleInteractions)
          .where(eq(noodleInteractions.id, input.sourceInteractionId));
        const sourceInteraction = sourceInteractions[0];
        if (!sourceInteraction || (await this.getPostSurface(sourceInteraction.postId)) !== "public") return null;
        const actor = await this.getAccountById(sourceInteraction.actorAccountId);
        if (!actor || actor.visibility !== "public") return null;
      }
      await db.transaction(async (tx) => {
        if (input.sourceInteractionId) {
          await tx
            .delete(noodleActivityDigests)
            .where(eq(noodleActivityDigests.sourceInteractionId, input.sourceInteractionId));
        }
        await tx.insert(noodleActivityDigests).values({
          id,
          accountIds: JSON.stringify(uniqueAccountIds),
          content: input.content.trim().slice(0, 1200),
          sourceRunId: input.sourceRunId ?? null,
          sourcePostId: input.sourcePostId ?? null,
          sourceInteractionId: input.sourceInteractionId ?? null,
          createdAt: now(),
        });
      });
      const rows = await db.select().from(noodleActivityDigests).where(eq(noodleActivityDigests.id, id));
      return mapDigest(rows[0]!);
    },

    async updateDigest(
      id: string,
      input: { accountIds: string[]; content: string },
    ): Promise<NoodleDigestEntry | null> {
      const uniqueAccountIds = Array.from(new Set(input.accountIds.filter(Boolean)));
      const involvedAccounts =
        uniqueAccountIds.length > 0
          ? await db.select().from(noodleAccounts).where(inArray(noodleAccounts.id, uniqueAccountIds))
          : [];
      if (
        involvedAccounts.length !== uniqueAccountIds.length ||
        involvedAccounts.some((row) => row.visibility === "private")
      )
        return null;
      const existingRows = await db.select().from(noodleActivityDigests).where(eq(noodleActivityDigests.id, id));
      const existing = existingRows[0];
      if (!existing) return null;
      if (existing.sourcePostId && (await this.getPostSurface(existing.sourcePostId)) !== "public") return null;
      if (existing.sourceInteractionId) {
        const sourceInteractions = await db
          .select()
          .from(noodleInteractions)
          .where(eq(noodleInteractions.id, existing.sourceInteractionId));
        const sourceInteraction = sourceInteractions[0];
        if (!sourceInteraction || (await this.getPostSurface(sourceInteraction.postId)) !== "public") return null;
      }
      await db
        .update(noodleActivityDigests)
        .set({
          accountIds: JSON.stringify(uniqueAccountIds),
          content: input.content.trim().slice(0, 1200),
        })
        .where(eq(noodleActivityDigests.id, id));
      const rows = await db.select().from(noodleActivityDigests).where(eq(noodleActivityDigests.id, id));
      return rows[0] ? mapDigest(rows[0]) : null;
    },

    async listDigests(options: { limit?: number; since?: string } = {}): Promise<NoodleDigestEntry[]> {
      const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 80)));
      const fetchLimit = 200;
      const rows = options.since
        ? await db
            .select()
            .from(noodleActivityDigests)
            .where(gt(noodleActivityDigests.createdAt, options.since))
            .orderBy(desc(noodleActivityDigests.createdAt))
            .limit(fetchLimit)
        : await db
            .select()
            .from(noodleActivityDigests)
            .orderBy(desc(noodleActivityDigests.createdAt))
            .limit(fetchLimit);

      const sourcePostIds = Array.from(new Set(rows.flatMap((row) => (row.sourcePostId ? [row.sourcePostId] : []))));
      const sourceInteractionIds = Array.from(
        new Set(rows.flatMap((row) => (row.sourceInteractionId ? [row.sourceInteractionId] : []))),
      );
      const accountIds = Array.from(new Set(rows.flatMap((row) => mapDigest(row).accountIds)));
      const [sourcePosts, sourceInteractions, involvedAccounts] = await Promise.all([
        sourcePostIds.length > 0
          ? db.select().from(noodlePosts).where(inArray(noodlePosts.id, sourcePostIds))
          : Promise.resolve([]),
        sourceInteractionIds.length > 0
          ? db.select().from(noodleInteractions).where(inArray(noodleInteractions.id, sourceInteractionIds))
          : Promise.resolve([]),
        accountIds.length > 0
          ? db.select().from(noodleAccounts).where(inArray(noodleAccounts.id, accountIds))
          : Promise.resolve([]),
      ]);
      const sourcePostById = new Map(sourcePosts.map((post) => [post.id, post]));
      const sourceInteractionById = new Map(sourceInteractions.map((interaction) => [interaction.id, interaction]));
      const publicAccountIds = new Set(
        involvedAccounts.filter((account) => account.visibility === "public").map((account) => account.id),
      );

      return rows
        .filter((row) => {
          const digest = mapDigest(row);
          if (!digest.accountIds.every((accountId) => publicAccountIds.has(accountId))) return false;
          if (row.sourceInteractionId) {
            const interaction = sourceInteractionById.get(row.sourceInteractionId);
            if (!interaction || !publicAccountIds.has(interaction.actorAccountId)) return false;
            const target = sourcePostById.get(interaction.postId);
            return Boolean(target && publicAccountIds.has(target.authorAccountId));
          }
          // Older model-authored summaries had only a refresh-run reference,
          // so there is no way to invalidate them when their source post or
          // comment is deleted. Deterministic event digests supersede them.
          if (row.sourceRunId && !row.sourcePostId) return false;
          if (!row.sourcePostId) return true;
          const sourcePost = sourcePostById.get(row.sourcePostId);
          if (!sourcePost || !publicAccountIds.has(sourcePost.authorAccountId)) return false;
          // Digests created before source_interaction_id existed cannot be tied
          // safely to a still-live comment. Keep only the post's canonical digest;
          // stale legacy comment digests must never re-enter generation context.
          return parseRecord(sourcePost.metadata).activityDigestId === row.id;
        })
        .slice(0, limit)
        .map(mapDigest);
    },

    async createRefreshRun(input: { activeAccountIds: string[]; prompt: string }): Promise<NoodleRefreshRun> {
      const timestamp = now();
      const id = newId();
      await db.insert(noodleRefreshRuns).values({
        id,
        status: "running",
        activeAccountIds: JSON.stringify(input.activeAccountIds),
        prompt: input.prompt,
        result: null,
        error: null,
        attempts: "[]",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const rows = await db.select().from(noodleRefreshRuns).where(eq(noodleRefreshRuns.id, id));
      return mapRefreshRun(rows[0]!);
    },

    async listRefreshRuns(options: { limit?: number; status?: NoodleRefreshRun["status"] } = {}) {
      const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
      const baseQuery = db.select().from(noodleRefreshRuns);
      const rows = options.status
        ? await baseQuery
            .where(eq(noodleRefreshRuns.status, options.status))
            .orderBy(desc(noodleRefreshRuns.createdAt))
            .limit(limit)
        : await baseQuery.orderBy(desc(noodleRefreshRuns.createdAt)).limit(limit);
      return rows.map(mapRefreshRun);
    },

    async recordRefreshAttempt(id: string, attempt: NoodleRefreshAttempt): Promise<NoodleRefreshRun | null> {
      const rows = await db.select().from(noodleRefreshRuns).where(eq(noodleRefreshRuns.id, id));
      const current = rows[0];
      if (!current) return null;
      await db
        .update(noodleRefreshRuns)
        .set({
          attempts: JSON.stringify([...parseRefreshAttempts(current.attempts), attempt]),
          updatedAt: now(),
        })
        .where(eq(noodleRefreshRuns.id, id));
      const updatedRows = await db.select().from(noodleRefreshRuns).where(eq(noodleRefreshRuns.id, id));
      return updatedRows[0] ? mapRefreshRun(updatedRows[0]) : null;
    },

    async finishRefreshRun(
      id: string,
      patch: { status: "completed" | "failed"; result?: string | null; error?: string | null },
    ): Promise<NoodleRefreshRun | null> {
      await db
        .update(noodleRefreshRuns)
        .set({
          status: patch.status,
          result: patch.result ?? null,
          error: patch.error ?? null,
          updatedAt: now(),
        })
        .where(eq(noodleRefreshRuns.id, id));
      const rows = await db.select().from(noodleRefreshRuns).where(eq(noodleRefreshRuns.id, id));
      return rows[0] ? mapRefreshRun(rows[0]) : null;
    },

    async subscribe(subscriberAccountId: string, creatorAccountId: string): Promise<NoodleAccountSubscription | null> {
      if (subscriberAccountId === creatorAccountId) return null;
      const existing = await db
        .select()
        .from(noodleAccountSubscriptions)
        .where(
          and(
            eq(noodleAccountSubscriptions.subscriberAccountId, subscriberAccountId),
            eq(noodleAccountSubscriptions.creatorAccountId, creatorAccountId),
          ),
        );
      if (existing[0]) return mapSubscription(existing[0]);
      const id = newId();
      try {
        await db.insert(noodleAccountSubscriptions).values({
          id,
          subscriberAccountId,
          creatorAccountId,
          createdAt: now(),
        });
      } catch (error) {
        if (!isFileUniqueConstraintError(error)) throw error;
      }
      const rows = await db
        .select()
        .from(noodleAccountSubscriptions)
        .where(
          and(
            eq(noodleAccountSubscriptions.subscriberAccountId, subscriberAccountId),
            eq(noodleAccountSubscriptions.creatorAccountId, creatorAccountId),
          ),
        );
      return rows[0] ? mapSubscription(rows[0]) : null;
    },

    async unsubscribe(subscriberAccountId: string, creatorAccountId: string): Promise<void> {
      await db
        .delete(noodleAccountSubscriptions)
        .where(
          and(
            eq(noodleAccountSubscriptions.subscriberAccountId, subscriberAccountId),
            eq(noodleAccountSubscriptions.creatorAccountId, creatorAccountId),
          ),
        );
    },

    async isSubscribed(subscriberAccountId: string, creatorAccountId: string): Promise<boolean> {
      const rows = await db
        .select()
        .from(noodleAccountSubscriptions)
        .where(
          and(
            eq(noodleAccountSubscriptions.subscriberAccountId, subscriberAccountId),
            eq(noodleAccountSubscriptions.creatorAccountId, creatorAccountId),
          ),
        );
      return rows.length > 0;
    },

    async listSubscriptions(): Promise<NoodleAccountSubscription[]> {
      const rows = await db.select().from(noodleAccountSubscriptions);
      return rows.map(mapSubscription);
    },

    async listSubscriptionsForSubscriber(subscriberAccountId: string): Promise<NoodleAccountSubscription[]> {
      const rows = await db
        .select()
        .from(noodleAccountSubscriptions)
        .where(eq(noodleAccountSubscriptions.subscriberAccountId, subscriberAccountId));
      return rows.map(mapSubscription);
    },

    async unlockPost(accountId: string, postId: string): Promise<NoodlePostUnlock> {
      const existing = await db
        .select()
        .from(noodlePostUnlocks)
        .where(and(eq(noodlePostUnlocks.accountId, accountId), eq(noodlePostUnlocks.postId, postId)));
      if (existing[0]) return mapPostUnlock(existing[0]);
      const id = newId();
      try {
        await db.insert(noodlePostUnlocks).values({ id, accountId, postId, createdAt: now() });
      } catch (error) {
        if (!isFileUniqueConstraintError(error)) throw error;
      }
      const rows = await db
        .select()
        .from(noodlePostUnlocks)
        .where(and(eq(noodlePostUnlocks.accountId, accountId), eq(noodlePostUnlocks.postId, postId)));
      return mapPostUnlock(rows[0]!);
    },

    async listPostUnlocks(): Promise<NoodlePostUnlock[]> {
      const rows = await db.select().from(noodlePostUnlocks);
      return rows.map(mapPostUnlock);
    },

    async bootstrap(): Promise<NoodleBootstrap> {
      const settings = await this.getSettings();
      const includePrivate = settings.enableNoodler;
      const accounts = await this.listAccounts({ includePrivate });
      const visibleAccountIds = includePrivate ? null : new Set(accounts.map((account) => account.id));
      const [publicPosts, privatePosts] = await Promise.all([
        this.listSurfacePosts("public", { limit: 160 }),
        includePrivate ? this.listSurfacePosts("private", { limit: 160 }) : Promise.resolve([]),
      ]);
      const allPosts = [...publicPosts, ...privatePosts].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );
      const posts = visibleAccountIds
        ? allPosts.filter((post) => visibleAccountIds.has(post.authorAccountId))
        : allPosts;
      const scheduler = noodleRefreshSchedulerStatus(
        await this.ensureRefreshSchedule(new Date(), settings),
        new Date(),
      );
      const noodlerScheduler = noodleRefreshSchedulerStatus(
        await this.ensureNoodlerCreatorPostSchedule(new Date(), settings),
        new Date(),
      );
      const accountById = new Map(accounts.map((account) => [account.id, account]));
      const oldestLoadedPost = posts
        .filter((post) => {
          if (post.access !== "public") return false;
          const author = accountById.get(post.authorAccountId);
          return author?.visibility !== "private" || settings.noodler.showPublicPostsOnNoodle;
        })
        .at(-1);
      const hasOlderHistory = oldestLoadedPost
        ? (await this.listPostsBefore(oldestLoadedPost.createdAt)).some((post) => {
            if (post.access !== "public") return false;
            const author = accountById.get(post.authorAccountId);
            return author?.visibility !== "private" || settings.noodler.showPublicPostsOnNoodle;
          })
        : false;
      const allSubscriptions = await this.listSubscriptions();
      const allPostUnlocks = await this.listPostUnlocks();
      const subscriptions = visibleAccountIds
        ? allSubscriptions.filter(
            (sub) => visibleAccountIds.has(sub.subscriberAccountId) && visibleAccountIds.has(sub.creatorAccountId),
          )
        : allSubscriptions;
      const postUnlocks = visibleAccountIds
        ? allPostUnlocks.filter((unlock) => visibleAccountIds.has(unlock.accountId))
        : allPostUnlocks;
      return {
        settings,
        scheduler,
        noodlerScheduler,
        accounts,
        posts,
        interactions: await this.listInteractions(posts.map((post) => post.id)),
        digests: await this.listDigests({ limit: 80 }),
        subscriptions,
        postUnlocks,
        hasOlderHistory,
      };
    },
  };
}
