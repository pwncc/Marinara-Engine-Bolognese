// Guards prompt survival when a connection's stored max_tokens eats most of the context window.
//
// Single-shot prompts (Noodle refreshes, summarizers) carry no messages marked contextKind
// "history", so the trimmer has nothing it may safely drop. It used to delete the prompt body
// anyway and send only the trailing instruction, which reaches the model as a request with no
// content to work from — and no error anywhere.
import assert from "node:assert/strict";
import { fitMessagesToContext } from "../../packages/server/src/services/llm/base-provider.js";
import type { ChatMessage } from "../../packages/server/src/services/llm/base-provider.js";

const filler = (approximateTokens: number) => "word ".repeat(approximateTokens);

// Shaped like a Noodle timeline refresh: system rules, the context body, then the JSON format
// instruction. Nothing is annotated as history, because none of it is history.
const singleShotPrompt: ChatMessage[] = [
  { role: "system", content: filler(1000) },
  { role: "user", content: `# Active Noodle Accounts\n# Character Profiles\n${filler(3000)}` },
  { role: "user", content: `# JSON Output Format\n${filler(350)}` },
];

// A stored max_tokens of 32768 against a 36864 context window leaves an input budget far smaller
// than the prompt — the exact shape of the reported failure.
const squeezed = fitMessagesToContext(singleShotPrompt, { maxContext: 36864, maxTokens: 32768 });

// The prompt body must survive.
assert.equal(squeezed.messages.length, 3, "no message may be dropped from a single-shot prompt");
assert.match(squeezed.messages[1]!.content ?? "", /# Character Profiles/);

// The output budget yields instead, and must stay usable rather than collapsing to the floor.
assert.ok(
  squeezed.maxTokens !== undefined && squeezed.maxTokens < 32768,
  "max_tokens should be reduced to make room for the prompt",
);
assert.ok(squeezed.maxTokens! > 1000, `max_tokens collapsed to ${squeezed.maxTokens}`);

// A comfortable window changes nothing.
const roomy = fitMessagesToContext(singleShotPrompt, { maxContext: 98304, maxTokens: 32768 });
assert.equal(roomy.trimmed, false);
assert.equal(roomy.messages.length, 3);
assert.equal(roomy.maxTokens, 32768);

// Conversations still trim their history: that content is explicitly marked as expendable.
const conversation: ChatMessage[] = [
  { role: "system", content: filler(500) },
  { role: "user", content: `oldest turn ${filler(3000)}`, contextKind: "history" },
  { role: "assistant", content: `reply ${filler(3000)}`, contextKind: "history" },
  { role: "user", content: filler(200) },
];
const trimmedChat = fitMessagesToContext(conversation, { maxContext: 8192, maxTokens: 1024 });
assert.ok(trimmedChat.trimmed, "an oversized conversation should still trim history");
assert.ok(
  trimmedChat.messages.length < conversation.length,
  "history messages should still be removable when annotated",
);

// The caller's own budget travels with the result, so a reduction can be reported rather than
// silently changing what the user configured (#6614).
assert.equal(squeezed.requestedMaxTokens, 32768, "the requested reply budget must survive the fit");
assert.equal(roomy.requestedMaxTokens, 32768);

// A prompt that fills the window on its own leaves the reply at the floor: the shape of the
// reported failure, where a configured 1000 reached the provider as 128 with nothing logged.
const floored = fitMessagesToContext([{ role: "system", content: filler(8000) }], {
  maxContext: 8192,
  maxTokens: 1000,
});
assert.equal(floored.maxTokens, 128, `reply budget should rest on the floor, got ${floored.maxTokens}`);
assert.equal(floored.requestedMaxTokens, 1000, "the floor must still report what was asked for");

// A reply budget as large as the window itself, on a long chat: a provider that lists a model's max
// output as its whole context (Featherless: 32768 of 32768) used to leave the reply 128 tokens,
// which a reasoning model spends before it answers or closes a tool call. The reply keeps a share
// of the window and old turns go instead.
const longChat: ChatMessage[] = [
  { role: "system", content: filler(1000) },
  ...Array.from({ length: 40 }, (_, index): ChatMessage[] => [
    { role: "user", content: `turn ${index} ${filler(300)}`, contextKind: "history" },
    { role: "assistant", content: `reply ${index} ${filler(600)}`, contextKind: "history" },
  ]).flat(),
  { role: "user", content: `latest ${filler(100)}` },
];
const wholeWindow = fitMessagesToContext(longChat, { maxContext: 32768, maxTokens: 32768 });
assert.ok(
  wholeWindow.maxTokens !== undefined && wholeWindow.maxTokens >= 8000,
  `a long chat must leave room for the reply, got ${wholeWindow.maxTokens}`,
);
assert.ok(wholeWindow.trimmed, "old turns make the room");
assert.match(wholeWindow.messages.at(-1)!.content ?? "", /^latest /, "the newest turn stays");
assert.equal(wholeWindow.messages[0]!.role, "system", "the system prompt stays");
assert.ok(
  wholeWindow.estimatedTokensAfter + wholeWindow.maxTokens! <= 32768,
  "prompt and reply still fit the window together",
);
// A short chat under the same settings loses nothing and keeps the rest of the window for the reply.
const shortChat = fitMessagesToContext(longChat.slice(0, 5).concat(longChat.at(-1)!), {
  maxContext: 32768,
  maxTokens: 32768,
});
assert.equal(shortChat.trimmed, false);
assert.ok(shortChat.maxTokens! > 25000, `a short chat keeps the window for the reply, got ${shortChat.maxTokens}`);

// With no context window configured nothing is touched at all.
const unbounded = fitMessagesToContext(singleShotPrompt, { maxTokens: 32768 });
assert.equal(unbounded.trimmed, false);
assert.equal(unbounded.messages.length, 3);

process.stdout.write("Context fit regression passed.\n");
