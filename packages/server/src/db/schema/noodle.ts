// ──────────────────────────────────────────────
// Schema: Noodle Fake Social Media
// ──────────────────────────────────────────────
import { fileTable, integer, real, text } from "../file-schema.js";

export const noodleAccounts = fileTable(
  "noodle_accounts",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarUrl: text("avatar_url"),
    invited: text("invited").notNull().default("false"),
    settings: text("settings").notNull().default("{}"),
    visibility: text("visibility").notNull().default("public"),
    linkedAccountId: text("linked_account_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  {
    uniqueBy: [{ keys: ["linkedAccountId"], when: (row) => row.linkedAccountId != null }],
  },
);

export const noodlePosts = fileTable("noodle_posts", {
  id: text("id").primaryKey(),
  authorAccountId: text("author_account_id").notNull(),
  content: text("content").notNull().default(""),
  imageUrl: text("image_url"),
  imagePrompt: text("image_prompt"),
  parentPostId: text("parent_post_id"),
  quotePostId: text("quote_post_id"),
  source: text("source").notNull().default("manual"),
  access: text("access").notNull().default("public"),
  metadata: text("metadata").notNull().default("{}"),
  authorSnapshot: text("author_snapshot").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const noodleAccountSubscriptions = fileTable(
  "noodle_account_subscriptions",
  {
    id: text("id").primaryKey(),
    subscriberAccountId: text("subscriber_account_id").notNull(),
    creatorAccountId: text("creator_account_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  {
    uniqueBy: [{ keys: ["subscriberAccountId", "creatorAccountId"] }],
  },
);

export const noodlePostUnlocks = fileTable(
  "noodle_post_unlocks",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    postId: text("post_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  {
    uniqueBy: [{ keys: ["accountId", "postId"] }],
  },
);

export const noodleInteractions = fileTable(
  "noodle_interactions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull(),
    parentInteractionId: text("parent_interaction_id"),
    actorAccountId: text("actor_account_id").notNull(),
    type: text("type").notNull(),
    content: text("content"),
    imageUrl: text("image_url"),
    actorSnapshot: text("actor_snapshot").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  {
    uniqueBy: [
      {
        keys: ["postId", "actorAccountId", "type", "parentInteractionId"],
        when: (row) => row.type === "like" || row.type === "repost",
      },
    ],
  },
);

export const noodleActivityDigests = fileTable("noodle_activity_digests", {
  id: text("id").primaryKey(),
  accountIds: text("account_ids").notNull().default("[]"),
  content: text("content").notNull().default(""),
  sourceRunId: text("source_run_id"),
  sourcePostId: text("source_post_id"),
  sourceInteractionId: text("source_interaction_id"),
  createdAt: text("created_at").notNull(),
});

export const noodleRefreshRuns = fileTable("noodle_refresh_runs", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  activeAccountIds: text("active_account_ids").notNull().default("[]"),
  prompt: text("prompt").notNull().default(""),
  result: text("result"),
  error: text("error"),
  attempts: text("attempts").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const noodleFillerProfiles = fileTable("noodle_filler_profiles", {
  id: text("id").primaryKey(),
  entityId: text("entity_id").notNull(),
  displayName: text("display_name").notNull(),
  bio: text("bio").notNull().default(""),
  enabled: text("enabled").notNull().default("true"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const noodlerCreatorProjects = fileTable("noodler_creator_projects", {
  id: text("id").primaryKey(),
  creatorAccountId: text("creator_account_id").notNull(),
  title: text("title").notNull(),
  brief: text("brief").notNull().default(""),
  toneGuidance: text("tone_guidance").notNull().default(""),
  influence: text("influence").notNull().default("balanced"),
  status: text("status").notNull().default("draft"),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  minimumSpacingHours: integer("minimum_spacing_hours"),
  lastGeneratedAt: text("last_generated_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const noodlerProjectMilestones = fileTable("noodler_project_milestones", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  position: integer("position").notNull(),
  status: text("status").notNull().default("planned"),
  notBefore: text("not_before"),
  dueAt: text("due_at"),
  access: text("access").notNull().default("subscriber"),
  ppvPrice: real("ppv_price"),
  mediaPreference: text("media_preference").notNull().default("model_choice"),
  generatedPostId: text("generated_post_id"),
  completionSummary: text("completion_summary").notNull().default(""),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
