import { describe, expect, it } from "vitest";
import type { StorageGateway } from "../capabilities/storage";
import type { VisualAssetGateway } from "../capabilities/visual-assets";
import { buildPartySystemPrompt } from "../modes/game/prompts/party-prompts";
import { loadCharacterSprites } from "../modes/game/prompts/sprite.service";
import { assembleGenerationPrompt } from "./prompt-assembly";

type RowMap = Record<string, unknown[]>;

function storageWithRows(rows: RowMap): StorageGateway {
  return {
    list: async <T = unknown>(entity: string) => (rows[entity] ?? []) as T[],
    get: async <T = unknown>(entity: string, id: string) =>
      ((rows[entity]?.find((row) => (row as { id?: string }).id === id) ?? null) as T | null),
    create: async <T = unknown>() => ({} as T),
    update: async <T = unknown>() => ({} as T),
    delete: async () => ({ deleted: true }),
    listChatMessages: async <T = unknown>() => [] as T[],
    createChatMessage: async <T = unknown>() => ({} as T),
    updateChatMessage: async <T = unknown>() => ({} as T),
    deleteChatMessage: async () => ({ deleted: true }),
    patchChatMessageExtra: async <T = unknown>() => ({} as T),
    addChatMessageSwipe: async <T = unknown>() => ({} as T),
    patchChatMetadata: async <T = unknown>() => ({} as T),
    patchChatSummaries: async <T = unknown>() => ({} as T),
    listChatMemories: async <T = unknown>() => [] as T[],
    getWorldState: async <T = unknown>() => null as T | null,
    saveTrackerSnapshot: async <T = unknown>() => ({} as T),
    listLorebookEntries: async <T = unknown>(lorebookId: string) =>
      (rows["lorebook-entries"] ?? []).filter((row) => (row as { lorebookId?: string }).lorebookId === lorebookId) as T[],
    createLorebookEntries: async <T = unknown>() => [] as T[],
    promptFull: async <T = unknown>() => null as T | null,
  };
}

function depthInjectionRows(): RowMap {
  return {
    prompts: [
      {
        id: "preset-1",
        isDefault: true,
        wrapFormat: "none",
        parameters: { strictRoleFormatting: false },
      },
    ],
    "prompt-sections": [
      {
        id: "system",
        presetId: "preset-1",
        role: "system",
        content: "system prompt",
        enabled: true,
      },
      {
        id: "history",
        presetId: "preset-1",
        identifier: "chat_history",
        enabled: true,
      },
      {
        id: "post-history",
        presetId: "preset-1",
        role: "system",
        content: "post-history prompt",
        enabled: true,
      },
    ],
    "prompt-groups": [],
    "prompt-choice-blocks": [],
    characters: [],
    personas: [],
    lorebooks: [{ id: "lorebook-1", name: "Depth lore", enabled: true, isGlobal: true }],
    "lorebook-folders": [],
    "lorebook-entries": [
      {
        id: "entry-1",
        lorebookId: "lorebook-1",
        name: "Depth entry",
        content: "depth lore entry",
        constant: true,
        position: 2,
        depth: 0,
        role: "system",
        enabled: true,
      },
    ],
    "regex-scripts": [],
  };
}

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function summaryPresetRows(includeSummaryMarker: boolean): RowMap {
  return {
    prompts: [
      {
        id: "preset-1",
        wrapFormat: "none",
        parameters: { strictRoleFormatting: false },
      },
    ],
    "prompt-sections": [
      {
        id: "system",
        presetId: "preset-1",
        role: "system",
        name: "System",
        content: "Conversation shell.",
        enabled: true,
      },
      ...(includeSummaryMarker
        ? [
            {
              id: "summary",
              presetId: "preset-1",
              role: "system",
              name: "Summary",
              markerConfig: { type: "chat_summary" },
              enabled: true,
            },
          ]
        : []),
      {
        id: "history",
        presetId: "preset-1",
        identifier: "chat_history",
        enabled: true,
      },
    ],
    "prompt-groups": [],
    "prompt-variables": [],
    characters: [],
    personas: [],
    lorebooks: [],
    "lorebook-folders": [],
    "lorebook-entries": [],
    "regex-scripts": [],
  };
}

describe("assembleGenerationPrompt chat summary preset insertion", () => {
  it("fallback-inserts a conversation summary when the selected preset has no summary marker", async () => {
    const storage = storageWithRows(summaryPresetRows(false));

    const assembly = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "conversation",
        promptPresetId: "preset-1",
        metadata: { summary: "Remember the lighthouse." },
      },
      storedMessages: [{ id: "message-1", role: "user", content: "What did we discuss?" }],
      connection: {},
      request: {},
      latestUserInput: "What did we discuss?",
    });

    expect(assembly.promptPresetId).toBe("preset-1");
    const previewContents = assembly.previewMessages.map((message) => message.content);
    expect(previewContents[0]).toBe("Conversation shell.\n\nRemember the lighthouse.");
    expect(previewContents.at(-1)).toBe("What did we discuss?");
    expect(assembly.chatSummaryFingerprint).not.toBeNull();
  });

  it("keeps explicit conversation summary marker placement without duplicating the summary", async () => {
    const storage = storageWithRows(summaryPresetRows(true));

    const assembly = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "conversation",
        promptPresetId: "preset-1",
        metadata: { summary: "Remember the lighthouse." },
      },
      storedMessages: [{ id: "message-1", role: "user", content: "What did we discuss?" }],
      connection: {},
      request: {},
      latestUserInput: "What did we discuss?",
    });

    const promptText = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(assembly.promptPresetId).toBe("preset-1");
    const previewContents = assembly.previewMessages.map((message) => message.content);
    expect(previewContents[0]).toBe("Conversation shell.");
    expect(previewContents[1]).toBe("Remember the lighthouse.");
    expect(previewContents.at(-1)).toBe("What did we discuss?");
    expect(occurrenceCount(promptText, "Remember the lighthouse.")).toBe(1);
  });
});

describe("assembleGenerationPrompt depth injection", () => {
  it("anchors lorebook depth entries to chat history bounds", async () => {
    const storage = storageWithRows(depthInjectionRows());

    const assembly = await assembleGenerationPrompt(storage, {
      chat: { id: "chat-1", mode: "roleplay", promptPresetId: "preset-1", metadata: {} },
      storedMessages: [{ id: "message-1", role: "user", content: "latest user message" }],
      connection: {},
      request: {},
      latestUserInput: "latest user message",
    });

    expect(assembly.previewMessages.map((message) => message.content)).toEqual([
      "system prompt",
      "latest user message",
      "depth lore entry",
      "post-history prompt",
    ]);
  });

  it("falls back to full prompt bounds when no chat history exists", async () => {
    const storage = storageWithRows(depthInjectionRows());

    const assembly = await assembleGenerationPrompt(storage, {
      chat: { id: "chat-1", mode: "roleplay", promptPresetId: "preset-1", metadata: {} },
      storedMessages: [],
      connection: {},
      request: {},
      latestUserInput: "",
    });

    expect(assembly.previewMessages.map((message) => message.content)).toEqual([
      "system prompt",
      "post-history prompt",
      "depth lore entry",
    ]);
  });
});

describe("assembleGenerationPrompt lorebook marker gating", () => {
  function lorebookRuntimeRows(includeLorebookMarker: boolean): RowMap {
    return {
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "system",
          presetId: "preset-1",
          role: "system",
          content: "system prompt",
          enabled: true,
        },
        ...(includeLorebookMarker
          ? [
              {
                id: "lore",
                presetId: "preset-1",
                identifier: "lorebook",
                role: "system",
                enabled: true,
              },
            ]
          : []),
        {
          id: "history",
          presetId: "preset-1",
          identifier: "chat_history",
          enabled: true,
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [],
      personas: [],
      lorebooks: [{ id: "lorebook-1", name: "Runtime lore", enabled: true, isGlobal: true }],
      "lorebook-folders": [],
      "lorebook-entries": [
        {
          id: "entry-1",
          lorebookId: "lorebook-1",
          name: "Runtime entry",
          content: "matched runtime lore",
          keys: ["trigger"],
          ephemeral: 1,
          position: 0,
          enabled: true,
        },
      ],
      "regex-scripts": [],
    };
  }

  it("does not scan or consume runtime state when the selected preset has no lore marker", async () => {
    const storage = storageWithRows(lorebookRuntimeRows(false));

    const assembly = await assembleGenerationPrompt(storage, {
      chat: { id: "chat-1", mode: "roleplay", promptPresetId: "preset-1", metadata: {} },
      storedMessages: [{ id: "message-1", role: "user", content: "trigger" }],
      connection: {},
      request: {},
      latestUserInput: "trigger",
    });

    expect(assembly.previewMessages.map((message) => message.content)).toEqual(["system prompt", "trigger"]);
    expect(assembly.activatedLorebookEntries).toEqual([]);
    expect(assembly.lorebookTimingStates).toBeNull();
    expect(assembly.lorebookEntryStateOverrides).toBeNull();
    expect(assembly.budgetSkippedLorebookEntries).toEqual([]);
  });

  it("still scans and consumes runtime state when a lore marker is present", async () => {
    const storage = storageWithRows(lorebookRuntimeRows(true));

    const assembly = await assembleGenerationPrompt(storage, {
      chat: { id: "chat-1", mode: "roleplay", promptPresetId: "preset-1", metadata: {} },
      storedMessages: [{ id: "message-1", role: "user", content: "trigger" }],
      connection: {},
      request: {},
      latestUserInput: "trigger",
    });

    expect(assembly.previewMessages.map((message) => message.content)).toEqual([
      "system prompt",
      "matched runtime lore",
      "trigger",
    ]);
    expect(assembly.activatedLorebookEntries).toHaveLength(1);
    expect(assembly.lorebookEntryStateOverrides).toEqual({ "entry-1": { ephemeral: 0, enabled: false } });
  });

  it("still scans world-info entries when an empty selected preset falls back to the default prompt", async () => {
    const rows = lorebookRuntimeRows(false);
    rows["prompt-sections"] = [];
    const storage = storageWithRows(rows);

    const assembly = await assembleGenerationPrompt(storage, {
      chat: { id: "chat-1", mode: "roleplay", promptPresetId: "preset-1", metadata: {} },
      storedMessages: [{ id: "message-1", role: "user", content: "trigger" }],
      connection: {},
      request: {},
      latestUserInput: "trigger",
    });

    expect(assembly.previewMessages.map((message) => message.content).join("\n\n")).toContain("matched runtime lore");
    expect(assembly.activatedLorebookEntries).toHaveLength(1);
    expect(assembly.lorebookEntryStateOverrides).toEqual({ "entry-1": { ephemeral: 0, enabled: false } });
  });
});

describe("assembleGenerationPrompt character markers", () => {
  it("renders requested creator notes fields with character macro resolution", async () => {
    const storage = storageWithRows({
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "characters",
          presetId: "preset-1",
          identifier: "character",
          role: "system",
          enabled: true,
          markerConfig: { type: "character", characterFields: ["creator_notes", "creatorNotes"] },
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        {
          id: "char-1",
          data: {
            name: "Alice",
            description: "Alice description.",
            creator_notes: "Creator note for {{char}} and {{user}}.",
          },
        },
      ],
      personas: [{ id: "persona-1", isActive: true, data: { name: "Celia" } }],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: { id: "chat-1", mode: "roleplay", characterIds: ["char-1"], metadata: {} },
      storedMessages: [],
      connection: {},
      request: {},
      latestUserInput: "",
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt.match(/Creator Notes: Creator note for Alice and Celia\./g)).toHaveLength(2);
  });

  it("resolves character field macros against each rendered character in a group", async () => {
    const storage = storageWithRows({
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "system",
          presetId: "preset-1",
          role: "system",
          content: "Global speaker is {{char}}.",
          enabled: true,
        },
        {
          id: "characters",
          presetId: "preset-1",
          identifier: "character",
          role: "system",
          enabled: true,
          markerConfig: { type: "character", characterFields: ["description", "personality"] },
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        {
          id: "char-1",
          data: {
            name: "Alice",
            description: "Alice description.",
            personality: "Alice personality",
            scenario: "Alice scenario",
          },
        },
        {
          id: "char-2",
          data: {
            name: "Bob",
            description: "Bob description references {{personality}} for {{char}} and {{user}}.",
            personality: "Bob personality with {{scenario}}",
            scenario: "Bob scenario",
          },
        },
      ],
      personas: [{ id: "persona-1", isActive: true, data: { name: "Celia" } }],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: { id: "chat-1", mode: "roleplay", characterIds: ["char-1", "char-2"], metadata: {} },
      storedMessages: [],
      connection: {},
      request: {},
      latestUserInput: "",
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt).toContain("Global speaker is Alice.");
    expect(prompt).toContain("Bob description references Bob personality with Bob scenario for Bob and Celia.");
    expect(prompt).not.toContain("Bob description references Alice personality");
    expect(prompt).not.toContain("Alice scenario for Bob");
  });

  it("uses the group scenario override for character prompt context", async () => {
    const storage = storageWithRows({
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "system",
          presetId: "preset-1",
          role: "system",
          content: "Macro scenario is {{scenario}}.",
          enabled: true,
        },
        {
          id: "characters",
          presetId: "preset-1",
          identifier: "character",
          role: "system",
          enabled: true,
          markerConfig: { type: "character", characterFields: ["description", "scenario"] },
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        {
          id: "char-1",
          data: {
            name: "Alice",
            description: "Alice sees {{scenario}}.",
            scenario: "Alice old scenario",
          },
        },
        {
          id: "char-2",
          data: {
            name: "Bob",
            description: "Bob sees {{scenario}}.",
            scenario: "Bob old scenario",
          },
        },
      ],
      personas: [{ id: "persona-1", isActive: true, data: { name: "Celia" } }],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["char-1", "char-2"],
        metadata: { groupScenarioOverride: true, groupScenarioText: "Shared stage scenario" },
      },
      storedMessages: [],
      connection: {},
      request: {},
      latestUserInput: "",
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt).toContain("Macro scenario is Shared stage scenario.");
    expect(prompt).toContain("Alice sees Shared stage scenario.");
    expect(prompt).toContain("Bob sees Shared stage scenario.");
    expect(prompt).toContain("Scenario: Shared stage scenario");
    expect(prompt).not.toContain("Alice old scenario");
    expect(prompt).not.toContain("Bob old scenario");
  });

  it("suppresses character scenarios when the group scenario override is blank", async () => {
    const storage = storageWithRows({
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "system",
          presetId: "preset-1",
          role: "system",
          content: "Macro scenario is {{scenario}}.",
          enabled: true,
        },
        {
          id: "characters",
          presetId: "preset-1",
          identifier: "character",
          role: "system",
          enabled: true,
          markerConfig: { type: "character", characterFields: ["description", "scenario"] },
        },
        {
          id: "history",
          presetId: "preset-1",
          identifier: "chat_history",
          enabled: true,
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        {
          id: "char-1",
          data: {
            name: "Alice",
            description: "Alice sees {{scenario}}.",
            scenario: "Alice old scenario",
            extensions: {
              depth_prompt: { prompt: "Depth scenario is {{scenario}}.", depth: 0, role: "system" },
            },
          },
        },
      ],
      personas: [{ id: "persona-1", isActive: true, data: { name: "Celia" } }],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["char-1"],
        metadata: { groupScenarioOverride: true, groupScenarioText: "   " },
      },
      storedMessages: [{ id: "message-1", role: "user", content: "hello" }],
      connection: {},
      request: {},
      latestUserInput: "hello",
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt).toContain("Macro scenario is .");
    expect(prompt).toContain("Alice sees .");
    expect(prompt).toContain("Depth scenario is .");
    expect(prompt).not.toContain("Scenario: Alice old scenario");
    expect(prompt).not.toContain("Alice old scenario");

    const fallbackStorage = storageWithRows({
      prompts: [],
      "prompt-sections": [],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        {
          id: "char-1",
          data: {
            name: "Alice",
            description: "Alice fallback description.",
            scenario: "Alice old scenario",
          },
        },
      ],
      personas: [{ id: "persona-1", isActive: true, data: { name: "Celia" } }],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const fallbackAssembly = await assembleGenerationPrompt(fallbackStorage, {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["char-1"],
        metadata: { groupScenarioOverride: true, groupScenarioText: "" },
      },
      storedMessages: [],
      connection: {},
      request: {},
      latestUserInput: "",
    });

    const fallbackPrompt = fallbackAssembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(fallbackPrompt).toContain("Alice fallback description.");
    expect(fallbackPrompt).not.toContain("Scenario:");
    expect(fallbackPrompt).not.toContain("<scenario>");
    expect(fallbackPrompt).not.toContain("Alice old scenario");
  });

  it("resolves group scenario override macros in markers, fallback, and depth prompts", async () => {
    const storage = storageWithRows({
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "characters",
          presetId: "preset-1",
          identifier: "character",
          role: "system",
          enabled: true,
          markerConfig: { type: "character", characterFields: ["description", "scenario"] },
        },
        {
          id: "history",
          presetId: "preset-1",
          identifier: "chat_history",
          enabled: true,
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        {
          id: "char-1",
          data: {
            name: "Alice",
            description: "Alice sees {{scenario}}.",
            scenario: "Alice old scenario",
            extensions: {
              depth_prompt: { prompt: "Depth sees {{scenario}}.", depth: 0, role: "system" },
            },
          },
        },
        {
          id: "char-2",
          data: {
            name: "Bob",
            description: "Bob sees {{scenario}}.",
            scenario: "Bob old scenario",
          },
        },
      ],
      personas: [{ id: "persona-1", isActive: true, data: { name: "Celia" } }],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["char-1", "char-2"],
        metadata: {
          groupScenarioOverride: true,
          groupScenarioText: "Shared scene for {{user}} and {{char}}.",
        },
      },
      storedMessages: [{ id: "message-1", role: "user", content: "hello" }],
      connection: {},
      request: {},
      latestUserInput: "hello",
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt).toContain("Alice sees Shared scene for Celia and Alice.");
    expect(prompt).toContain("Bob sees Shared scene for Celia and Bob.");
    expect(prompt).toContain("Scenario: Shared scene for Celia and Alice.");
    expect(prompt).toContain("Depth sees Shared scene for Celia and Alice.");
    expect(prompt).not.toContain("{{user}}");
    expect(prompt).not.toContain("{{char}}");
    expect(prompt).not.toContain("Alice old scenario");
    expect(prompt).not.toContain("Bob old scenario");

    const fallbackStorage = storageWithRows({
      prompts: [],
      "prompt-sections": [],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        {
          id: "char-1",
          data: {
            name: "Alice",
            description: "Alice fallback description.",
            scenario: "Alice old scenario",
          },
        },
      ],
      personas: [{ id: "persona-1", isActive: true, data: { name: "Celia" } }],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const fallbackAssembly = await assembleGenerationPrompt(fallbackStorage, {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["char-1"],
        metadata: {
          groupScenarioOverride: true,
          groupScenarioText: "Fallback scene for {{user}} and {{char}}.",
        },
      },
      storedMessages: [{ id: "message-1", role: "user", content: "hello" }],
      connection: {},
      request: {},
      latestUserInput: "hello",
    });

    const fallbackPrompt = fallbackAssembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(fallbackPrompt).toContain("Fallback scene for Celia and Alice.");
    expect(fallbackPrompt).not.toContain("{{user}}");
    expect(fallbackPrompt).not.toContain("{{char}}");
    expect(fallbackPrompt).not.toContain("Alice old scenario");
  });

  it("does not append a group scenario block when a custom character marker excludes scenario", async () => {
    const storage = storageWithRows({
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "characters",
          presetId: "preset-1",
          identifier: "character",
          role: "system",
          enabled: true,
          markerConfig: { type: "character", characterFields: ["description"] },
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        {
          id: "char-1",
          data: {
            name: "Alice",
            description: "Alice description.",
            scenario: "Alice old scenario",
          },
        },
      ],
      personas: [],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["char-1"],
        metadata: { groupScenarioOverride: true, groupScenarioText: "Shared stage scenario" },
      },
      storedMessages: [],
      connection: {},
      request: {},
      latestUserInput: "",
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt).toContain("Description: Alice description.");
    expect(prompt).not.toContain("Scenario:");
    expect(prompt).not.toContain("Shared stage scenario");
    expect(prompt).not.toContain("Alice old scenario");
  });
});

describe("assembleGenerationPrompt prompt regex scripts", () => {
  it("applies prompt-only regex scripts to prompt and injection messages", async () => {
    const storage = storageWithRows({
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "system",
          presetId: "preset-1",
          role: "system",
          content: "replace-system",
          enabled: true,
        },
        {
          id: "history",
          presetId: "preset-1",
          identifier: "chat_history",
          enabled: true,
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [],
      personas: [],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [
        {
          id: "script-1",
          enabled: true,
          promptOnly: true,
          placement: ["ai_output"],
          findRegex: "replace-system|replace-agent",
          flags: "g",
          replaceString: "transformed",
        },
      ],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: { id: "chat-1", mode: "roleplay", promptPresetId: "preset-1", metadata: {} },
      storedMessages: [{ id: "message-1", role: "user", content: "latest user message" }],
      connection: {},
      request: {},
      latestUserInput: "latest user message",
      agentData: { html: "replace-agent" },
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt).toContain("transformed");
    expect(prompt).not.toContain("replace-system");
    expect(prompt).not.toContain("replace-agent");
  });

  it("applies prompt-only regex scripts to group turn prompt messages", async () => {
    const storage = storageWithRows({
      prompts: [
        {
          id: "preset-1",
          isDefault: true,
          wrapFormat: "none",
          parameters: { strictRoleFormatting: false },
        },
      ],
      "prompt-sections": [
        {
          id: "system",
          presetId: "preset-1",
          role: "system",
          content: "system prompt",
          enabled: true,
        },
        {
          id: "history",
          presetId: "preset-1",
          identifier: "chat_history",
          enabled: true,
        },
      ],
      "prompt-groups": [],
      "prompt-choice-blocks": [],
      characters: [
        { id: "char-1", data: { name: "Alice", description: "A careful speaker." } },
        { id: "char-2", data: { name: "Bob", description: "A quiet listener." } },
      ],
      personas: [],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [
        {
          id: "script-1",
          enabled: true,
          promptOnly: true,
          placement: ["ai_output"],
          findRegex: "Respond only as Alice",
          replaceString: "Only Alice answers",
        },
      ],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "roleplay",
        characterIds: ["char-1", "char-2"],
        metadata: { groupChatMode: "individual" },
        promptPresetId: "preset-1",
      },
      storedMessages: [{ id: "message-1", role: "user", content: "latest user message" }],
      connection: {},
      request: { forCharacterId: "char-1" },
      latestUserInput: "latest user message",
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt).toContain("Only Alice answers");
    expect(prompt).not.toContain("Respond only as Alice");
  });
});

describe("assembleGenerationPrompt game sprites", () => {
  const visuals: VisualAssetGateway = {
    listSprites: async (ownerId) =>
      ownerId === "char-1"
        ? [
            { expression: "neutral" },
            { expression: "joy_01" },
            { expression: "full_idle" },
            { expression: "full_walk" },
            { expression: "full_cape_flare" },
          ]
        : [{ expression: "worried" }],
    listBackgrounds: async () => [],
  };

  it("passes party sprite availability into the GM prompt reminder", async () => {
    const storage = storageWithRows({
      prompts: [],
      characters: [
        { id: "char-1", name: "Marina", data: { name: "Marina", description: "A careful scout." } },
        { id: "char-2", name: "Sol", data: { name: "Sol", description: "A bright mage." } },
      ],
      personas: [],
      lorebooks: [],
      "lorebook-folders": [],
      "lorebook-entries": [],
      "regex-scripts": [],
    });

    const assembly = await assembleGenerationPrompt(storage, {
      chat: {
        id: "chat-1",
        mode: "game",
        characterIds: ["char-1", "char-2"],
        metadata: {
          gamePartyCharacterIds: ["char-1", "char-2"],
          gameSetupConfig: { genre: "fantasy", setting: "coast", tone: "warm", difficulty: "normal" },
        },
      },
      storedMessages: [{ id: "message-1", role: "user", content: "Look around." }],
      connection: {},
      request: {},
      latestUserInput: "Look around.",
      visuals,
    });

    const prompt = assembly.previewMessages.map((message) => message.content).join("\n\n");
    expect(prompt).toContain("Available custom sprites per character");
    expect(prompt).toContain("Marina (expressions): neutral, joy_01");
    expect(prompt).toContain("Marina (full-body): cape_flare");
    expect(prompt).toContain("Sol (expressions): worried");
    expect(prompt).not.toContain("Marina (full-body): idle");
    expect(prompt).not.toContain("Marina (full-body): walk");
  });

  it("passes party sprite availability into the party-agent prompt", async () => {
    const characterSprites = await loadCharacterSprites(visuals, [
      { id: "char-1", name: "Marina" },
      { id: "char-2", name: "Sol" },
    ]);

    const prompt = buildPartySystemPrompt({
      partyCards: [
        { name: "Marina", card: "Name: Marina\nDescription: A careful scout." },
        { name: "Sol", card: "Name: Sol\nDescription: A bright mage." },
      ],
      playerName: "Player",
      gameActiveState: "exploration",
      characterSprites,
    });

    expect(prompt).toContain("Available sprites per character");
    expect(prompt).toContain("Marina: neutral, joy_01 | custom full-body aliases: cape_flare");
    expect(prompt).toContain("Sol: worried");
    expect(prompt).not.toContain("custom full-body aliases: idle");
    expect(prompt).not.toContain("custom full-body aliases: walk");
  });
});
