// ──────────────────────────────────────────────
// Featherless request rules
// ──────────────────────────────────────────────
// Featherless serves a request two ways. A plain text request goes through the model's own chat
// template, which carries the tool-call instructions and parses the calls back out. A request
// with a picture in it, or with a thinking switch in `chat_template_kwargs`, goes another way that
// leaves those instructions out and returns no tool calls: the model then invents tool names or
// writes the result itself. Each rule below was observed against api.featherless.ai on
// 2026-11-26 with Qwen3.8-class models; none of it is in Featherless's documentation.

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

/** Take the pictures out of a message; a text-only result goes back to a plain string. */
function withoutImages(message: WireMessage): { message: WireMessage; removed: number } {
  if (!Array.isArray(message.content)) return { message, removed: 0 };
  const kept = message.content.filter((part) => !(isRecord(part) && part.type === "image_url"));
  const removed = message.content.length - kept.length;
  if (!removed) return { message, removed: 0 };
  const textOnly = kept.every((part) => isRecord(part) && part.type === "text" && typeof part.text === "string");
  return {
    message: {
      ...message,
      content: textOnly ? kept.map((part) => (part as { text: string }).text).join("\n") : kept,
    },
    removed,
  };
}

export interface FeatherlessRequestChanges {
  /** Pictures left out so the tools keep working. */
  droppedImages: number;
  /** A thinking switch in `chat_template_kwargs` was replaced by `reasoning_effort`. */
  movedThinkingSwitch: boolean;
}

/**
 * Shape a Chat Completions body for Featherless, after Custom Parameters. Mutates `body`.
 *
 * - With tools, pictures and `chat_template_kwargs` thinking switches are taken out, because either one
 *   silently costs the request its tools. A switch that turned thinking off becomes `reasoning_effort: "none"`,
 *   which does the same without that cost.
 * - Without tools, a picture request refuses the efforts `none`, `minimal` and `max`; there the template
 *   switch is what turns thinking off.
 * - A final assistant message is continued instead of answered.
 */
export function normalizeFeatherlessRequest(body: Record<string, unknown>): FeatherlessRequestChanges {
  const changes: FeatherlessRequestChanges = { droppedImages: 0, movedThinkingSwitch: false };
  const messages = Array.isArray(body.messages) ? (body.messages as WireMessage[]) : [];
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const kwargs = isRecord(body.chat_template_kwargs) ? { ...body.chat_template_kwargs } : null;

  if (hasTools) {
    body.messages = messages.map((message) => {
      const stripped = withoutImages(message);
      changes.droppedImages += stripped.removed;
      return stripped.message;
    });
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
  } else if (messages.some((message) => withoutImages(message).removed > 0)) {
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
