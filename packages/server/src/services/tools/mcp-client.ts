import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

export const mcpToolConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  toolName: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

export const importMcpToolsSchema = mcpToolConfigSchema
  .omit({ toolName: true })
  .extend({
    prefix: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    includeTools: z.array(z.string()).optional(),
  });

export type McpToolConfig = z.infer<typeof mcpToolConfigSchema>;
export type ImportMcpToolsInput = z.infer<typeof importMcpToolsSchema>;

export interface McpListedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export async function listMcpTools(config: ImportMcpToolsInput): Promise<McpListedTool[]> {
  return withMcpClient(config, async (client) => {
    const result = await client.listTools();
    const include = config.includeTools ? new Set(config.includeTools) : null;
    return (result.tools ?? [])
      .filter((tool) => (include ? include.has(tool.name) : true))
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? `MCP tool ${tool.name}`,
        inputSchema: normalizeToolInputSchema(tool.inputSchema),
      }));
  });
}

export async function callMcpTool(config: McpToolConfig, args: Record<string, unknown>): Promise<unknown> {
  const toolName = config.toolName;
  if (!toolName) return { error: "MCP custom tool is missing toolName in scriptBody config." };

  return withMcpClient(config, async (client) => {
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return normalizeToolResult(result);
  });
}

function normalizeToolInputSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const objectSchema = schema as Record<string, unknown>;
  return {
    type: "object",
    properties:
      objectSchema.properties && typeof objectSchema.properties === "object" && !Array.isArray(objectSchema.properties)
        ? objectSchema.properties
        : {},
    ...(Array.isArray(objectSchema.required) ? { required: objectSchema.required } : {}),
  };
}

function normalizeToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  const content = record.content;
  if (!Array.isArray(content)) return result;

  const textParts = content
    .map((part) => {
      if (!part || typeof part !== "object") return null;
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string" ? item.text : null;
    })
    .filter((part): part is string => Boolean(part));

  if (textParts.length === 1) {
    try {
      return JSON.parse(textParts[0]!);
    } catch {
      return { result: textParts[0] };
    }
  }
  if (textParts.length > 1) return { result: textParts.join("\n\n") };
  return result;
}

async function withMcpClient<T>(
  config: Pick<McpToolConfig, "command" | "args" | "cwd" | "env" | "timeoutMs">,
  callback: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: "marinara-engine", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    env: mergeEnv(config.env),
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    return await withTimeout(callback(client), config.timeoutMs ?? 60_000);
  } finally {
    await client.close();
  }
}

function mergeEnv(overrides?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...(overrides ?? {}) };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`MCP tool timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
