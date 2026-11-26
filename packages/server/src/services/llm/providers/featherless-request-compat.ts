// ──────────────────────────────────────────────
// Featherless request rules
// ──────────────────────────────────────────────
// Featherless serves a request two ways. A plain text request goes through the model's own chat
// template, which carries the tool definitions and call format and parses the calls back out. A
// request with a picture in it, or with a thinking switch in `chat_template_kwargs`, goes another
// way that leaves all of that out and returns no tool calls: the model then invents tool names or
// writes the result itself. The model can still do both at once, so on a picture request the tools
// are written into the prompt here and the calls are read back from the reply text. Each rule below
// was observed against api.featherless.ai on 2026-11-26 with Qwen3.8-class models; none of it is in
// Featherless's documentation.

/** Whether a base URL is Featherless's own API. */
export function isFeatherlessBaseUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "featherless.ai" || hostname.endsWith(".featherless.ai");
  } catch {
    return false;
  }
}

/** Shown in Featherless's own request analytics; they ask integrations to send both. */
export const FEATHERLESS_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = {
  "HTTP-Referer": "https://github.com/Pasta-Devs/Marinara-Engine",
  "X-Title": "Marinara Engine",
};

/** `chat_template_kwargs` keys that switch thinking, all read as the same switch by Featherless. */
const THINKING_SWITCH_KEYS = ["enable_thinking", "thinking", "do_reasoning"] as const;

type WireMessage = Record<string, unknown> & { role?: string; content?: unknown; tool_calls?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * The `reasoning_effort` Featherless takes for an engine effort. Its Qwen templates know `low` and `xhigh`
 * by name, think plainly on `medium` and `high`, and stop thinking on `none`.
 */
export function featherlessReasoningEffort(effort: string | null | undefined): string | undefined {
  if (!effort) return undefined;
  if (effort === "max" || effort === "maximum") return "xhigh";
  return ["none", "low", "medium", "high", "xhigh"].includes(effort) ? effort : undefined;
}

function hasPicture(message: WireMessage): boolean {
  return Array.isArray(message.content) && message.content.some((part) => isRecord(part) && part.type === "image_url");
}

/** Add text to a message's content, whether that is a string, a list of parts, or nothing yet. */
function withText(content: unknown, text: string, where: "before" | "after"): unknown {
  if (Array.isArray(content)) {
    const part = { type: "text", text };
    return where === "before" ? [part, ...content] : [...content, part];
  }
  const own = typeof content === "string" ? content : "";
  if (!own.trim()) return text;
  return where === "before" ? `${text}\n\n${own}` : `${own}\n${text}`;
}

/** One call as reply text, in the format the tool block below asks for. */
function textualCall(call: unknown): string {
  const fn = isRecord(call) && isRecord(call.function) ? call.function : {};
  let args: unknown = fn.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      // Arguments that never were JSON go back as the model wrote them.
    }
  }
  return `<tool_call>\n${JSON.stringify({ name: fn.name, arguments: args ?? {} })}\n</tool_call>`;
}

/** The tool definitions and call format as prompt text: the Hermes block most tool-trained open models know. */
function textualToolBlock(tools: unknown[], toolChoice: unknown): string {
  const named = isRecord(toolChoice) && isRecord(toolChoice.function) ? toolChoice.function.name : null;
  const must =
    typeof named === "string"
      ? `\n\nYou must call the function ${named} in this reply.`
      : toolChoice === "required"
        ? "\n\nYou must call at least one function in this reply."
        : "";
  return `# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
${tools.map((tool) => JSON.stringify(tool)).join("\n")}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{"name": <function-name>, "arguments": <args-json-object>}
</tool_call>

Write any words before the calls, never after them. Each result comes back in the next message inside <tool_response></tool_response> tags; never write one yourself.${must}`;
}

/**
 * Move a request's tools out of the protocol and into the prompt: the definitions go on top of the system
 * prompt, earlier calls become reply text, and their results become a user turn. Mutates `body`.
 */
function moveToolsIntoPrompt(body: Record<string, unknown>, messages: WireMessage[]): void {
  const block = textualToolBlock(body.tools as unknown[], body.tool_choice);
  const moved: WireMessage[] = [];
  const resultTurns = new Set<WireMessage>();
  for (const message of messages) {
    if (message.role === "tool") {
      const result = Array.isArray(message.content)
        ? [{ type: "text", text: "<tool_response>" }, ...message.content, { type: "text", text: "</tool_response>" }]
        : `<tool_response>\n${typeof message.content === "string" ? message.content : ""}\n</tool_response>`;
      const previous = moved.at(-1);
      // Results of one round share a user turn, as the model's own template writes them.
      if (previous && resultTurns.has(previous) && typeof previous.content === "string" && typeof result === "string") {
        previous.content = `${previous.content}\n${result}`;
      } else {
        moved.push({ role: "user", content: result });
        resultTurns.add(moved.at(-1)!);
      }
      continue;
    }
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const { tool_calls: calls, ...rest } = message;
      moved.push({
        ...rest,
        content: withText(rest.content, (calls as unknown[]).map(textualCall).join("\n"), "after"),
      });
      continue;
    }
    moved.push(message);
  }
  const systemAt = moved.findIndex((message) => message.role === "system");
  if (systemAt < 0) moved.unshift({ role: "system", content: block });
  else moved[systemAt] = { ...moved[systemAt], content: withText(moved[systemAt]!.content, block, "before") };
  body.messages = moved;
  delete body.tools;
  delete body.tool_choice;
  delete body.parallel_tool_calls;
}

export interface FeatherlessRequestChanges {
  /** The tools went into the prompt because the request carries pictures; the calls come back as reply text. */
  textualTools: boolean;
  /** A thinking switch in `chat_template_kwargs` was replaced by `reasoning_effort`. */
  movedThinkingSwitch: boolean;
}

/**
 * Shape a Chat Completions body for Featherless, after Custom Parameters. Mutates `body`.
 *
 * - Tools and pictures together: the tools are written into the prompt, since a picture request is served
 *   without them. The caller reads the calls back from the reply text.
 * - Tools without pictures: `chat_template_kwargs` thinking switches are taken out, because one silently costs
 *   the request its tools. A switch that turned thinking off becomes `reasoning_effort: "none"`, which does the
 *   same without that cost.
 * - A picture request refuses the efforts `none`, `minimal` and `max`; there the template switch is what
 *   turns thinking off.
 * - A final assistant message is continued instead of answered.
 */
export function normalizeFeatherlessRequest(body: Record<string, unknown>): FeatherlessRequestChanges {
  const changes: FeatherlessRequestChanges = { textualTools: false, movedThinkingSwitch: false };
  const messages = Array.isArray(body.messages) ? (body.messages as WireMessage[]) : [];
  const hasPictures = messages.some(hasPicture);
  const kwargs = isRecord(body.chat_template_kwargs) ? { ...body.chat_template_kwargs } : null;

  if (hasPictures && Array.isArray(body.tools) && body.tools.length > 0) {
    moveToolsIntoPrompt(body, messages);
    changes.textualTools = true;
  }

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    if (kwargs) {
      let thinkingOff = false;
      for (const key of [...THINKING_SWITCH_KEYS, "thinking_budget"]) {
        if (!(key in kwargs)) continue;
        if (kwargs[key] === false) thinkingOff = true;
        delete kwargs[key];
        changes.movedThinkingSwitch = true;
      }
      // Off wins over any effort, as it does when Featherless reads conflicting switches.
      if (thinkingOff) body.reasoning_effort = "none";
    }
  } else if (hasPictures) {
    const effort = body.reasoning_effort;
    if (effort === "none") {
      delete body.reasoning_effort;
      body.chat_template_kwargs = { ...(kwargs ?? {}), enable_thinking: false };
      return finishPrefill(body, changes);
    }
    if (effort === "minimal") body.reasoning_effort = "low";
    if (effort === "max") body.reasoning_effort = "xhigh";
  }

  if (kwargs) {
    if (Object.keys(kwargs).length) body.chat_template_kwargs = kwargs;
    else delete body.chat_template_kwargs;
  }
  return finishPrefill(body, changes);
}

/** A final assistant message is a prefill: ask for its continuation, not a new turn after it. */
function finishPrefill(body: Record<string, unknown>, changes: FeatherlessRequestChanges): FeatherlessRequestChanges {
  const last = Array.isArray(body.messages) ? (body.messages.at(-1) as WireMessage | undefined) : undefined;
  const hasCalls = Array.isArray(last?.tool_calls) && last.tool_calls.length > 0;
  if (last?.role === "assistant" && !hasCalls && typeof last.content === "string" && last.content.trim()) {
    if (body.continue_final_message === undefined) body.continue_final_message = true;
    if (body.add_generation_prompt === undefined) body.add_generation_prompt = false;
  }
  return changes;
}

/**
 * The `max_tokens` that fits after Featherless refused a request for its size. Unlike its documentation says,
 * a prompt plus `max_tokens` over the model's context is refused, not lowered. Its error names the prompt's
 * real size, so one retry with what is left can succeed. null when the prompt leaves no room for a reply.
 */
export function featherlessFittingMaxTokens(errorText: string): number | null {
  const prompt = /prompt is at least (\d+) tokens/i.exec(errorText);
  const context = /context size of (\d+) tokens/i.exec(errorText);
  if (!context) return null;
  const window = Number(context[1]);
  // "leaves no room for the prompt" names no prompt size; half the window is the largest safe guess.
  const fitting = prompt ? window - Number(prompt[1]) - 64 : Math.floor(window / 2);
  return Number.isFinite(fitting) && fitting >= 256 ? fitting : null;
}
