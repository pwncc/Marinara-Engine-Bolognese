// Guards the Featherless request rules and account reads.
//
// Featherless serves a plain text request through the model's own chat template, which carries the
// tool definitions and call format. A request with a picture, or with a thinking switch in
// `chat_template_kwargs`, goes another way that returns no tool calls at all: the reported failure
// was a roleplay with REagent on, where an attached picture left the model inventing tool names in
// plain text. A picture request therefore carries its tools in the prompt and the calls are read from
// the reply. Its model list also gives most models a max output equal to their whole context,
// which, saved as the Connection's max output, left long chats 128 tokens for the reply.
// All of it was observed against api.featherless.ai on 2026-11-26; none of it is documented there.
import assert from "node:assert/strict";
import { connectionBalanceSource } from "../../packages/shared/src/index.js";
import {
  featherlessFittingMaxTokens,
  featherlessReasoningEffort,
  isFeatherlessBaseUrl,
  normalizeFeatherlessRequest,
} from "../../packages/server/src/services/llm/providers/featherless-request-compat.js";
import {
  holdBackTextualCalls,
  parseTextualToolCalls,
} from "../../packages/server/src/services/llm/textual-tool-call-parser.js";
import {
  describeFeatherlessTest,
  shapeFeatherlessModel,
} from "../../packages/server/src/services/connections/featherless.js";
import { parseFeatherlessPlan } from "../../packages/server/src/services/connections/balance.js";

// ── which endpoints the rules apply to ──
assert.equal(isFeatherlessBaseUrl("https://api.featherless.ai/v1"), true);
assert.equal(isFeatherlessBaseUrl("https://featherless.ai/v1"), true);
assert.equal(isFeatherlessBaseUrl("https://notfeatherless.ai/v1"), false);
assert.equal(isFeatherlessBaseUrl("https://api.featherless.ai.evil.example/v1"), false);
assert.equal(isFeatherlessBaseUrl("not a url"), false);

// ── reasoning effort ──
assert.equal(featherlessReasoningEffort("none"), "none");
assert.equal(featherlessReasoningEffort("low"), "low");
assert.equal(featherlessReasoningEffort("high"), "high");
assert.equal(featherlessReasoningEffort("max"), "xhigh");
assert.equal(featherlessReasoningEffort(undefined), undefined);

const tools = [{ type: "function", function: { name: "roll_dice", parameters: { type: "object", properties: {} } } }];
const picture = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
type Body = Record<string, any>;

// ── tools and a picture: the picture stays, the tools go into the prompt, tool turns become text ──
let body: Body = {
  tools,
  tool_choice: "auto",
  reasoning_effort: "none",
  messages: [
    { role: "system", content: "S" },
    { role: "user", content: [{ type: "text", text: "look" }, picture] },
    {
      role: "assistant",
      content: "Rolling.",
      tool_calls: [
        { id: "1", type: "function", function: { name: "roll_dice", arguments: '{"sides":6}' } },
        { id: "2", type: "function", function: { name: "roll_dice", arguments: '{"sides":20}' } },
      ],
    },
    { role: "tool", tool_call_id: "1", content: '{"total":4}' },
    { role: "tool", tool_call_id: "2", content: '{"total":17}' },
  ],
};
let changes = normalizeFeatherlessRequest(body);
assert.equal(changes.textualTools, true);
assert.equal("tools" in body, false, "a picture request is sent without protocol tools");
assert.equal("tool_choice" in body, false);
assert.equal(body.messages.length, 4, "the two results share one turn");
assert.match(body.messages[0].content, /^# Tools\n[\s\S]*"name":"roll_dice"[\s\S]*<tool_call>[\s\S]*\n\nS$/);
assert.equal(body.messages[1].content[1], picture, "the picture is still sent");
assert.equal(
  body.messages[2].content,
  'Rolling.\n<tool_call>\n{"name":"roll_dice","arguments":{"sides":6}}\n</tool_call>\n<tool_call>\n{"name":"roll_dice","arguments":{"sides":20}}\n</tool_call>',
);
assert.equal("tool_calls" in body.messages[2], false);
assert.deepEqual(body.messages[3], {
  role: "user",
  content: '<tool_response>\n{"total":4}\n</tool_response>\n<tool_response>\n{"total":17}\n</tool_response>',
});
assert.equal("reasoning_effort" in body, false, "thinking is switched off the way a picture request takes it");
assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
// a forced call is asked for in words, and a prompt without a system message gets one
body = { tools, tool_choice: "required", messages: [{ role: "user", content: [picture] }] };
normalizeFeatherlessRequest(body);
assert.equal(body.messages[0].role, "system");
assert.match(body.messages[0].content, /You must call at least one function in this reply\.$/);
// the calls written that way are the ones the reply parser reads back
assert.deepEqual(
  parseTextualToolCalls(
    'Rolling.\n<tool_call>\n{"name": "roll_dice", "arguments": {"sides": 6}}\n</tool_call>',
    tools as never,
  ).map((call) => [call.function.name, call.function.arguments]),
  [["roll_dice", '{"sides":6}']],
);

// ── call text is held back from the live stream; text that was no call after all is released ──
let streamed = "";
let held = holdBackTextualCalls((chunk) => void (streamed += chunk));
for (const chunk of ["The door ", "opens. <", "tool_call>\n{", '"name": "roll_dice"}\n</tool_call>']) {
  await held.onToken(chunk);
}
assert.equal(streamed, "The door opens. ");
streamed = "";
held = holdBackTextualCalls((chunk) => void (streamed += chunk));
for (const chunk of ["2 <", " 3, and it ends with <"]) await held.onToken(chunk);
assert.equal(streamed, "2 < 3, and it ends with ");
await held.flush();
assert.equal(streamed, "2 < 3, and it ends with <");

// ── tools without a picture stay protocol tools ──
body = { tools, messages: [{ role: "user", content: "x" }] };
changes = normalizeFeatherlessRequest(body);
assert.equal(changes.textualTools, false);
assert.equal(body.tools, tools);

// ── no tools: pictures are kept ──
body = { messages: [{ role: "user", content: [{ type: "text", text: "look" }, picture] }] };
changes = normalizeFeatherlessRequest(body);
assert.equal(changes.textualTools, false);
assert.equal(body.messages[0].content.length, 2);

// ── tools and a thinking switch: the switch becomes an effort, other template options stay ──
body = {
  tools,
  messages: [{ role: "user", content: "x" }],
  chat_template_kwargs: { enable_thinking: false, date_string: "1 May" },
};
changes = normalizeFeatherlessRequest(body);
assert.equal(changes.movedThinkingSwitch, true);
assert.equal(body.reasoning_effort, "none");
assert.deepEqual(body.chat_template_kwargs, { date_string: "1 May" });
body = {
  tools,
  messages: [{ role: "user", content: "x" }],
  chat_template_kwargs: { thinking: true },
  reasoning_effort: "low",
};
normalizeFeatherlessRequest(body);
assert.equal(body.reasoning_effort, "low", "an on switch leaves the effort alone");
assert.equal("chat_template_kwargs" in body, false, "an emptied options object is not sent");
body = { tools, messages: [{ role: "user", content: "x" }], chat_template_kwargs: { thinking_budget: 64 } };
normalizeFeatherlessRequest(body);
assert.equal("chat_template_kwargs" in body, false);
// without tools a switch is left alone
body = { messages: [{ role: "user", content: "x" }], chat_template_kwargs: { enable_thinking: false } };
changes = normalizeFeatherlessRequest(body);
assert.equal(changes.movedThinkingSwitch, false);
assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });

// ── a picture request without tools: the efforts that path refuses are mapped ──
body = { messages: [{ role: "user", content: [{ type: "text", text: "look" }, picture] }], reasoning_effort: "none" };
normalizeFeatherlessRequest(body);
assert.equal("reasoning_effort" in body, false);
assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
body = { messages: [{ role: "user", content: [{ type: "text", text: "look" }, picture] }], reasoning_effort: "xhigh" };
normalizeFeatherlessRequest(body);
assert.equal(body.reasoning_effort, "xhigh");

// ── prefill: a final assistant message is continued; a tool-call turn or a user turn is not ──
body = {
  messages: [
    { role: "user", content: "x" },
    { role: "assistant", content: "Once" },
  ],
};
normalizeFeatherlessRequest(body);
assert.equal(body.continue_final_message, true);
assert.equal(body.add_generation_prompt, false);
body = { messages: [{ role: "user", content: "x" }] };
normalizeFeatherlessRequest(body);
assert.equal("continue_final_message" in body, false);
body = {
  tools,
  messages: [
    { role: "user", content: "x" },
    { role: "assistant", content: "", tool_calls: [{ id: "1" }] },
  ],
};
normalizeFeatherlessRequest(body);
assert.equal("continue_final_message" in body, false);
body = {
  messages: [
    { role: "user", content: "x" },
    { role: "assistant", content: "Once" },
  ],
  continue_final_message: false,
};
normalizeFeatherlessRequest(body);
assert.equal(body.continue_final_message, false, "a Custom Parameter wins");

// ── the max_tokens that fits after a size refusal ──
assert.equal(
  featherlessFittingMaxTokens(
    "Request exceeds model context window for 'X'. Your prompt is at least 24769 tokens; with max_tokens=8000 the request exceeds the model's context size of 32768 tokens. Shorten the prompt or lower max_tokens.",
  ),
  32768 - 24769 - 64,
);
assert.equal(
  featherlessFittingMaxTokens(
    "max_tokens=32768 leaves no room for the prompt in the model's context size of 32768 tokens for 'X'. Set max_tokens below 32768, leaving room for the prompt.",
  ),
  16384,
);
assert.equal(
  featherlessFittingMaxTokens(
    "Your prompt is at least 32700 tokens; with max_tokens=2000 the request exceeds the model's context size of 32768 tokens.",
  ),
  null,
  "no room for a reply",
);
assert.equal(featherlessFittingMaxTokens("The model is cold."), null);

// ── a model entry as the picker gets it ──
const entry = {
  id: "Owner/Model-27B",
  context_length: 32768,
  max_completion_tokens: 32768,
  features: { tool_use: true, image_input: true },
};
let shaped = shapeFeatherlessModel(entry, null)!;
assert.equal(shaped.context_length, 32768);
assert.equal("max_completion_tokens" in shaped, false, "a whole-window max output is not an output limit");
assert.deepEqual(shaped.input_modalities, ["text", "image"]);
shaped = shapeFeatherlessModel({ ...entry, context_length: 262144 }, null)!;
assert.equal(shaped.max_completion_tokens, 32768, "a real output limit is kept");
shaped = shapeFeatherlessModel({ ...entry, context_length: 262144, features: { tool_use: true } }, 49152)!;
assert.equal(shaped.context_length, 49152, "the plan's context cap wins over the model's");
assert.deepEqual(shaped.input_modalities, ["text"]);
assert.equal(shapeFeatherlessModel({ ...entry, available_on_current_plan: false }, null), null);
assert.equal(shapeFeatherlessModel({ context_length: 1 }, null), null, "no id, no entry");

// ── the Connection test line ──
const plan = { name: "Request Pricing", maxContextLength: null, concurrency: 100, credits: 9.7354 };
const warm = {
  status: "active",
  tier: "warm",
  context: 32768,
  tools: true,
  images: true,
  gated: false,
  onPlan: true,
  concurrencyCost: 2,
};
let line = describeFeatherlessTest("Owner/Model", warm, plan, 32768);
assert.equal(line.ok, true);
assert.equal(
  line.message,
  "Connection successful. Owner/Model: 32,768 tokens of context, tools, reads pictures, 2 concurrent units per request. Plan: Request Pricing, 100 concurrent units, $9.74 credit.",
);
line = describeFeatherlessTest("Owner/Model", { ...warm, tier: "cold", tools: false, gated: true }, null, 128000);
assert.equal(line.ok, true);
for (const expected of [
  "cold",
  "gated on Hugging Face",
  "no native tool calling",
  "set to 128,000 tokens but the model takes 32,768",
]) {
  assert.ok(line.message.includes(expected), `test line lacks: ${expected}`);
}
assert.equal(describeFeatherlessTest("Owner/Nope", null, plan, null).ok, false);
assert.equal(describeFeatherlessTest("Owner/Model", { ...warm, onPlan: false }, plan, null).ok, false);
assert.equal(describeFeatherlessTest("Owner/Model", { ...warm, status: "not_deployed" }, plan, null).ok, false);
assert.equal(describeFeatherlessTest("", null, plan, null).ok, true, "no model chosen yet: only the key is tested");

// ── balance ──
assert.equal(connectionBalanceSource({ provider: "featherless" }), "featherless");
assert.equal(connectionBalanceSource({ provider: "custom", baseUrl: "https://api.featherless.ai/v1" }), "featherless");
assert.equal(connectionBalanceSource({ provider: "custom", baseUrl: "https://example.com/v1" }), null);
assert.equal(parseFeatherlessPlan({ credits: "50.00" })!.left, 50);
assert.equal(parseFeatherlessPlan({ credits: null }), null, "a flat plan has no balance");

process.stdout.write("Featherless regression passed.\n");
