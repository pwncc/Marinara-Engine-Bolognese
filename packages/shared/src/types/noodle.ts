// ──────────────────────────────────────────────
// Noodle Fake Social Media Types
// ──────────────────────────────────────────────
import type { LegacyPersonaAvatarCrop, PersonaAvatarCrop } from "./persona.js";

export type NoodleAccountKind = "persona" | "character" | "random_user";
export type NoodleAccountVisibility = "public" | "private";
export type NoodleSurface = NoodleAccountVisibility;
export type NoodleInteractionType = "like" | "repost" | "reply" | "vote";
export type NoodlePostSource = "manual" | "generated";
export type NoodlePostAccess = "public" | "subscriber" | "ppv";
export type NoodleTheme = "system" | "light" | "dark";
export type NoodleLayout = "timeline" | "grid";
export type NoodleCarryoverMode = "off" | "conversation" | "roleplay" | "game" | "all";
export type NoodleCarryoverTarget = "conversation" | "roleplay" | "game";
export type NoodleParticipantSelectionMode = "all" | "random_range" | "exact";
export type NoodleAvatarCrop = PersonaAvatarCrop | LegacyPersonaAvatarCrop;
export type NoodleFanActivityIntensity = "low" | "medium" | "high";
export type NoodlerProjectStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type NoodlerProjectInfluence = "loose" | "balanced" | "focused";
export type NoodlerMilestoneStatus = "planned" | "ready" | "completed" | "skipped";
export type NoodlerProjectMediaPreference = "text" | "image" | "text_and_image" | "model_choice";

export interface NoodleFanActivitySettings {
  enabled: boolean;
  intensity: NoodleFanActivityIntensity;
  autoSchedule: boolean;
  // ISO timestamp for the scheduler's next unattended run on this account.
  // Only meaningful while enabled + autoSchedule are both true.
  nextRunAt: string | null;
}

export interface NoodleAutoPostSettings {
  enabled: boolean;
  intensity: NoodleFanActivityIntensity;
  // ISO timestamp for the scheduler's next unattended post generation.
  // Only meaningful while enabled is true.
  nextRunAt: string | null;
}

export interface NoodleSocialSettings {
  knownAccountIds: string[];
}

export interface NoodleHiddenFromSettings {
  hiddenFromAccountIds: string[];
}

export interface NoodlerSettings {
  // Global kill switch for the NoodleR fan-activity scheduler. Off by default;
  // even accounts with fanActivity.autoSchedule on stay dormant until this is on.
  enableFanActivityScheduler: boolean;
  creatorPosts: {
    enabled: boolean;
    postsPerDay: number;
    generationConnectionId: string | null;
  };
}

export interface NoodlePollOption {
  id: string;
  label: string;
}

export interface NoodlePoll {
  question: string;
  options: NoodlePollOption[];
}

export interface NoodleSettings {
  refreshesPerDay: number;
  participantSelectionMode: NoodleParticipantSelectionMode;
  participantMin: number;
  participantMax: number;
  maxGeneratedPostsPerRefresh: number;
  maxRepliesPerRefresh: number;
  maxRepostsPerRefresh: number;
  maxLikesPerRefresh: number;
  maxImagesPerRefresh: number;
  enableImagePrompts: boolean;
  imageGenerationConnectionId: string | null;
  imageGenerationPrompt: string;
  imageGenerationUseAvatarReferences: boolean;
  imageGenerationIncludeDescriptions: boolean;
  allowGalleryImageAttachments: boolean;
  imageCaptioningEnabled: boolean;
  imageCaptioningConnectionId: string | null;
  enableLorebookContext: boolean;
  enableEnhancedTimelineWriting: boolean;
  allowProfessorMari: boolean;
  allowRandomUsers: boolean;
  invitedCharacterGroupIds: string[];
  carryoverMode: NoodleCarryoverMode;
  carryoverModes: NoodleCarryoverTarget[];
  carryoverHours: number;
  carryoverMaxItems: number;
  theme: NoodleTheme;
  generationConnectionId: string | null;
  layout: NoodleLayout;
  enableNoodler: boolean;
  allowGlobalPersona: boolean;
  noodler: NoodlerSettings;
}

export interface NoodleAccount {
  id: string;
  kind: NoodleAccountKind;
  entityId: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  avatarCrop: NoodleAvatarCrop | null;
  invited: boolean;
  settings: Record<string, unknown>;
  visibility: NoodleAccountVisibility;
  linkedAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoodleAuthorSnapshot {
  id: string;
  kind: NoodleAccountKind;
  entityId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  avatarCrop: NoodleAvatarCrop | null;
}

export interface NoodlePost {
  id: string;
  authorAccountId: string;
  content: string;
  imageUrl: string | null;
  imagePrompt: string | null;
  parentPostId: string | null;
  quotePostId: string | null;
  source: NoodlePostSource;
  access: NoodlePostAccess;
  metadata: Record<string, unknown>;
  authorSnapshot: NoodleAuthorSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoodleAccountSubscription {
  id: string;
  subscriberAccountId: string;
  creatorAccountId: string;
  createdAt: string;
}

export interface NoodlePostUnlock {
  id: string;
  accountId: string;
  postId: string;
  createdAt: string;
}

export interface NoodlerCreatorProject {
  id: string;
  creatorAccountId: string;
  title: string;
  brief: string;
  toneGuidance: string;
  influence: NoodlerProjectInfluence;
  status: NoodlerProjectStatus;
  startsAt: string | null;
  endsAt: string | null;
  minimumSpacingHours: number | null;
  lastGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoodlerProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  notes: string;
  position: number;
  status: NoodlerMilestoneStatus;
  notBefore: string | null;
  dueAt: string | null;
  access: NoodlePostAccess;
  ppvPrice: number | null;
  mediaPreference: NoodlerProjectMediaPreference;
  generatedPostId: string | null;
  completionSummary: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoodlerCreatorProjectDetail {
  project: NoodlerCreatorProject;
  milestones: NoodlerProjectMilestone[];
}

export interface NoodleInteraction {
  id: string;
  postId: string;
  parentInteractionId: string | null;
  actorAccountId: string;
  type: NoodleInteractionType;
  content: string | null;
  imageUrl: string | null;
  actorSnapshot: NoodleAuthorSnapshot | null;
  createdAt: string;
}

export interface NoodleDigestEntry {
  id: string;
  accountIds: string[];
  content: string;
  sourceRunId: string | null;
  sourcePostId: string | null;
  sourceInteractionId: string | null;
  createdAt: string;
}

export type NoodleRefreshAttemptKind = "initial" | "text_only_fallback" | "correction";

export interface NoodleRefreshAttempt {
  sequence: number;
  kind: NoodleRefreshAttemptKind;
  response: string;
  rejectionReason: string | null;
  createdAt: string;
}

export interface NoodleRefreshRun {
  id: string;
  status: "running" | "completed" | "failed";
  activeAccountIds: string[];
  prompt: string;
  result: string | null;
  error: string | null;
  attempts: NoodleRefreshAttempt[];
  createdAt: string;
  updatedAt: string;
}

export type NoodleRefreshSchedulerState = "disabled" | "scheduled" | "due" | "retrying" | "completed";

export interface NoodleRefreshSchedulerStatus {
  state: NoodleRefreshSchedulerState;
  scheduleDate: string;
  timezone: string;
  refreshesPerDay: number;
  scheduledTimes: string[];
  completedTimes: string[];
  completedSlots: number;
  successfulRefreshes: number;
  skippedSlots: number;
  nextRefreshAt: string | null;
  nextAttemptAt: string | null;
  lastAutomaticRefreshAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export interface NoodleBootstrap {
  settings: NoodleSettings;
  scheduler: NoodleRefreshSchedulerStatus;
  noodlerScheduler: NoodleRefreshSchedulerStatus;
  accounts: NoodleAccount[];
  posts: NoodlePost[];
  interactions: NoodleInteraction[];
  digests: NoodleDigestEntry[];
  subscriptions: NoodleAccountSubscription[];
  postUnlocks: NoodlePostUnlock[];
  hasOlderHistory: boolean;
}

export interface NoodleFillerProfile {
  id: string;
  entityId: string;
  displayName: string;
  bio: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
