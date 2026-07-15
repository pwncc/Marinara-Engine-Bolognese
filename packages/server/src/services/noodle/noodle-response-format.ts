import { isOpenAIGpt56Model } from "@marinara-engine/shared";

export const NOODLE_JSON_OUTPUT_HEADING = "# JSON Output Format";

const nullableString = { type: ["string", "null"] } as const;
const nullableInteger = { type: ["integer", "null"] } as const;

const pollSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
  ],
} as const;

const timelineSchema = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tempId: { type: "string" },
          authorHandle: { type: "string" },
          content: { type: "string" },
          imagePrompt: nullableString,
          attachGalleryImage: { type: "boolean" },
          poll: pollSchema,
        },
        required: ["tempId", "authorHandle", "content", "imagePrompt", "attachGalleryImage", "poll"],
        additionalProperties: false,
      },
    },
    interactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          actorHandle: { type: "string" },
          targetTempId: nullableString,
          targetPostId: nullableString,
          parentInteractionId: nullableString,
          type: { type: "string", enum: ["like", "repost", "reply", "vote"] },
          content: nullableString,
          pollOptionIndex: nullableInteger,
        },
        required: [
          "actorHandle",
          "targetTempId",
          "targetPostId",
          "parentInteractionId",
          "type",
          "content",
          "pollOptionIndex",
        ],
        additionalProperties: false,
      },
    },
    follows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          actorHandle: { type: "string" },
          targetHandle: { type: "string" },
        },
        required: ["actorHandle", "targetHandle"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts", "interactions", "follows"],
  additionalProperties: false,
} as const;

const profilesSchema = {
  type: "object",
  properties: {
    profiles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entityId: { type: "string" },
          name: { type: "string" },
          handle: { type: "string" },
          bio: { type: "string" },
          location: { type: "string" },
        },
        required: ["entityId", "name", "handle", "bio", "location"],
        additionalProperties: false,
      },
    },
  },
  required: ["profiles"],
  additionalProperties: false,
} as const;

const privateIdentitySchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    handle: { type: "string" },
    bio: { type: "string" },
    appearance: { type: "string" },
    personality: { type: "string" },
    dynamic: { type: "string" },
  },
  required: ["name", "handle", "bio", "appearance", "personality", "dynamic"],
  additionalProperties: false,
} as const;

const fanActivitySchema = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          actorHandle: { type: "string" },
          postId: nullableString,
          type: { type: "string", enum: ["like", "comment", "subscribe", "unlock"] },
          content: nullableString,
        },
        required: ["actorHandle", "postId", "type", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["actions"],
  additionalProperties: false,
} as const;

export function noodleResponseFormat(
  model: string,
  kind: "timeline" | "profiles" | "private_identity" | "fan_activity",
): { type: string; [key: string]: unknown } {
  if (!isOpenAIGpt56Model(model)) return { type: "json_object" };
  const schemaByKind = {
    timeline: timelineSchema,
    profiles: profilesSchema,
    private_identity: privateIdentitySchema,
    fan_activity: fanActivitySchema,
  };
  return {
    type: "json_schema",
    name:
      kind === "timeline"
        ? "noodle_timeline"
        : kind === "profiles"
          ? "noodle_profiles"
          : kind === "private_identity"
            ? "noodle_private_identity"
            : "noodle_fan_activity",
    schema: schemaByKind[kind],
    strict: true,
  };
}
