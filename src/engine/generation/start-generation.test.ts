import { describe, expect, it, vi } from "vitest";
import type { LlmGateway } from "../capabilities/llm";
import type { StorageGateway } from "../capabilities/storage";
import { retryGenerationAgents, startGeneration, type GenerationEngineDeps } from "./start-generation";

function depsForChat(chat: Record<string, unknown>) {
  const get = vi.fn(async (entity: string, id: string) => (entity === "chats" && id === "chat-1" ? chat : null));
  const createChatMessage = vi.fn(async () => {
    throw new Error("createChatMessage should not be called");
  });
  const storage = {
    get,
    createChatMessage,
  } as Partial<StorageGateway> as StorageGateway;
  const deps: GenerationEngineDeps = {
    storage,
    llm: {} as GenerationEngineDeps["llm"],
    integrations: {} as GenerationEngineDeps["integrations"],
  };
  return { deps, get, createChatMessage };
}

function generationDepsForChat(options: {
  savedUserMessage?: unknown;
  messagesAfterSave?: Record<string, unknown>[];
  chatMetadata?: Record<string, unknown>;
  agents?: Record<string, unknown>[];
  agentRuns?: Record<string, unknown>[];
  initialMessages?: Record<string, unknown>[];
} = {}) {
  const chat = {
    id: "chat-1",
    mode: "conversation",
    connectionId: "connection-1",
    characterIds: [],
    metadata: options.chatMetadata ?? {},
  };
  const connection = {
    id: "connection-1",
    model: "test-model",
    defaultParameters: {},
  };
  const initialMessages = options.initialMessages ?? [
    { id: "assistant-1", chatId: "chat-1", role: "assistant", content: "What now?" },
  ];
  const listChatMessages = vi.fn(async () =>
    listChatMessages.mock.calls.length > 1 && options.messagesAfterSave
      ? options.messagesAfterSave
      : initialMessages,
  );
  const streamedRequests: unknown[] = [];
  const stream: LlmGateway["stream"] = vi.fn(async function* (request) {
    streamedRequests.push(request);
    yield { type: "token" as const, text: "Done." };
  });
  const createChatMessage = vi.fn(async (_chatId: string, value: Record<string, unknown>) => {
    if (value.role === "user") {
      return options.savedUserMessage ?? { id: "user-1", chatId: "chat-1", ...value };
    }
    return { id: "assistant-2", chatId: "chat-1", ...value };
  });
  const storage = {
    get: vi.fn(async (entity: string, id: string) => {
      if (entity === "chats" && id === "chat-1") return chat;
      if (entity === "connections" && id === "connection-1") return connection;
      return null;
    }),
    list: vi.fn(async (entity: string) => {
      if (entity === "agents") return options.agents ?? [];
      if (entity === "agent-runs") return options.agentRuns ?? [];
      return [];
    }),
    create: vi.fn(async (_entity: string, value: Record<string, unknown>) => value),
    createChatMessage,
    listChatMessages,
    listChatMemories: vi.fn(async () => []),
    listLorebookEntries: vi.fn(async () => []),
    saveTrackerSnapshot: vi.fn(async (_chatId: string, snapshot: Record<string, unknown>) => snapshot),
  } as Partial<StorageGateway> as StorageGateway;
  const deps: GenerationEngineDeps = {
    storage,
    llm: { stream } as Partial<LlmGateway> as LlmGateway,
    integrations: {} as GenerationEngineDeps["integrations"],
  };
  return { deps, listChatMessages, streamedRequests };
}

async function drainGeneration(stream: AsyncGenerator<unknown>) {
  for await (const _event of stream) {
    // Exhaust the generator so storage and LLM calls finish.
  }
}

describe("startGeneration concluded roleplay guard", () => {
  it("rejects concluded roleplay scenes before saving user messages", async () => {
    const { deps, createChatMessage } = depsForChat({
      id: "chat-1",
      mode: "roleplay",
      metadata: { sceneStatus: "concluded" },
    });

    const stream = startGeneration(deps, { chatId: "chat-1", userMessage: "continue" });

    await expect(stream.next()).rejects.toThrow("This scene is concluded.");
    expect(createChatMessage).not.toHaveBeenCalled();
  });

  it("uses legacy chatMode and string metadata when guarding agent retries", async () => {
    const { deps } = depsForChat({
      id: "chat-1",
      chatMode: "roleplay",
      metadata: JSON.stringify({ sceneStatus: "concluded" }),
    });

    await expect(retryGenerationAgents(deps, { chatId: "chat-1" })).rejects.toThrow("This scene is concluded.");
  });

  it("does not block non-roleplay chats that have concluded scene metadata", async () => {
    const { deps } = depsForChat({
      id: "chat-1",
      mode: "conversation",
      metadata: { sceneStatus: "concluded" },
    });

    const stream = startGeneration(deps, { chatId: "chat-1", userMessage: "continue" });

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { type: "phase", data: "Saving message..." },
    });
    await stream.return(undefined);
  });
});

describe("startGeneration chat message loading", () => {
  it("reuses the pre-commit messages and appends the saved user message for normal sends", async () => {
    const { deps, listChatMessages, streamedRequests } = generationDepsForChat();

    await drainGeneration(
      startGeneration(deps, {
        chatId: "chat-1",
        userMessage: "hello",
        impersonateBlockAgents: true,
      }),
    );

    expect(listChatMessages).toHaveBeenCalledTimes(1);
    expect(streamedRequests).toHaveLength(1);
    expect(streamedRequests[0]).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: "hello" })]),
    });
  });

  it("reloads messages after saving when the storage adapter does not return a saved message record", async () => {
    const { deps, listChatMessages, streamedRequests } = generationDepsForChat({
      savedUserMessage: "user-1",
      messagesAfterSave: [
        { id: "assistant-1", chatId: "chat-1", role: "assistant", content: "What now?" },
        { id: "user-1", chatId: "chat-1", role: "user", content: "hello" },
      ],
    });

    await drainGeneration(
      startGeneration(deps, {
        chatId: "chat-1",
        userMessage: "hello",
        impersonateBlockAgents: true,
      }),
    );

    expect(listChatMessages).toHaveBeenCalledTimes(2);
    expect(streamedRequests).toHaveLength(1);
    expect(streamedRequests[0]).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: "hello" })]),
    });
  });

  it("reloads messages after saving when the saved message record is incomplete", async () => {
    const { deps, listChatMessages, streamedRequests } = generationDepsForChat({
      savedUserMessage: { id: "user-1" },
      messagesAfterSave: [
        { id: "assistant-1", chatId: "chat-1", role: "assistant", content: "What now?" },
        { id: "user-1", chatId: "chat-1", role: "user", content: "hello" },
      ],
    });

    await drainGeneration(
      startGeneration(deps, {
        chatId: "chat-1",
        userMessage: "hello",
        impersonateBlockAgents: true,
      }),
    );

    expect(listChatMessages).toHaveBeenCalledTimes(2);
    expect(streamedRequests).toHaveLength(1);
    expect(streamedRequests[0]).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: "hello" })]),
    });
  });
});

describe("retryGenerationAgents lorebook keeper backfill", () => {
  it("uses run interval and read-behind settings to backfill only unprocessed batch anchors", async () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: `assistant-${index + 1}`,
      chatId: "chat-1",
      role: "assistant",
      content: `Assistant message ${index + 1}`,
    }));
    const { deps, streamedRequests } = generationDepsForChat({
      chatMetadata: {
        enableAgents: true,
        activeAgentIds: ["lorebook-keeper"],
        lorebookKeeperReadBehindMessages: 10,
      },
      agents: [
        {
          id: "lorebook-agent",
          type: "lorebook-keeper",
          name: "Lorebook Keeper",
          enabled: true,
          phase: "post_processing",
          connectionId: null,
          model: "agent-model",
          promptTemplate: "Return JSON.",
          settings: { runInterval: 10, contextSize: 15 },
        },
      ],
      agentRuns: [
        {
          id: "run-10",
          chatId: "chat-1",
          messageId: "assistant-10",
          agentType: "lorebook-keeper",
          success: true,
        },
      ],
      initialMessages: messages,
    });

    const results = await retryGenerationAgents(deps, {
      chatId: "chat-1",
      agentTypes: ["lorebook-keeper"],
      options: { lorebookKeeperBackfill: true },
    });

    expect(results).toHaveLength(2);
    expect(streamedRequests).toHaveLength(2);
    expect(streamedRequests.map((request) => (request as { messages: Array<{ content: string }> }).messages.at(-1)?.content)).toEqual([
      expect.stringContaining("Assistant message 20"),
      expect.stringContaining("Assistant message 30"),
    ]);
    const promptTexts = streamedRequests.map((request) =>
      (request as { messages: Array<{ content: string }> }).messages.map((message) => message.content).join("\n"),
    );
    expect(promptTexts[0]).toContain("Assistant message 19");
    expect(promptTexts[0]).toContain("Assistant message 20");
    expect(promptTexts[0]).not.toContain("Assistant message 31");
    expect(promptTexts[1]).toContain("Assistant message 29");
    expect(promptTexts[1]).toContain("Assistant message 30");
    expect(promptTexts[1]).not.toContain("Assistant message 31");
  });
});
