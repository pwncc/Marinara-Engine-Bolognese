import type { LLMToolCall, LLMToolDefinition } from "./base-provider.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toolCallId(index: number): string {
  return `text_tool_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  return parseJsonishObject(value) ?? {};
}

function parseJsonishObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    trimmed
      .replace(/([{,]\s*)([A-Za-z_][\w.-]*)\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*)'/g, (_, inner: string) => `: ${JSON.stringify(inner)}`),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return isRecord(parsed) ? parsed : null;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function rawToolCalls(payload: Record<string, unknown>): unknown[] {
  const plural = payload.tool_calls ?? payload.toolCalls ?? payload.calls;
  if (Array.isArray(plural)) return plural;
  const single = payload.tool_call ?? payload.toolCall;
  if (single) return [single];
  if (typeof payload.name === "string" || typeof payload.tool === "string" || typeof payload.command === "string") {
    return [payload];
  }
  return [];
}

function parseTaggedSnippets(content: string): string[] {
  const snippets: string[] = [];
  const patterns = [
    /<\|tool_call\|?>([\s\S]*?)(?:<tool_call\|>|<\|\/tool_call\|>|<\/tool_call>|$)/gi,
    /<tool_call>([\s\S]*?)(?:<\/tool_call>|<\/arg_value>|$)/gi,
    /<tool_code>([\s\S]*?)<\/tool_code>/gi,
    /```(?:json)?\s*([\s\S]*?)\s*```/gi,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const snippet = match[1]?.trim();
      if (snippet) snippets.push(snippet);
    }
  }
  const trimmed = content.trim();
  if (/^(?:call\s*:\s*)?[A-Za-z_][\w.-]*\s*\{[\s\S]*\}$/.test(trimmed)) snippets.push(trimmed);
  return snippets;
}

function snippetToPayload(snippet: string): Record<string, unknown> | null {
  const jsonPayload = parseJsonishObject(snippet);
  if (jsonPayload) {
    return typeof jsonPayload.name === "string" || typeof jsonPayload.tool === "string"
      ? jsonPayload
      : { name: "mari_db", arguments: jsonPayload };
  }
  const callMatch = snippet.trim().match(/^(?:call\s*:\s*)?([A-Za-z_][\w.-]*)\s*(\{[\s\S]*\})\s*$/);
  if (!callMatch) {
    const command = normalizeMariCommand(snippet);
    return command ? { name: "mari_db", arguments: { command } } : null;
  }
  const name = callMatch[1];
  const argsText = callMatch[2];
  if (!name || !argsText) return null;
  return {
    name,
    arguments: parseJsonishObject(argsText) ?? {},
  };
}

function normalizeMariCommand(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const command = raw.replace(/^\$+\s*/, "");
  if (command.length > 800 || /[\r\n]/.test(command) || /[;&|`$<>]/.test(command)) return null;
  if (/^mari(?:\s|$)/i.test(command)) return command;
  if (/^[A-Za-z][\w-]*(?:\s+[A-Za-z0-9_.:-]+)*$/.test(command)) return `mari ${command}`;
  return null;
}

function toolCallFromRaw(
  raw: unknown,
  index: number,
  knownTools: Set<string>,
  hasBashTool: boolean,
): LLMToolCall | null {
  if (!isRecord(raw)) return null;
  const nameValue = raw.name ?? raw.tool;
  if (typeof nameValue !== "string") return null;
  const name = nameValue.trim();
  const args = normalizeArguments(raw.arguments ?? raw.args ?? raw.input ?? {});
  if (knownTools.has(name)) {
    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : toolCallId(index),
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    };
  }

  const normalizedName = name.toLowerCase().replace(/[-.]/g, "_");
  if (!hasBashTool || !["mari", "mari_cli", "mari_command", "mari_db"].includes(normalizedName)) return null;
  const command = normalizeMariCommand(args.command ?? args.cmd ?? args.query ?? args.input ?? args.text ?? raw.command);
  return command
    ? {
        id: toolCallId(index),
        type: "function",
        function: { name: "bash", arguments: JSON.stringify({ command }) },
      }
    : null;
}

export function parseTextualToolCalls(content: string | null | undefined, tools: LLMToolDefinition[] = []): LLMToolCall[] {
  if (!content || tools.length === 0) return [];
  const knownTools = new Set(tools.map((tool) => tool.function.name));
  const hasBashTool = knownTools.has("bash");
  const calls: LLMToolCall[] = [];

  const wholePayload = parseJsonishObject(content);
  if (wholePayload) {
    rawToolCalls(wholePayload).forEach((raw, index) => {
      const call = toolCallFromRaw(raw, index, knownTools, hasBashTool);
      if (call) calls.push(call);
    });
  }
  if (calls.length > 0) return calls;

  parseTaggedSnippets(content).forEach((snippet, index) => {
    const payload = snippetToPayload(snippet);
    const call = toolCallFromRaw(payload, index, knownTools, hasBashTool);
    if (call) calls.push(call);
  });
  return calls;
}
