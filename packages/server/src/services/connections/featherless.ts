// ──────────────────────────────────────────────
// Featherless: the model list a plan can use, and what a model can do
// ──────────────────────────────────────────────
// Endpoints (https://featherless.ai/docs/api-reference-models and /api-reference-plan):
//   GET /v1/models                  the account's pinned models, or the 50 trending ones
//   GET /v1/models?…                the whole catalogue, filtered and sorted
//   GET /v1/models/{owner}/{model}  one model, with live warm/cold state
//   GET /v1/plan                    the plan's context cap, concurrency and credits
import { safeFetch, type SafeFetchOptions } from "../../utils/security.js";

type Fetch = (url: string, init: SafeFetchOptions) => Promise<Response>;

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

/** `https://api.featherless.ai` for any Featherless base URL. */
function featherlessOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "https://api.featherless.ai";
  }
}

async function getJson(fetchImpl: Fetch, url: string, headers: Record<string, string>): Promise<Json | null> {
  try {
    const response = await fetchImpl(url, {
      headers,
      maxResponseBytes: 5 * 1024 * 1024,
      decodeCompressedResponse: true,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return record(JSON.parse(await response.text()));
  } catch {
    return null;
  }
}

export interface FeatherlessPlan {
  name: string;
  /** Tokens a request may hold on this plan; null when the plan sets no cap of its own. */
  maxContextLength: number | null;
  concurrency: number | null;
  /** Prepaid credit in USD on Pay-As-You-Go; null on a flat plan. */
  credits: number | null;
}

/** The plan the key belongs to, or null when Featherless does not answer. */
export async function readFeatherlessPlan(
  baseUrl: string,
  headers: Record<string, string>,
  fetchImpl: Fetch = safeFetch,
): Promise<FeatherlessPlan | null> {
  const json = await getJson(fetchImpl, `${featherlessOrigin(baseUrl)}/v1/plan`, headers);
  if (!json) return null;
  const credits = typeof json.credits === "string" || typeof json.credits === "number" ? Number(json.credits) : NaN;
  return {
    name: typeof json.name === "string" ? json.name : "",
    maxContextLength: positive(json.max_context_length) ?? null,
    concurrency: positive(json.concurrency) ?? null,
    credits: Number.isFinite(credits) ? credits : null,
  };
}

/**
 * One Featherless model entry in the shape the generic OpenAI-compatible reader takes.
 * - The context is the smaller of the model's and the plan's: a request over the plan's cap is refused.
 * - Featherless lists most models' max output as their whole context. That is no output limit, so it is left
 *   out; kept, picking the model would set the Connection's max output to the whole window.
 * - `features.image_input` says whether the model reads pictures.
 */
export function shapeFeatherlessModel(model: Json, planContext: number | null): Json | null {
  const id = typeof model.id === "string" ? model.id : "";
  if (!id || model.available_on_current_plan === false) return null;
  const ownContext = positive(model.context_length);
  const context = ownContext && planContext ? Math.min(ownContext, planContext) : (ownContext ?? planContext);
  const maxOutput = positive(model.max_completion_tokens);
  const { max_completion_tokens: _maxOutput, context_length: _context, ...rest } = model;
  return {
    ...rest,
    id,
    name: id,
    ...(context ? { context_length: context } : {}),
    ...(maxOutput && context && maxOutput < context ? { max_completion_tokens: maxOutput } : {}),
    input_modalities: record(model.features)?.image_input === true ? ["text", "image"] : ["text"],
  };
}

/**
 * The models to offer: the account's pinned ones first (Featherless returns those, or the trending 50, to a plain
 * request), then the most popular thousand the plan can use. null when neither list could be read, so the caller
 * reports the provider's own error.
 */
export async function listFeatherlessModels(
  baseUrl: string,
  headers: Record<string, string>,
  fetchImpl: Fetch = safeFetch,
): Promise<Json[] | null> {
  const base = baseUrl.replace(/\/+$/, "");
  const [plan, pinned, popular] = await Promise.all([
    readFeatherlessPlan(baseUrl, headers, fetchImpl),
    getJson(fetchImpl, `${base}/models`, headers),
    getJson(fetchImpl, `${base}/models?available_on_current_plan=true&sort=-popularity&per_page=1000`, headers),
  ]);
  if (!pinned && !popular) return null;
  const seen = new Set<string>();
  const models: Json[] = [];
  for (const list of [pinned, popular]) {
    for (const entry of Array.isArray(list?.data) ? list.data : []) {
      const shaped = record(entry) ? shapeFeatherlessModel(entry as Json, plan?.maxContextLength ?? null) : null;
      if (!shaped || seen.has(String(shaped.id))) continue;
      seen.add(String(shaped.id));
      models.push(shaped);
    }
  }
  return models;
}

export interface FeatherlessModelStatus {
  /** `active`, `pending_deploy` or `not_deployed`. */
  status: string;
  /** `warm`, `loading`, `cold`, `offline` or `unknown`. */
  tier: string;
  /** Tokens a request may hold: the model's context, capped by the plan. */
  context: number | null;
  tools: boolean;
  images: boolean;
  gated: boolean;
  onPlan: boolean;
  concurrencyCost: number | null;
}

/** What one model can do right now, or null when Featherless does not know the id. */
export async function readFeatherlessModelStatus(
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
  planContext: number | null,
  fetchImpl: Fetch = safeFetch,
): Promise<FeatherlessModelStatus | null> {
  const id = model.trim();
  if (!id) return null;
  // Model ids are `owner/model`; each part is encoded on its own so the slash stays a path separator.
  const path = id.split("/").map(encodeURIComponent).join("/");
  const json = await getJson(fetchImpl, `${baseUrl.replace(/\/+$/, "")}/models/${path}`, headers);
  if (!json || typeof json.id !== "string") return null;
  const features = record(json.features);
  const ownContext = positive(json.context_length);
  return {
    status: typeof json.status === "string" ? json.status : "unknown",
    tier: String(record(json.availability)?.tier ?? "unknown"),
    context: ownContext && planContext ? Math.min(ownContext, planContext) : (ownContext ?? planContext),
    tools: features?.tool_use === true,
    images: features?.image_input === true,
    gated: json.is_gated === true,
    onPlan: json.available_on_current_plan !== false,
    concurrencyCost: positive(json.concurrency_cost) ?? null,
  };
}

/**
 * The line a Connection test shows for a Featherless model: what it can do, and what will go wrong if the
 * Connection is left as it is. `ok` is false only when the model cannot answer at all.
 */
export function describeFeatherlessTest(
  model: string,
  status: FeatherlessModelStatus | null,
  plan: FeatherlessPlan | null,
  connectionContext: number | null,
): { ok: boolean; message: string } {
  const planLine = plan
    ? ` Plan: ${plan.name || "Featherless"}${plan.concurrency ? `, ${plan.concurrency} concurrent units` : ""}${
        plan.credits !== null ? `, $${plan.credits.toFixed(2)} credit` : ""
      }.`
    : "";
  if (!model.trim()) return { ok: true, message: `Connection successful.${planLine}` };
  if (!status) {
    return { ok: false, message: `Featherless has no model named ${model}. Check the model ID.${planLine}` };
  }
  if (!status.onPlan) {
    return { ok: false, message: `${model} is not included in this plan.${planLine}` };
  }
  if (status.status !== "active") {
    return { ok: false, message: `${model} is not deployed on Featherless right now (${status.status}).${planLine}` };
  }
  const notes: string[] = [];
  if (status.tier === "cold" || status.tier === "loading") {
    notes.push("The model is cold, so the first reply waits for it to load");
  } else if (status.tier === "offline") {
    notes.push("The model is offline right now");
  }
  if (status.gated) notes.push("It is gated on Hugging Face: unlock it on its Featherless model page first");
  if (!status.tools) notes.push("It has no native tool calling, so tools and REagent will not work with it");
  if (status.context && connectionContext && connectionContext > status.context) {
    notes.push(
      `This Connection's context is set to ${connectionContext.toLocaleString("en-US")} tokens but the model takes ${status.context.toLocaleString("en-US")}: lower it, or long chats will be refused`,
    );
  }
  const can = [
    status.context ? `${status.context.toLocaleString("en-US")} tokens of context` : "",
    status.tools ? "tools" : "",
    status.images ? "reads pictures" : "",
    status.concurrencyCost
      ? `${status.concurrencyCost} concurrent unit${status.concurrencyCost === 1 ? "" : "s"} per request`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    ok: true,
    message: `Connection successful. ${model}: ${can}.${notes.length ? ` ${notes.join(". ")}.` : ""}${planLine}`,
  };
}
