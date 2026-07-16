// ──────────────────────────────────────────────
// Noodle Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";

export const noodleAccountKindSchema = z.enum(["persona", "character", "random_user"]);
export const noodleInteractionTypeSchema = z.enum(["like", "repost", "reply", "vote"]);
export const noodlePostAccessSchema = z.enum(["public", "subscriber", "ppv"]);
export const noodleParticipantSelectionModeSchema = z.enum(["all", "random_range", "exact"]);
export const noodleCarryoverModeSchema = z.enum(["off", "conversation", "roleplay", "game", "all"]);
export const noodleCarryoverTargetSchema = z.enum(["conversation", "roleplay", "game"]);
export const noodleThemeSchema = z.enum(["system", "light", "dark"]);
export const noodleLayoutSchema = z.enum(["timeline", "grid"]);
export const noodlerProjectStatusSchema = z.enum(["draft", "active", "paused", "completed", "archived"]);
export const noodlerProjectInfluenceSchema = z.enum(["loose", "balanced", "focused"]);
export const noodlerMilestoneStatusSchema = z.enum(["planned", "ready", "completed", "skipped"]);
export const noodlerProjectMediaPreferenceSchema = z.enum(["text", "image", "text_and_image", "model_choice"]);

export const DEFAULT_NOODLE_SETTINGS = {
  refreshesPerDay: 2,
  participantSelectionMode: "random_range",
  participantMin: 2,
  participantMax: 5,
  maxGeneratedPostsPerRefresh: 8,
  maxRepliesPerRefresh: 12,
  maxRepostsPerRefresh: 4,
  maxLikesPerRefresh: 18,
  maxImagesPerRefresh: 3,
  enableImagePrompts: false,
  imageGenerationConnectionId: null,
  imageGenerationPrompt:
    "Create either a social-media-ready character image or an in-character meme for the post. For character images, mention build, clothing, visible appearance, pose, expression, setting, lighting, mood, and composition. For memes, mention meme format, visual gag, composition, and short readable caption/text when relevant.",
  imageGenerationUseAvatarReferences: true,
  imageGenerationIncludeDescriptions: true,
  allowGalleryImageAttachments: false,
  imageCaptioningEnabled: false,
  imageCaptioningConnectionId: null,
  enableLorebookContext: false,
  enableEnhancedTimelineWriting: false,
  allowProfessorMari: true,
  allowRandomUsers: false,
  invitedCharacterGroupIds: [],
  carryoverMode: "off",
  carryoverModes: [],
  carryoverHours: 48,
  carryoverMaxItems: 8,
  theme: "system",
  generationConnectionId: null,
  layout: "timeline",
  enableNoodler: false,
  allowGlobalPersona: false,
  noodler: {
    enableFanActivityScheduler: false,
    creatorPosts: {
      enabled: false,
      postsPerDay: 0,
      generationConnectionId: null,
    },
  },
} as const;

export const noodlerCreatorPostsSettingsSchema = z.object({
  enabled: z.boolean().default(DEFAULT_NOODLE_SETTINGS.noodler.creatorPosts.enabled),
  postsPerDay: z.number().int().min(0).max(24).default(DEFAULT_NOODLE_SETTINGS.noodler.creatorPosts.postsPerDay),
  generationConnectionId: z
    .string()
    .min(1)
    .nullable()
    .default(DEFAULT_NOODLE_SETTINGS.noodler.creatorPosts.generationConnectionId),
});

export const noodlerSettingsSchema = z.object({
  enableFanActivityScheduler: z.boolean().default(DEFAULT_NOODLE_SETTINGS.noodler.enableFanActivityScheduler),
  creatorPosts: noodlerCreatorPostsSettingsSchema.default(() => ({ ...DEFAULT_NOODLE_SETTINGS.noodler.creatorPosts })),
});

export const noodleSettingsSchema = z.object({
  refreshesPerDay: z.number().int().min(0).max(24).default(DEFAULT_NOODLE_SETTINGS.refreshesPerDay),
  participantSelectionMode: noodleParticipantSelectionModeSchema.default(
    DEFAULT_NOODLE_SETTINGS.participantSelectionMode,
  ),
  participantMin: z.number().int().min(1).max(100).default(DEFAULT_NOODLE_SETTINGS.participantMin),
  participantMax: z.number().int().min(1).max(100).default(DEFAULT_NOODLE_SETTINGS.participantMax),
  maxGeneratedPostsPerRefresh: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(DEFAULT_NOODLE_SETTINGS.maxGeneratedPostsPerRefresh),
  maxRepliesPerRefresh: z.number().int().min(0).max(200).default(DEFAULT_NOODLE_SETTINGS.maxRepliesPerRefresh),
  maxRepostsPerRefresh: z.number().int().min(0).max(100).default(DEFAULT_NOODLE_SETTINGS.maxRepostsPerRefresh),
  maxLikesPerRefresh: z.number().int().min(0).max(500).default(DEFAULT_NOODLE_SETTINGS.maxLikesPerRefresh),
  maxImagesPerRefresh: z.number().int().min(0).max(50).default(DEFAULT_NOODLE_SETTINGS.maxImagesPerRefresh),
  enableImagePrompts: z.boolean().default(DEFAULT_NOODLE_SETTINGS.enableImagePrompts),
  imageGenerationConnectionId: z
    .string()
    .min(1)
    .nullable()
    .default(DEFAULT_NOODLE_SETTINGS.imageGenerationConnectionId),
  imageGenerationPrompt: z.string().max(4000).default(DEFAULT_NOODLE_SETTINGS.imageGenerationPrompt),
  imageGenerationUseAvatarReferences: z.boolean().default(DEFAULT_NOODLE_SETTINGS.imageGenerationUseAvatarReferences),
  imageGenerationIncludeDescriptions: z.boolean().default(DEFAULT_NOODLE_SETTINGS.imageGenerationIncludeDescriptions),
  allowGalleryImageAttachments: z.boolean().default(DEFAULT_NOODLE_SETTINGS.allowGalleryImageAttachments),
  imageCaptioningEnabled: z.boolean().default(DEFAULT_NOODLE_SETTINGS.imageCaptioningEnabled),
  imageCaptioningConnectionId: z
    .string()
    .min(1)
    .nullable()
    .default(DEFAULT_NOODLE_SETTINGS.imageCaptioningConnectionId),
  enableLorebookContext: z.boolean().default(DEFAULT_NOODLE_SETTINGS.enableLorebookContext),
  enableEnhancedTimelineWriting: z.boolean().default(DEFAULT_NOODLE_SETTINGS.enableEnhancedTimelineWriting),
  allowProfessorMari: z.boolean().default(DEFAULT_NOODLE_SETTINGS.allowProfessorMari),
  allowRandomUsers: z.boolean().default(DEFAULT_NOODLE_SETTINGS.allowRandomUsers),
  invitedCharacterGroupIds: z
    .array(z.string().min(1))
    .default(() => [...DEFAULT_NOODLE_SETTINGS.invitedCharacterGroupIds]),
  carryoverMode: noodleCarryoverModeSchema.default(DEFAULT_NOODLE_SETTINGS.carryoverMode),
  carryoverModes: z.array(noodleCarryoverTargetSchema).default(() => [...DEFAULT_NOODLE_SETTINGS.carryoverModes]),
  carryoverHours: z.number().int().min(1).max(720).default(DEFAULT_NOODLE_SETTINGS.carryoverHours),
  carryoverMaxItems: z.number().int().min(1).max(50).default(DEFAULT_NOODLE_SETTINGS.carryoverMaxItems),
  theme: noodleThemeSchema.default(DEFAULT_NOODLE_SETTINGS.theme),
  generationConnectionId: z.string().min(1).nullable().default(DEFAULT_NOODLE_SETTINGS.generationConnectionId),
  layout: noodleLayoutSchema.default(DEFAULT_NOODLE_SETTINGS.layout),
  enableNoodler: z.boolean().default(DEFAULT_NOODLE_SETTINGS.enableNoodler),
  allowGlobalPersona: z.boolean().default(DEFAULT_NOODLE_SETTINGS.allowGlobalPersona),
  noodler: noodlerSettingsSchema.default(() => ({ ...DEFAULT_NOODLE_SETTINGS.noodler })),
});

export const noodleSettingsUpdateSchema = noodleSettingsSchema.partial().extend({
  noodler: noodlerSettingsSchema
    .partial()
    .extend({ creatorPosts: noodlerCreatorPostsSettingsSchema.partial().optional() })
    .optional(),
});

export const noodleAccountUpdateSchema = z.object({
  handle: z
    .string()
    .trim()
    .min(1, "Enter a Noodle handle.")
    .max(40, "Handle must contain at most 40 characters.")
    .optional(),
  displayName: z.string().min(1).max(120).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().max(2000).nullable().optional(),
  invited: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const noodleFillerProfileCreateSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name.").max(120),
  bio: z.string().trim().max(500).optional().default(""),
  enabled: z.boolean().optional().default(true),
});

export const noodleFillerProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  bio: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
});

export const noodleInviteSchema = z.object({
  characterId: z.string().min(1),
});

export const noodleBulkInviteSchema = z.object({
  characterIds: z.array(z.string().min(1)).min(1).max(5000),
});

export const noodlePollInputSchema = z
  .object({
    question: z.string().trim().min(1).max(240),
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
  })
  .superRefine((poll, ctx) => {
    const normalized = poll.options.map((option) => option.toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Poll options must be unique.",
      });
    }
  });

export const noodlePollSchema = z.object({
  question: z.string().trim().min(1).max(240),
  options: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().trim().min(1).max(120),
      }),
    )
    .min(2)
    .max(4),
});

export const noodlePostTargetSchema = z.enum(["noodle", "noodler"]);

export const noodleCreatePostSchema = z.object({
  authorKind: noodleAccountKindSchema,
  authorEntityId: z.string().min(1),
  // Overrides authorKind/authorEntityId resolution — needed to post as a private
  // (NoodleR) account, which shares kind+entityId with its linked public account.
  authorAccountId: z.string().min(1).optional(),
  // Convenience alternative to authorAccountId for callers (slash commands, the
  // in-character roleplay post action) that only know "post publicly" vs "post to
  // my NoodleR" and don't have the private account id on hand — resolved server-side
  // via the public account's linkedAccountId. Ignored if authorAccountId is set.
  target: noodlePostTargetSchema.optional(),
  content: z.string().min(1).max(4000),
  imageUrl: z.string().max(2000).nullable().optional(),
  imagePrompt: z.string().max(2000).nullable().optional(),
  parentPostId: z.string().min(1).nullable().optional(),
  quotePostId: z.string().min(1).nullable().optional(),
  poll: noodlePollInputSchema.nullable().optional(),
  access: noodlePostAccessSchema.optional(),
  // Simulated pay-per-view price shown on the locked-post overlay for
  // access="ppv" posts. Display-only flavor for the NoodleR creator-platform
  // framing — no real payment is processed.
  ppvPrice: z.number().min(0).max(999_999).optional(),
});

export const noodlePostUpdateSchema = z.object({
  content: z.string().trim().min(1).max(4000).optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
  imagePrompt: z.string().max(2000).nullable().optional(),
});

export const noodleCreateInteractionSchema = z
  .object({
    actorKind: noodleAccountKindSchema,
    actorEntityId: z.string().min(1),
    type: noodleInteractionTypeSchema,
    content: z.string().max(2000).nullable().optional(),
    imageUrl: z.string().max(2000).nullable().optional(),
    parentInteractionId: z.string().min(1).nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.type === "reply" && !input.content?.trim() && !input.imageUrl?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Replies need text or an image.",
      });
    }
    if (input.type === "repost" && input.parentInteractionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentInteractionId"],
        message: "Reposts cannot target a reply.",
      });
    }
    if (input.type === "vote" && (!input.content?.trim() || input.parentInteractionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Poll votes require an option and cannot target a reply.",
      });
    }
    if (input.type !== "reply" && input.imageUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageUrl"],
        message: "Only replies can include an image.",
      });
    }
  });

export const noodleRemoveInteractionSchema = z
  .object({
    actorKind: noodleAccountKindSchema,
    actorEntityId: z.string().min(1),
    type: z.enum(["like", "repost"]),
    parentInteractionId: z.string().min(1).nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.type === "repost" && input.parentInteractionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentInteractionId"],
        message: "Reposts cannot target a reply.",
      });
    }
  });

export const noodleInteractionOwnerSchema = z.object({
  personaId: z.string().min(1),
});

export const noodleSubscribeSchema = z.object({
  subscriberKind: noodleAccountKindSchema,
  subscriberEntityId: z.string().min(1),
});

export const noodleUnlockPostSchema = z.object({
  actorKind: noodleAccountKindSchema,
  actorEntityId: z.string().min(1),
});

export const noodlePrivateIdentityDisclosureSchema = z.enum(["open", "hinted", "secret"]);

export const noodlePostingModeSchema = z.enum(["active", "passive"]);

export const noodlePrivateStageProfileSchema = z.object({
  identityDisclosure: noodlePrivateIdentityDisclosureSchema.default("hinted"),
  stageName: z.string().trim().min(1).max(80),
  stageBio: z.string().trim().max(500).default(""),
  stagePersonality: z.string().trim().max(1000).default(""),
  stageDynamic: z.string().trim().max(500).default(""),
  stageAppearanceOverride: z.string().trim().max(500).default(""),
  preserveLinkedAppearance: z.boolean().default(true),
  postingMode: noodlePostingModeSchema.default("active"),
});

export const noodlePrivateAccountCreateSchema = z.object({
  stageProfile: noodlePrivateStageProfileSchema.partial().optional(),
});

export const noodlerProjectCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  brief: z.string().trim().max(4000).default(""),
  toneGuidance: z.string().trim().max(2000).default(""),
  influence: noodlerProjectInfluenceSchema.default("balanced"),
  status: noodlerProjectStatusSchema.default("draft"),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
  minimumSpacingHours: z.number().int().min(0).max(720).nullable().default(null),
});

export const noodlerProjectUpdateSchema = noodlerProjectCreateSchema.partial();

export const noodlerMilestoneCreateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(2000).default(""),
  status: noodlerMilestoneStatusSchema.default("planned"),
  notBefore: z.string().datetime().nullable().default(null),
  dueAt: z.string().datetime().nullable().default(null),
  access: noodlePostAccessSchema.default("subscriber"),
  ppvPrice: z.number().min(0).max(999_999).nullable().default(null),
  mediaPreference: noodlerProjectMediaPreferenceSchema.default("model_choice"),
});

export const noodlerMilestoneUpdateSchema = noodlerMilestoneCreateSchema.partial();

export const noodleFanActivityIntensitySchema = z.enum(["low", "medium", "high"]);

export const noodleFanActivitySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  intensity: noodleFanActivityIntensitySchema.default("low"),
  autoSchedule: z.boolean().default(false),
  nextRunAt: z.string().nullable().default(null),
});

// Unattended generation of new NoodleR posts, distinct from fan activity
// (which only reacts to posts that already exist). Off by default; reuses
// the same intensity dial semantics (runs/day), but tracks its own
// nextRunAt so toggling one scheduler never perturbs the other's cadence.
export const noodleAutoPostSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  intensity: noodleFanActivityIntensitySchema.default("low"),
  nextRunAt: z.string().nullable().default(null),
});

// "People this character knows" — other Noodle account ids. Used to bias
// (never restrict) which accounts a character's posts/replies interact
// with, on both public and private accounts.
export const noodleSocialSettingsSchema = z.object({
  knownAccountIds: z.array(z.string()).default([]),
});

// Private (NoodleR) accounts only. Independent of the linked public
// account's social list, so one persona's NoodleR page can hide from an
// account while another linked page doesn't.
export const noodleHiddenFromSettingsSchema = z.object({
  hiddenFromAccountIds: z.array(z.string()).default([]),
});

export const noodleInteractionUpdateSchema = noodleInteractionOwnerSchema
  .extend({
    content: z.string().max(2000).nullable().optional(),
    imageUrl: z.string().max(2000).nullable().optional(),
  })
  .refine((input) => input.content !== undefined || input.imageUrl !== undefined, {
    message: "Provide comment text or an image update.",
  });

export const noodleRefreshSchema = z.object({
  personaId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
  debugMode: z.boolean().optional(),
  reviewImagePromptsBeforeSend: z.boolean().optional(),
  // Manual, single-account refresh for a NoodleR (private) account, which is
  // otherwise excluded from the normal automatic participant selection.
  targetAccountId: z.string().min(1).optional(),
  privatePostGuide: z
    .object({
      access: noodlePostAccessSchema.optional(),
      ppvPrice: z.number().min(0).max(999_999).optional(),
      includeText: z.boolean().optional(),
      includeImage: z.boolean().optional(),
      requireImage: z.boolean().optional(),
      theme: z.string().trim().max(120).optional(),
      prompt: z.string().trim().max(1000).optional(),
    })
    .refine((guide) => guide.includeText !== false || guide.includeImage !== false, {
      message: "Enable text, image, or both for a guided NoodleR post.",
    })
    .optional(),
  privateProjectWork: z
    .object({ projectId: z.string().min(1), milestoneId: z.string().min(1) })
    .optional(),
});

export const noodleRescheduleRefreshSchema = z.object({
  scheduledTime: z.string().datetime(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "Use a 24-hour time in HH:mm format."),
});

export const noodleGeneratedPostSchema = z.object({
  tempId: z.string().min(1).optional(),
  authorHandle: z.string().min(1),
  content: z.string().min(1).max(4000),
  imagePrompt: z.string().max(2000).nullable().optional(),
  attachGalleryImage: z.boolean().optional().default(false),
  poll: noodlePollInputSchema.nullable().optional(),
});

export const noodleGeneratedInteractionSchema = z
  .object({
    actorHandle: z.string().min(1),
    targetTempId: z
      .string()
      .min(1)
      .nullish()
      .transform((value) => value ?? undefined),
    targetPostId: z
      .string()
      .min(1)
      .nullish()
      .transform((value) => value ?? undefined),
    parentInteractionId: z
      .string()
      .min(1)
      .nullish()
      .transform((value) => value ?? undefined),
    type: noodleInteractionTypeSchema,
    content: z.string().max(2000).nullable().optional(),
    pollOptionIndex: z
      .number()
      .int()
      .min(0)
      .max(3)
      .nullish()
      .transform((value) => value ?? undefined),
  })
  .superRefine((interaction, ctx) => {
    if (interaction.type === "vote" && interaction.pollOptionIndex === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pollOptionIndex"],
        message: "Poll votes require a poll option index.",
      });
    }
    if (interaction.type !== "reply" && interaction.parentInteractionId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentInteractionId"],
        message: "Only replies can target an existing comment.",
      });
    }
  });

export const noodleGeneratedFollowSchema = z.object({
  actorHandle: z.string().min(1),
  targetHandle: z.string().min(1),
});

export const noodleGeneratedDigestSchema = z.object({
  accountEntityIds: z.array(z.string().min(1)).default([]),
  content: z.string().min(1).max(1200),
});

function boundedGeneratedProfileText(maxLength: number, minimumLength = 0) {
  return z
    .string()
    .transform((value) => {
      if (value.length <= maxLength) return value;
      const truncated = value.slice(0, maxLength);
      // Avoid leaving a dangling UTF-16 high surrogate when truncating emoji.
      return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
    })
    .pipe(z.string().min(minimumLength).max(maxLength));
}

export const noodleGeneratedProfileSchema = z.object({
  entityId: z.string().min(1),
  name: boundedGeneratedProfileText(120, 1),
  handle: boundedGeneratedProfileText(40, 1),
  bio: boundedGeneratedProfileText(500).default(""),
  location: boundedGeneratedProfileText(120).default(""),
});

export const noodleGeneratedRefreshSchema = z.object({
  posts: z.array(noodleGeneratedPostSchema).default([]),
  interactions: z.array(noodleGeneratedInteractionSchema).default([]),
  follows: z.array(noodleGeneratedFollowSchema).default([]),
  digests: z.array(noodleGeneratedDigestSchema).default([]),
});

export const noodleGeneratedProfilesSchema = z.object({
  profiles: z.array(noodleGeneratedProfileSchema).default([]),
});

export type NoodleSettingsInput = z.infer<typeof noodleSettingsSchema>;
export type NoodleSettingsUpdateInput = z.infer<typeof noodleSettingsUpdateSchema>;
export type NoodleAccountUpdateInput = z.infer<typeof noodleAccountUpdateSchema>;
export type NoodleFillerProfileCreateInput = z.infer<typeof noodleFillerProfileCreateSchema>;
export type NoodleFillerProfileUpdateInput = z.infer<typeof noodleFillerProfileUpdateSchema>;
export type NoodleInviteInput = z.infer<typeof noodleInviteSchema>;
export type NoodleBulkInviteInput = z.infer<typeof noodleBulkInviteSchema>;
export type NoodlePollInput = z.infer<typeof noodlePollInputSchema>;
export type NoodlePollData = z.infer<typeof noodlePollSchema>;
export type NoodleCreatePostInput = z.infer<typeof noodleCreatePostSchema>;
export type NoodlePostUpdateInput = z.infer<typeof noodlePostUpdateSchema>;
export type NoodleSubscribeInput = z.infer<typeof noodleSubscribeSchema>;
export type NoodleUnlockPostInput = z.infer<typeof noodleUnlockPostSchema>;
export type NoodlePrivateIdentityDisclosure = z.infer<typeof noodlePrivateIdentityDisclosureSchema>;
export type NoodlePostingMode = z.infer<typeof noodlePostingModeSchema>;
export type NoodlePrivateStageProfileInput = z.input<typeof noodlePrivateStageProfileSchema>;
export type NoodlePrivateStageProfile = z.infer<typeof noodlePrivateStageProfileSchema>;
export type NoodlePrivateAccountCreateInput = z.infer<typeof noodlePrivateAccountCreateSchema>;
export type NoodlerProjectCreateInput = z.infer<typeof noodlerProjectCreateSchema>;
export type NoodlerProjectUpdateInput = z.infer<typeof noodlerProjectUpdateSchema>;
export type NoodlerMilestoneCreateInput = z.infer<typeof noodlerMilestoneCreateSchema>;
export type NoodlerMilestoneUpdateInput = z.infer<typeof noodlerMilestoneUpdateSchema>;
export type NoodleCreateInteractionInput = z.infer<typeof noodleCreateInteractionSchema>;
export type NoodleRemoveInteractionInput = z.infer<typeof noodleRemoveInteractionSchema>;
export type NoodleInteractionOwnerInput = z.infer<typeof noodleInteractionOwnerSchema>;
export type NoodleInteractionUpdateInput = z.infer<typeof noodleInteractionUpdateSchema>;
export type NoodleRefreshInput = z.infer<typeof noodleRefreshSchema>;
export type NoodleRescheduleRefreshInput = z.infer<typeof noodleRescheduleRefreshSchema>;
export type NoodleGeneratedRefresh = z.infer<typeof noodleGeneratedRefreshSchema>;
export type NoodleGeneratedProfiles = z.infer<typeof noodleGeneratedProfilesSchema>;
export type NoodleGeneratedProfile = z.infer<typeof noodleGeneratedProfileSchema>;
