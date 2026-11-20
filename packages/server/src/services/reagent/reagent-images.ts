// ──────────────────────────────────────────────
// REagent image tools: the writer draws through the chat's image connection,
// looks at each draft as a real input, redraws until it is right, and only
// what it sends is attached to the reply. Drafts are plain files under
// `images/` in the chat workspace, each with a sidecar recording how it was made.
// ──────────────────────────────────────────────

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  buildChatImageGenerationRecord,
  createDefaultImageGenerationProfile,
  imageSourceToDefaultsService,
  resolveImageBackend,
  NOVELAI_NOISE_SCHEDULE_OPTIONS,
  NOVELAI_SAMPLER_OPTIONS,
  type ImageGenRequest,
  type ImageGenerationDefaultsProfile,
  type ImagePreciseReference,
  type ReagentSettings,
  type SceneIllustrationCharacterPrompt,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { isAllowedImageBuffer } from "../../utils/security.js";
import { readAvatarBase64 } from "../game/game-asset-generation.js";
import { resolveImageConnectionFallback } from "../generation/media-connection-fallback.js";
import { isNativeNovelAiHost, resolveNovelAiCharacterPromptLimit } from "../image/character-prompts.js";
import { resolveStoredGalleryFile } from "../image/gallery-file-lifecycle.js";
import { resolveConnectionImageDefaults, resolveConnectionImageQuality } from "../image/image-generation-defaults.js";
import { loadImageGenerationUserSettings, resolveIllustratorImageSize } from "../image/image-generation-settings.js";
import {
  generateImage,
  imageConnectionTakesReferencePicture,
  isNovelAiPreciseReferenceModel,
  saveImageToDisk,
} from "../image/image-generation.js";
import { readPreferredCharacterReferenceImage } from "../image/illustrator-references.js";
import { optimizeNoodleVisionImage } from "../noodle/noodle-vision.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import { createGalleryStorage } from "../storage/gallery.storage.js";
import { classifyFileKind, resolveReagentPath } from "./reagent-workspace.js";

export const REAGENT_IMAGES_DIR = "images";
/** ponytail: fixed caps per reply; make them chat settings if a provider's price or speed calls for it. */
export const REAGENT_MAX_DRAFTS_PER_REPLY = 6;
export const REAGENT_MAX_SENT_PER_REPLY = 4;
const MAX_KEPT_DRAFTS = 40;
const MAX_REFERENCES = 6;

export type ReagentImageDialect =
  "novelai-v3" | "novelai-v4" | "novelai-v5" | "sd-anime" | "sd-pony" | "sd-prose" | "sd" | "prose";

export interface ReagentImagePerson {
  id?: string;
  name: string;
  avatarPath?: string | null;
}

export interface ReagentImageContext {
  db: DB;
  chatId: string;
  chatMeta: Record<string, unknown>;
  workspaceDir: string;
  settings: ReagentSettings;
  /** People whose picture can serve as a reference: the chat's cards and tracker rows. */
  people: ReagentImagePerson[];
  persona: { name: string; avatarPath?: string | null } | null;
  signal?: AbortSignal;
  debugMode?: boolean;
  /** A draft the writer chose for the reply. */
  onSend: (draft: ReagentImageDraft) => void;
  /** Test seam for the provider call. */
  draw?: typeof generateImage;
  /** Test seam: the image connections with their keys, the chat's own first. */
  connectionRows?: ReagentImageConnectionRow[];
}

/** How a draft was made, stored beside it as `<file>.json`. */
export interface ReagentImageDraft {
  /** Workspace-relative path of the picture. */
  path: string;
  prompt: string;
  negativePrompt: string;
  connectionId: string;
  connectionName: string;
  provider: string;
  model: string;
  width: number;
  height: number;
  seed: number | null;
  characterPrompts?: SceneIllustrationCharacterPrompt[];
  at: string;
  /** Gallery id once it was sent with a reply. */
  sentGalleryId?: string;
}

interface ImageToolOutcome {
  text: string;
  media?: Array<{ kind: "image"; name: string; dataUrl: string; mimeType: string }>;
}

export type ReagentImageConnectionRow = ConnectionRow;
type ConnectionRow = NonNullable<Awaited<ReturnType<ReturnType<typeof createConnectionsStorage>["getWithKey"]>>>;

interface DescribedConnection {
  row: ConnectionRow;
  name: string;
  model: string;
  baseUrl: string;
  serviceHint: string;
  backend: string;
  nativeNovelAi: boolean;
  dialect: ReagentImageDialect;
  defaults: ImageGenerationDefaultsProfile | null;
}

const str = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): number | null => {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// ── What each connection speaks ──

export function resolveReagentImageDialect(
  backend: string,
  model: string,
  nativeNovelAi: boolean,
): ReagentImageDialect {
  const name = model.toLowerCase();
  if (backend === "novelai" && nativeNovelAi) {
    if (/nai-diffusion-5/.test(name)) return "novelai-v5";
    if (/nai-diffusion-4/.test(name)) return "novelai-v4";
    return "novelai-v3";
  }
  const localStableDiffusion = ["comfyui", "swarmui", "automatic1111", "runpod_comfyui", "arli", "horde"].includes(
    backend,
  );
  if (/pony/.test(name)) return "sd-pony";
  if (/illustrious|noob|animagine|wai[-_ ]|\bnai\b|novelai|anime/.test(name)) return "sd-anime";
  if (/flux|qwen|z[-_ ]?image|sd3|chroma|hidream|kontext/.test(name))
    return localStableDiffusion ? "sd-prose" : "prose";
  return localStableDiffusion ? "sd" : "prose";
}

/** The sampler knobs a backend reads, as the tool names them. */
export function reagentImageKnobs(backend: string, nativeNovelAi: boolean): string[] {
  if (backend === "novelai" && nativeNovelAi) {
    return ["seed", "steps", "guidance", "guidance_rescale", "sampler", "scheduler"];
  }
  const service = imageSourceToDefaultsService(backend);
  if (service === "automatic1111" || service === "comfyui")
    return ["seed", "steps", "guidance", "sampler", "scheduler"];
  return [];
}

/**
 * The connection's defaults with this picture's settings on top. A provider only reads the
 * sub-object of its own service, so the profile is rebuilt for that service when it differs.
 */
export function patchReagentImageDefaults(
  base: ImageGenerationDefaultsProfile | null,
  backend: string,
  nativeNovelAi: boolean,
  overrides: {
    seed?: number | null;
    steps?: number | null;
    guidance?: number | null;
    guidanceRescale?: number | null;
    sampler?: string | null;
    scheduler?: string | null;
    denoise?: number | null;
    explicitSize?: boolean;
  },
): ImageGenerationDefaultsProfile | null {
  const service = backend === "novelai" ? (nativeNovelAi ? "novelai" : null) : imageSourceToDefaultsService(backend);
  if (!service) return base;
  const fresh = createDefaultImageGenerationProfile(service);
  const profile: ImageGenerationDefaultsProfile =
    base?.service === service
      ? (structuredClone(base) as ImageGenerationDefaultsProfile)
      : { ...fresh, customParameters: base?.customParameters, styleProfileId: base?.styleProfileId ?? null };
  if (overrides.seed != null) profile.seed = Math.max(0, Math.floor(overrides.seed));
  if (service === "novelai") {
    const novelai = { ...fresh.novelai!, ...profile.novelai };
    if (overrides.steps != null) novelai.steps = clamp(Math.round(overrides.steps), 1, 50);
    if (overrides.guidance != null) novelai.promptGuidance = clamp(overrides.guidance, 0, 10);
    if (overrides.guidanceRescale != null) novelai.promptGuidanceRescale = clamp(overrides.guidanceRescale, 0, 1);
    if (overrides.sampler) novelai.sampler = overrides.sampler;
    if (overrides.scheduler) novelai.noiseSchedule = overrides.scheduler;
    // A size the writer asked for wins over the pick-by-head-count default.
    if (overrides.explicitSize) novelai.dynamicResolutionBySubjectCount = false;
    profile.novelai = novelai;
  } else {
    const key = service === "automatic1111" ? "automatic1111" : "comfyui";
    const current = { ...fresh[key]!, ...profile[key] } as NonNullable<ImageGenerationDefaultsProfile["comfyui"]>;
    if (overrides.steps != null) current.steps = clamp(Math.round(overrides.steps), 1, 150);
    if (overrides.guidance != null) current.cfgScale = clamp(overrides.guidance, 0, 30);
    if (overrides.sampler) current.sampler = overrides.sampler;
    if (overrides.scheduler) current.scheduler = overrides.scheduler;
    if (overrides.denoise != null) current.denoisingStrength = clamp(overrides.denoise, 0.01, 1);
    (profile as unknown as Record<string, unknown>)[key] = current;
  }
  return profile;
}

/** `B2`-style grid cell (columns A-E left to right, rows 1-5 top to bottom) or `{x, y}` in 0-1. */
export function parseReagentImagePosition(value: unknown): { x: number; y: number } | undefined {
  if (isRecord(value)) {
    const x = finite(value.x);
    const y = finite(value.y);
    return x === null || y === null ? undefined : { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }
  const cell = /^\s*([a-e])\s*([1-5])\s*$/i.exec(str(value));
  if (!cell) return undefined;
  const column = cell[1]!.toLowerCase().charCodeAt(0) - 97;
  const row = Number(cell[2]) - 1;
  return { x: 0.1 + column * 0.2, y: 0.1 + row * 0.2 };
}

// ── The guide ──

// NovelAI's own interface adds these: Quality Tags after the prompt and an Undesired Content
// preset before the negative prompt. The API applies neither, so they are added here.
const UC_V3_HEAVY =
  "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]";
const UC_V4_FULL_HEAVY =
  "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page";
const UC_V45_FULL_HEAVY =
  "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page";
const UC_V45_FULL: Record<string, string> = {
  heavy: UC_V45_FULL_HEAVY,
  light:
    "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
  human: `${UC_V45_FULL_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
  furry:
    "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic",
};

export interface NovelAiPresetSet {
  /** What the Quality Tags toggle appends to the prompt. */
  quality: string;
  /** Undesired Content presets by name. */
  negative: Record<string, string>;
}

/** NovelAI's quality tags and Undesired Content presets for a model. */
export function resolveNovelAiPresets(model: string): NovelAiPresetSet {
  const name = model.trim().toLowerCase();
  if (/nai-diffusion-5/.test(name)) {
    // ponytail: V5 reuses the V4.5 Full lists; swap in NovelAI's own V5 presets when their text is known.
    return { quality: "very aesthetic, masterpiece, no text", negative: UC_V45_FULL };
  }
  if (name === "nai-diffusion-4-5-curated") {
    return {
      quality: "location, masterpiece, no text, -0.8::feet::, rating:general",
      negative: {
        heavy:
          "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
        light:
          "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page",
        human:
          "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page",
      },
    };
  }
  if (/nai-diffusion-4-5/.test(name)) {
    return { quality: "location, very aesthetic, masterpiece, no text", negative: UC_V45_FULL };
  }
  if (name === "nai-diffusion-4-curated-preview") {
    return {
      quality: "rating:general, amazing quality, very aesthetic, absurdres",
      negative: {
        heavy:
          "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page",
        light:
          "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page",
      },
    };
  }
  if (/nai-diffusion-4/.test(name)) {
    return {
      quality: "no text, best quality, very aesthetic, absurdres",
      negative: {
        heavy: UC_V4_FULL_HEAVY,
        light:
          "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page",
      },
    };
  }
  return {
    quality: "best quality, amazing quality, very aesthetic, absurdres",
    negative: {
      heavy: UC_V3_HEAVY,
      light: "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing",
      human: `${UC_V3_HEAVY}, bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes`,
    },
  };
}

/** A tag without its emphasis brackets or weight, for telling whether it is already there. */
const bareTag = (tag: string) =>
  tag
    .replace(/-?\d*\.?\d*::/g, "")
    .replace(/[{}[\]]/g, "")
    .trim()
    .toLowerCase();

const splitTags = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

/**
 * The writer's prompts with the presets it asked for: quality tags after the prompt (before a
 * trailing `Text:`, which must stay last), the Undesired Content list before its own negatives.
 * Tags already written, or already in a connection prefix, are not repeated.
 */
export function applyNovelAiPresets(input: {
  model: string;
  prompt: string;
  negativePrompt: string;
  qualityTags: boolean;
  negativePreset: string;
  /** Connection prefixes, which the provider adds later; their tags count as present. */
  promptPrefix?: string;
  negativePromptPrefix?: string;
}): { prompt: string; negativePrompt: string; negativePreset: string } {
  const presets = resolveNovelAiPresets(input.model);
  let prompt = input.prompt;
  if (input.qualityTags) {
    const textAt = prompt.search(/(^|[\s,])Text:/);
    const body = textAt >= 0 ? prompt.slice(0, textAt) : prompt;
    const tail = textAt >= 0 ? prompt.slice(textAt).replace(/^[\s,]+/, "") : "";
    const present = new Set(splitTags(`${input.promptPrefix ?? ""},${body}`).map(bareTag));
    const added = splitTags(presets.quality).filter(
      // `no text` in the quality tags works against words the picture is meant to show.
      (tag) => !present.has(bareTag(tag)) && !(tail && bareTag(tag) === "no text"),
    );
    const joined = [body.trim().replace(/,\s*$/, ""), ...added].filter(Boolean).join(", ");
    prompt = tail ? `${joined}, ${tail}` : joined;
  }
  const wanted = input.negativePreset
    .trim()
    .toLowerCase()
    .replace(/[\s_-]*focus$/, "");
  const negativePreset = wanted === "none" ? "none" : presets.negative[wanted] ? wanted : "heavy";
  let negativePrompt = input.negativePrompt;
  if (negativePreset !== "none") {
    const present = new Set(splitTags(`${input.negativePromptPrefix ?? ""},${negativePrompt}`).map(bareTag));
    const added = splitTags(presets.negative[negativePreset]!).filter((tag) => !present.has(bareTag(tag)));
    negativePrompt = [...added, negativePrompt.trim()].filter(Boolean).join(", ");
  }
  return { prompt, negativePrompt, negativePreset };
}

function novelAiPromptGuide(connection: DescribedConnection): string[] {
  const v4 = connection.dialect !== "novelai-v3";
  const v5 = connection.dialect === "novelai-v5";
  const v45 = /nai-diffusion-(4-5|5)/.test(connection.model.toLowerCase());
  const presets = resolveNovelAiPresets(connection.model);
  const presetNames = Object.keys(presets.negative);
  const lines = [
    `## Writing the prompt (NovelAI, ${connection.model})`,
    "- Vocabulary: Danbooru tags. Lower case, comma separated, spaces instead of underscores: `1girl, solo, long black hair, red scarf, looking at viewer, night, city street`.",
    v4
      ? "- Furry and animal characters: put `fur dataset` at the very start of the base prompt and write e621 tags instead (species, `anthro` or `feral`, `male` / `female`, fur and body colour tags, `solo` / `duo` / `group`). Without it the model reads Danbooru tags."
      : "- This model only knows Danbooru tags. Furry and animal characters need a NovelAI V4 or later connection with `fur dataset`.",
    ...(v45 ? ["- Scenery with nobody in it: put `background dataset` at the very start."] : []),
    "- Order: how many and of what first (`1girl`, `1boy, 1girl`, `2girls`, `no humans`), then named characters with their series, then everything else.",
    "- Tag what can be seen, never the story: hair, eyes, build, each piece of clothing, expression, pose, what the hands are doing, framing (`portrait`, `upper body`, `cowboy shot`, `full body`, `from above`, `from behind`, `pov`, `close-up`), the place, the time of day, the light.",
    v4
      ? `- English sentences work too, alone or after the tags, for what tags cannot say: who does what to whom, what is where.${
          v5
            ? " Other languages are understood as well and prompts can be long."
            : " English only, no emoji or other scripts, and about 512 tokens for the base prompt and all character prompts together."
        }`
      : "- Tags only; this model does not follow sentences.",
    `- Emphasis: \`{tag}\` is stronger and \`[tag]\` weaker, 5% per bracket.${
      v4
        ? " Numeric: `1.3::red scarf, snow ::` strengthens what is inside, a number below 1 weakens it, and the bare `::` ends it."
        : ""
    }${v45 ? " Negative numbers remove or invert a thing: `-1::hat ::`." : ""}`,
    "- `|` mixes prompts, so it never appears inside a tag. Renamed for that reason: `v` is `peace sign`, `double v` is `double peace`, `:|` is `neutral face`.",
    `- Presets, the same ones NovelAI's own interface has, are added for you and stack with what you write. \`quality_tags\` (on unless you pass false) appends \`${presets.quality}\` to the prompt. \`negative_preset\` puts an Undesired Content list in front of your negative prompt: ${presetNames
      .map((name) => `\`${name}\``)
      .join(
        ", ",
      )} or \`none\` (default \`heavy\`).${presets.negative.human ? " `human` is heavy plus fixes for anatomy and eyes, for pictures of people." : ""}${
      presets.negative.furry ? " `furry` goes with `fur dataset`." : ""
    } Write only your own additions in prompt and negative_prompt and never retype the preset tags.`,
    "- The presets pull toward a clean, finished look. For a picture that is meant to be rough, grainy, sketched, flat or printed (film grain, halftone, screentone, sketch), use `light` or `none`, and turn `quality_tags` off when the polish itself is wrong for it.",
    `- Other steering tags: \`year 2023\` for the look of an era, \`rating:general\` / \`rating:sensitive\` / \`rating:questionable\` / \`rating:explicit\`${
      v4 ? ", an artist as `artist:name`" : ", an artist by name"
    }.`,
    ...(v4
      ? [
          "- Words in the picture: add the tags `text, english text` and end the base prompt with `Text: the words`. Nothing may come after it. Keep it short.",
        ]
      : []),
    "- negative_prompt: your additions on top of the preset, the things this particular picture must not have (`hat, glasses, extra people, closed eyes`). Emphasis there means avoid it harder.",
  ];
  return lines;
}

function stableDiffusionPromptGuide(connection: DescribedConnection): string[] {
  const lines = [`## Writing the prompt (${connection.backend}, ${connection.model || "the connection's checkpoint"})`];
  if (connection.dialect === "sd-pony") {
    lines.push(
      "- Pony family: start with `score_9, score_8_up, score_7_up`, then one of `source_anime` / `source_furry` / `source_cartoon` / `source_pony`, then `rating_safe` / `rating_questionable` / `rating_explicit`, then Danbooru or e621 tags.",
    );
  } else if (connection.dialect === "sd-anime") {
    lines.push(
      "- Anime SDXL (Illustrious, NoobAI, Animagine and their merges): Danbooru tags, lower case, comma separated, spaces instead of underscores. Count and kind first (`1girl, solo`), then character and series, then looks, clothes, pose, framing, place, light. NoobAI also knows e621 tags for furry characters.",
      "- Quality tags: `masterpiece, best quality, amazing quality, absurdres` in the prompt; `worst quality, low quality, bad anatomy, bad hands, jpeg artifacts, watermark, text` in negative_prompt.",
    );
  } else if (connection.dialect === "sd-prose") {
    lines.push(
      "- This model reads plain descriptive sentences: who, what they look like, what they do, where, framing, light, style. No tag lists and no weights; negative_prompt is mostly ignored.",
    );
  } else {
    lines.push(
      "- What works depends on the checkpoint. Anime SDXL (Illustrious, NoobAI, Animagine) wants Danbooru tags with `masterpiece, best quality, absurdres`. Pony wants `score_9, score_8_up, score_7_up, source_anime, rating_safe` before Danbooru or e621 tags. Flux, Qwen, Z-Image, SD3 and Chroma want plain sentences without weights. Photographic SDXL and SD 1.5 take short phrases.",
    );
  }
  if (connection.dialect !== "sd-prose") {
    lines.push(
      "- Emphasis: `(tag:1.2)` stronger, `(tag:0.8)` weaker. Parentheses that belong to a tag are escaped: `name \\(series\\)`.",
      "- Tag what can be seen: hair, eyes, build, each piece of clothing, expression, pose, framing (`upper body`, `cowboy shot`, `full body`, `from above`), place, time of day, light.",
    );
  }
  lines.push("- The checkpoint, LoRAs and workflow belong to the connection; you cannot change them.");
  return lines;
}

function prosePromptGuide(connection: DescribedConnection): string[] {
  return [
    `## Writing the prompt (${connection.backend}, ${connection.model || "default model"})`,
    "- Plain descriptive prose, one paragraph: who is in the picture and what they look like, what they are doing, where, the framing and camera distance, the light, the mood, and the art style or medium.",
    "- Be concrete: colours, materials, how many of each thing, which hand. No tag lists, no weights, no brackets.",
    "- Say what should be there rather than what should not (`an empty street` instead of `no people`). negative_prompt is passed where the provider has one and otherwise appended as an avoid-list.",
    "- Words to render in the picture go in quotation marks.",
  ];
}

function charactersGuide(connection: DescribedConnection): string[] {
  if (connection.dialect === "novelai-v4" || connection.dialect === "novelai-v5") {
    return [
      "## Several people: `characters`",
      "- Base prompt: the count tags (`2girls`, `1boy, 1girl`), the place, the light, the framing, the style. No individual looks.",
      `- One entry per person, up to ${resolveNovelAiCharacterPromptLimit(connection.model)}: \`prompt\` starts with \`girl\`, \`boy\` or \`other\` (no number) and then gives that person's looks, clothes, expression, pose and action.`,
      "- `negative_prompt` on an entry keeps another person's traits off this one.",
      "- `position`: a grid cell `A1` to `E5`, columns A to E left to right, rows 1 to 5 top to bottom, `C3` the centre. Leave it out and the model places them.",
      "- Who does what to whom: `source#hug` on the one doing it, `target#hug` on the one receiving it, `mutual#hug` on both. It is not always obeyed.",
      "- A single person can go in `characters` too; it keeps their traits apart from the scene tags.",
    ];
  }
  return [
    "## Several people: `characters`",
    "- This connection has no separate character prompts; entries are added to the prompt as `Name: description`. Describe each person fully and say where they stand.",
  ];
}

function referencesGuide(connection: DescribedConnection, others: DescribedConnection[]): string[] {
  const sources =
    "Sources: `avatar:<name>` (a character's or tracked person's picture), `persona` (the user's picture), `gallery:<id>` (a picture already in this chat), or the path of a draft or any image in your workspace. list_images shows what exists; view_image shows you one.";
  const takesReferences = imageConnectionTakesReferencePicture({
    source: connection.model,
    baseUrl: connection.baseUrl,
    serviceHint: connection.serviceHint,
    model: connection.model,
    comfyWorkflow: connection.row.comfyuiWorkflow ?? "",
  });
  const lines = ["## Reference pictures: `references` and `base_image`"];
  if (connection.backend === "novelai" && connection.nativeNovelAi) {
    if (isNovelAiPreciseReferenceModel(connection.model)) {
      lines.push(
        "- `references` and `base_image` are two different things. A reference is never redrawn and never supplies the composition: the model reads who the person is or how the art looks from it, and then draws a completely new picture from your prompt. `base_image` is the opposite, that exact picture as the canvas.",
        "- `references: [{source, kind, strength, fidelity}]` is NovelAI Precise Reference.",
        "- `kind`: `character` takes the person (face, hair, body, the design of their outfit) and draws them in whatever style the prompt and model give; `style` takes only how the art looks (line, colour, shading, rendering) and nothing of what is in the picture; `character&style` takes both.",
        "- Pose, framing, angle, action, expression, place and light all come from the prompt. Write them as fully as you would without a reference; a reference with a thin prompt gives a stiff copy of the reference's own pose.",
        "- `strength` 0 to 1 is how much of the design or style carries over, not how much of the picture is kept (default 1, for `style` the connection's value). Lower it when the person should wear or look different from the reference, or when the style should only tint the picture.",
        "- `fidelity` 0 to 1 is how literally small details are held (exact hair strands, outfit trim, accessories); lower lets the model adapt them to the new pose and scene.",
        "- Several character references blend into one person, they do not stay two people. With two different people in the picture, reference one and describe the other in `characters`.",
        "- A character reference and a style reference together are fine: the person from one picture in the look of another.",
        "- The best character reference is a full body in a neutral pose on a plain background with clean lines.",
        "- Each referenced picture costs extra Anlas.",
      );
      if (connection.defaults?.novelai?.styleReferenceImage) {
        lines.push(
          "- The connection has a stored style reference that is applied to every picture. Passing your own `references` replaces it for that picture.",
        );
      }
    } else {
      const capable = others.filter(
        (other) => other.backend === "novelai" && other.nativeNovelAi && isNovelAiPreciseReferenceModel(other.model),
      );
      lines.push(
        `- This model takes no reference pictures.${
          capable.length
            ? ` For a character or style reference, draw with connection ${capable.map((other) => `"${other.name}"`).join(" or ")}.`
            : " Precise Reference needs a NovelAI V4.5 connection."
        }`,
      );
    }
    lines.push(
      "- `base_image: {source, strength, noise}` is image-to-image: that very picture is the starting canvas and is drawn over. Here `strength` is how far it may move away from the original: 0.3-0.5 keeps the composition and repairs details, 0.6-0.8 reinterprets it. `noise` 0-0.2 adds new detail. Use it on a draft that is nearly right, not to carry a person into a new scene.",
    );
  } else if (takesReferences) {
    lines.push(
      "- `references: [{source}]` passes pictures to the model as inputs to take a person or a look from; `kind`, `strength` and `fidelity` are not used here. Say in the prompt what each picture is for. The composition still comes from the prompt.",
      imageSourceToDefaultsService(connection.backend)
        ? "- `base_image: {source, strength}` redraws an existing picture; `strength` is the denoise, 0.3-0.5 for small repairs, 0.6-0.8 for a new take."
        : "- `base_image: {source}` asks for an edit of that picture; describe the change in the prompt.",
    );
  } else {
    lines.push("- This connection takes no reference pictures; describe everything in the prompt.");
  }
  lines.push(`- ${sources}`);
  return lines;
}

function settingsGuide(connection: DescribedConnection, illustrationSize: { width: number; height: number }): string[] {
  const knobs = reagentImageKnobs(connection.backend, connection.nativeNovelAi);
  const lines = ["## Size and settings"];
  if (connection.backend === "novelai" && connection.nativeNovelAi) {
    const novelai = { ...createDefaultImageGenerationProfile("novelai").novelai!, ...connection.defaults?.novelai };
    lines.push(
      `- \`aspect\`: \`portrait\` 832x1216, \`landscape\` 1216x832, \`square\` 1024x1024. Or \`width\` and \`height\` in multiples of 64, at most 1024x1024 pixels in area.${
        novelai.dynamicResolutionBySubjectCount
          ? " With neither, the size follows the head count in the prompt: one person portrait, two square, three or more landscape."
          : ""
      }`,
      `- \`steps\` 1-50 (connection: ${novelai.steps}). 28 or fewer at these sizes is free on an Opus subscription; more costs Anlas.`,
      `- \`guidance\` 0-10 (connection: ${novelai.promptGuidance}). 5-6 is the normal range; lower is softer and looser, higher is sharper and more literal and breaks when pushed.`,
      `- \`guidance_rescale\` 0-1 (connection: ${novelai.promptGuidanceRescale}), tames oversaturated colour at high guidance.`,
      `- \`sampler\` (connection: ${novelai.sampler}): ${NOVELAI_SAMPLER_OPTIONS.map((option) => option.value)
        .filter(Boolean)
        .join(", ")}. Leave it unless a draft has a reason to change it.`,
      `- \`scheduler\` (connection: ${novelai.noiseSchedule}): ${NOVELAI_NOISE_SCHEDULE_OPTIONS.map(
        (option) => option.value,
      )
        .filter(Boolean)
        .join(", ")}.`,
    );
  } else {
    lines.push(
      `- \`aspect\`: \`portrait\`, \`landscape\` or \`square\` of the user's illustration size (${illustrationSize.width}x${illustrationSize.height}), or \`width\` and \`height\`.`,
    );
    if (knobs.length) {
      lines.push(
        "- `steps`, `guidance` (CFG), `sampler` and `scheduler` override the connection's values for one picture. Leave them unless a draft has a reason to change them.",
      );
    } else {
      lines.push(
        "- This provider has no steps, guidance, sampler or seed to set; only the prompt and the size matter.",
      );
    }
  }
  if (knobs.includes("seed")) {
    lines.push(
      "- `seed`: every result reports the seed it used. Pass it back with a small prompt change to repair one detail of the same picture; leave it out for a new composition.",
    );
  }
  return lines;
}

/** The whole guide for one connection, or the sections named by `topic`. */
export function buildReagentImageGuide(input: {
  connection: DescribedConnection;
  connections: DescribedConnection[];
  illustrationSize: { width: number; height: number };
  topic?: string;
}): string {
  const { connection, connections } = input;
  const novelai = connection.backend === "novelai" && connection.nativeNovelAi;
  const prefix = novelai
    ? connection.defaults?.novelai
    : (connection.defaults?.automatic1111 ?? connection.defaults?.comfyui);
  const overview = [
    "# Drawing pictures",
    "Image connections:",
    ...connections.map(
      (entry) =>
        `- "${entry.name}"${entry.row.id === connection.row.id ? " (used unless you name another)" : ""}: ${entry.backend}, ${entry.model || "default model"}`,
    ),
    "",
    "## How it goes",
    "- generate_image makes a draft that only you see; it comes back attached, so look at it.",
    "- Draw the moment as it actually is, not an easier version of it: the real pose and action, everyone who is there, what the hands are doing, the angle it would be seen from, the whole place with its light and weather. Do not retreat to a plain portrait, a standing pose, a tighter crop or an empty background because they render more safely. Hard pictures are what the drafts are for.",
    "- Draw at full size; small pictures lose faces and hands.",
    "- Judge the draft against the moment: the right people as they are now, the action, the place, the light, the mood.",
    `- A flaw is repaired, not avoided. A wrong hand, a stray limb, a wrong colour or a missing prop: keep the seed and correct the prompt, add the fault to negative_prompt, or run base_image on that draft at low strength. Up to ${REAGENT_MAX_DRAFTS_PER_REPLY} drafts in one reply; change one thing at a time so you know what helped. Only simplify the picture after the full version has failed more than once.`,
    `- send_image puts a draft into your reply, up to ${REAGENT_MAX_SENT_PER_REPLY}. Nothing else reaches the user. Drafts you do not send stay in \`${REAGENT_IMAGES_DIR}/\` in your workspace.`,
    "- The picture is something the person in the scene could show or that the moment shows; the reply text never describes having generated it.",
    ...(prefix?.promptPrefix?.trim()
      ? [`- The connection puts this before every prompt, so do not repeat it: \`${prefix.promptPrefix.trim()}\``]
      : []),
    ...(prefix?.negativePromptPrefix?.trim()
      ? [`- And this before every negative prompt: \`${prefix.negativePromptPrefix.trim()}\``]
      : []),
    ...(connection.row.imagePromptInstructions?.trim()
      ? [`- The user's own instructions for this connection: ${connection.row.imagePromptInstructions.trim()}`]
      : []),
  ];
  const prompt = connection.dialect.startsWith("novelai")
    ? novelAiPromptGuide(connection)
    : connection.dialect.startsWith("sd")
      ? stableDiffusionPromptGuide(connection)
      : prosePromptGuide(connection);
  const sections: Record<string, string[]> = {
    overview,
    prompt,
    characters: charactersGuide(connection),
    references: referencesGuide(
      connection,
      connections.filter((entry) => entry.row.id !== connection.row.id),
    ),
    settings: settingsGuide(connection, input.illustrationSize),
  };
  const topic = str(input.topic).trim().toLowerCase();
  const chosen = topic && sections[topic] ? [sections[topic]!] : Object.values(sections);
  return chosen.map((section) => section.join("\n")).join("\n\n");
}

// ── Pictures on disk ──

/** Width and height from a PNG header; other formats fall back to what was asked for. */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const draftMetaPath = (workspaceDir: string, path: string) => join(workspaceDir, `${path}.json`);

export async function readReagentImageDraft(workspaceDir: string, path: string): Promise<ReagentImageDraft | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(draftMetaPath(workspaceDir, path), "utf8"));
    return isRecord(parsed) && typeof parsed.path === "string" ? (parsed as unknown as ReagentImageDraft) : null;
  } catch {
    return null;
  }
}

async function listDrafts(workspaceDir: string): Promise<ReagentImageDraft[]> {
  const names = await readdir(join(workspaceDir, REAGENT_IMAGES_DIR)).catch(() => [] as string[]);
  const drafts = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) => readReagentImageDraft(workspaceDir, `${REAGENT_IMAGES_DIR}/${name.slice(0, -".json".length)}`)),
  );
  return drafts.filter((draft): draft is ReagentImageDraft => draft !== null).sort((a, b) => a.at.localeCompare(b.at));
}

/** Unsent drafts pile up; the oldest go once there are too many. Sent ones live in the gallery. */
async function pruneDrafts(workspaceDir: string) {
  const drafts = await listDrafts(workspaceDir);
  for (const draft of drafts.slice(0, Math.max(0, drafts.length - MAX_KEPT_DRAFTS))) {
    await unlink(join(workspaceDir, draft.path)).catch(() => {});
    await unlink(draftMetaPath(workspaceDir, draft.path)).catch(() => {});
  }
}

/**
 * Save the drafts the writer sent into the chat gallery and return the attachments for the reply.
 * A draft that cannot be read is skipped: the reply still stands without its picture.
 */
export async function persistReagentSentImages(args: {
  db: DB;
  chatId: string;
  workspaceDir: string;
  drafts: ReagentImageDraft[];
  characterName?: string | null;
}): Promise<Array<Record<string, unknown>>> {
  const gallery = createGalleryStorage(args.db);
  const attachments: Array<Record<string, unknown>> = [];
  for (const [index, draft] of args.drafts.entries()) {
    try {
      const buffer = await readFile(join(args.workspaceDir, draft.path));
      const ext = extname(draft.path).slice(1) || "png";
      const filePath = saveImageToDisk(args.chatId, buffer.toString("base64"), ext, { shared: true });
      const entry = await gallery.create({
        chatId: args.chatId,
        filePath,
        prompt: draft.prompt,
        provider: draft.provider,
        model: draft.model,
        width: draft.width,
        height: draft.height,
        generation: buildChatImageGenerationRecord({
          prompt: draft.prompt,
          connectionId: draft.connectionId,
          negativePrompt: draft.negativePrompt,
          characterPrompts: draft.characterPrompts,
        }),
      });
      const filename = filePath.split("/").pop()!;
      attachments.push({
        type: "image",
        url: `/api/gallery/file/${args.chatId}/${encodeURIComponent(filename)}`,
        filename: `picture_${index + 1}.${extname(filename).slice(1) || ext}`,
        prompt: draft.prompt,
        galleryId: entry?.id,
        ...(args.characterName ? { characterName: args.characterName } : {}),
      });
      await writeFile(
        draftMetaPath(args.workspaceDir, draft.path),
        `${JSON.stringify({ ...draft, sentGalleryId: entry?.id }, null, 2)}\n`,
        "utf8",
      ).catch(() => {});
    } catch (err) {
      logger.warn(err, "[reagent/images] Could not attach %s to the reply", draft.path);
    }
  }
  return attachments;
}

// ── The tools ──

export function createReagentImageTools(context: ReagentImageContext) {
  const connectionsStore = createConnectionsStorage(context.db);
  const gallery = createGalleryStorage(context.db);
  const draw = context.draw ?? generateImage;
  let drawn = 0;
  const sent = new Set<string>();
  let described: DescribedConnection[] | null = null;

  const describe = (row: ConnectionRow): DescribedConnection => {
    const model = row.model || "";
    const baseUrl = row.baseUrl || "https://image.pollinations.ai";
    const serviceHint = row.imageService || row.imageGenerationSource || model;
    const backend = resolveImageBackend(model, baseUrl, serviceHint, model);
    let nativeNovelAi = false;
    try {
      nativeNovelAi = backend === "novelai" && isNativeNovelAiHost(new URL(baseUrl).hostname);
    } catch {
      /* not a URL the native path would take */
    }
    return {
      row,
      name: row.name || model || "image connection",
      model,
      baseUrl,
      serviceHint,
      backend,
      nativeNovelAi,
      dialect: resolveReagentImageDialect(backend, model, nativeNovelAi),
      defaults: resolveConnectionImageDefaults(row),
    };
  };

  /** Every image connection, the chat's own choice first. */
  const loadConnections = async (): Promise<DescribedConnection[]> => {
    if (described) return described;
    if (context.connectionRows) return (described = context.connectionRows.map(describe));
    const listed = (await connectionsStore.list()).filter((row) => row.provider === "image_generation");
    const preferredIds = [
      str(context.chatMeta.illustratorImageConnectionId),
      str(context.chatMeta.imageGenConnectionId),
      (await connectionsStore.getDefaultForImageGeneration())?.id ?? "",
    ].filter(Boolean);
    const ordered = [...listed].sort((a, b) => {
      const rank = (id: string) => (preferredIds.includes(id) ? preferredIds.indexOf(id) : preferredIds.length);
      return rank(a.id) - rank(b.id);
    });
    const rows: ConnectionRow[] = [];
    for (const row of ordered) {
      const full = await connectionsStore.getWithKey(row.id);
      if (full) rows.push(full);
    }
    described = rows.map(describe);
    return described;
  };

  const pickConnection = async (wanted: string): Promise<DescribedConnection> => {
    const all = await loadConnections();
    if (!all.length) {
      throw new Error("No image generation connection is set up. The user adds one under Connections.");
    }
    const name = wanted.trim().toLowerCase();
    if (!name) return all[0]!;
    const match =
      all.find((entry) => entry.name.toLowerCase() === name || entry.row.id === wanted.trim()) ??
      all.find((entry) => entry.name.toLowerCase().includes(name));
    if (!match) {
      throw new Error(
        `No image connection named "${wanted}". There are: ${all.map((entry) => `"${entry.name}"`).join(", ")}.`,
      );
    }
    return match;
  };

  /** A picture named by the writer, as bytes. */
  const readSource = async (raw: unknown): Promise<{ buffer: Buffer; label: string }> => {
    const source = str(raw).trim();
    if (!source) throw new Error("A source is required: avatar:<name>, persona, gallery:<id> or an image path.");
    const lowered = source.toLowerCase();
    let buffer: Buffer | null = null;
    let label = source;
    if (lowered === "persona" || lowered === "user") {
      const base64 = readAvatarBase64(context.persona?.avatarPath);
      if (!base64) throw new Error("The user's persona has no picture.");
      buffer = Buffer.from(base64, "base64");
      label = `persona (${context.persona?.name ?? "user"})`;
    } else if (lowered.startsWith("avatar:") || lowered.startsWith("character:")) {
      const wanted = source
        .slice(source.indexOf(":") + 1)
        .trim()
        .toLowerCase();
      const person =
        context.people.find((entry) => entry.name.toLowerCase() === wanted) ??
        context.people.find((entry) => entry.name.toLowerCase().includes(wanted));
      if (!person) {
        throw new Error(
          `Nobody named "${wanted}" here. Known: ${context.people.map((entry) => entry.name).join(", ") || "nobody"}.`,
        );
      }
      const base64 = person.id
        ? (await readPreferredCharacterReferenceImage({ characterId: person.id, avatarPath: person.avatarPath }))
            ?.base64
        : readAvatarBase64(person.avatarPath);
      if (!base64) throw new Error(`${person.name} has no picture to use.`);
      buffer = Buffer.from(base64, "base64");
      label = `avatar:${person.name}`;
    } else if (lowered.startsWith("gallery:")) {
      const id = source.slice("gallery:".length).trim();
      const row = await gallery.getById(id, context.chatId);
      const file = row ? resolveStoredGalleryFile(row.filePath) : null;
      if (!file) throw new Error(`No picture ${id} in this chat's gallery; list_images shows the ids.`);
      buffer = await readFile(file.absolutePath);
    } else {
      const { absolute, workspaceRelative } = resolveReagentPath(source, {
        workspaceDir: context.workspaceDir,
        settings: context.settings,
        forWrite: false,
      });
      if (classifyFileKind(absolute) !== "image") throw new Error(`${source} is not an image file.`);
      buffer = await readFile(absolute).catch(() => {
        throw new Error(`No file at ${workspaceRelative ?? absolute}.`);
      });
      label = workspaceRelative ?? absolute;
    }
    if (!isAllowedImageBuffer(buffer)) throw new Error(`${label} is not a readable image.`);
    return { buffer, label };
  };

  const asInput = async (buffer: Buffer, name: string) => {
    const dataUrl = await optimizeNoodleVisionImage(buffer);
    return dataUrl ? [{ kind: "image" as const, name, dataUrl, mimeType: "image/jpeg" }] : [];
  };

  async function guide(args: Record<string, unknown>): Promise<ImageToolOutcome> {
    const connection = await pickConnection(str(args.connection));
    const imageSettings = await loadImageGenerationUserSettings(context.db);
    return {
      text: buildReagentImageGuide({
        connection,
        connections: await loadConnections(),
        illustrationSize: imageSettings.illustration,
        topic: str(args.topic),
      }),
    };
  }

  async function generate(args: Record<string, unknown>): Promise<ImageToolOutcome> {
    const prompt = str(args.prompt).trim();
    if (!prompt) throw new Error("prompt is required.");
    if (drawn >= REAGENT_MAX_DRAFTS_PER_REPLY) {
      throw new Error(
        `That was the last of ${REAGENT_MAX_DRAFTS_PER_REPLY} drafts for this reply. Send the best one or go on without a picture.`,
      );
    }
    const connection = await pickConnection(str(args.connection));
    const novelai = connection.backend === "novelai" && connection.nativeNovelAi;
    const knobs = reagentImageKnobs(connection.backend, connection.nativeNovelAi);
    const ignored: string[] = [];

    // Size: an explicit one, an aspect, or whatever the connection does by default.
    const aspect = str(args.aspect).trim().toLowerCase();
    const askedWidth = finite(args.width);
    const askedHeight = finite(args.height);
    let size: { width: number; height: number };
    let explicitSize = false;
    if (askedWidth !== null && askedHeight !== null) {
      size = { width: clamp(Math.round(askedWidth), 64, 4096), height: clamp(Math.round(askedHeight), 64, 4096) };
      explicitSize = true;
    } else if (novelai) {
      size =
        aspect === "landscape"
          ? { width: 1216, height: 832 }
          : aspect === "square"
            ? { width: 1024, height: 1024 }
            : { width: 832, height: 1216 };
      explicitSize = ["portrait", "landscape", "square"].includes(aspect);
    } else {
      const imageSettings = await loadImageGenerationUserSettings(context.db);
      size = resolveIllustratorImageSize(imageSettings.illustration, aspect);
    }

    // Per-person prompts.
    const characterPrompts: SceneIllustrationCharacterPrompt[] = (Array.isArray(args.characters) ? args.characters : [])
      .filter(isRecord)
      .map((entry, index) => {
        const position = parseReagentImagePosition(entry.position);
        const negative = str(entry.negative_prompt ?? entry.negativePrompt).trim();
        return {
          name: str(entry.name).trim() || `Character ${index + 1}`,
          prompt: str(entry.prompt).trim(),
          ...(negative ? { negativePrompt: negative } : {}),
          ...(position ? { position } : {}),
        };
      })
      .filter((entry) => entry.prompt);

    // Reference pictures.
    const referenceArgs = (Array.isArray(args.references) ? args.references : [])
      .map((entry): Record<string, unknown> => (isRecord(entry) ? entry : { source: entry }))
      .slice(0, MAX_REFERENCES);
    const takesReferences = imageConnectionTakesReferencePicture({
      source: connection.model,
      baseUrl: connection.baseUrl,
      serviceHint: connection.serviceHint,
      model: connection.model,
      comfyWorkflow: connection.row.comfyuiWorkflow ?? "",
    });
    if (referenceArgs.length && novelai && !isNovelAiPreciseReferenceModel(connection.model)) {
      const capable = (await loadConnections()).filter(
        (entry) => entry.backend === "novelai" && entry.nativeNovelAi && isNovelAiPreciseReferenceModel(entry.model),
      );
      throw new Error(
        `${connection.model} takes no reference pictures. ${
          capable.length
            ? `Draw with connection ${capable.map((entry) => `"${entry.name}"`).join(" or ")} for references, or drop them.`
            : "Drop the references and describe the person in the prompt."
        }`,
      );
    }
    if (referenceArgs.length && !novelai && !takesReferences) {
      throw new Error(
        `Connection "${connection.name}" takes no reference pictures. Describe everything in the prompt.`,
      );
    }
    const preciseReferences: ImagePreciseReference[] = [];
    const referenceImages: string[] = [];
    const referenceLabels: string[] = [];
    for (const entry of referenceArgs) {
      const { buffer, label } = await readSource(entry.source);
      const base64 = buffer.toString("base64");
      referenceLabels.push(label);
      if (novelai) {
        const kind = str(entry.kind).trim().toLowerCase();
        const strength = finite(entry.strength);
        const fidelity = finite(entry.fidelity);
        preciseReferences.push({
          image: base64,
          kind: kind === "style" ? "style" : kind === "character" ? "character" : "character&style",
          ...(strength !== null ? { strength: clamp(strength, 0, 1) } : {}),
          ...(fidelity !== null ? { fidelity: clamp(fidelity, 0, 1) } : {}),
        });
      } else {
        referenceImages.push(base64);
      }
    }

    // A picture to start from.
    const baseArg: Record<string, unknown> | null = isRecord(args.base_image)
      ? args.base_image
      : args.base_image
        ? { source: args.base_image }
        : null;
    let sourceImage: ImageGenRequest["sourceImage"];
    let denoise: number | null = null;
    if (baseArg) {
      const { buffer, label } = await readSource(baseArg.source);
      const strength = finite(baseArg.strength);
      const noise = finite(baseArg.noise);
      referenceLabels.push(`base ${label}`);
      if (novelai) {
        sourceImage = {
          image: buffer.toString("base64"),
          ...(strength !== null ? { strength } : {}),
          ...(noise !== null ? { noise } : {}),
        };
        // Redraw on the source's own canvas unless a size was asked for.
        const sourceSize = pngSize(buffer);
        if (!explicitSize && sourceSize) {
          size = sourceSize;
          explicitSize = true;
        }
      } else if (takesReferences) {
        referenceImages.unshift(buffer.toString("base64"));
        denoise = strength;
      } else {
        throw new Error(`Connection "${connection.name}" cannot start from a picture.`);
      }
    }

    // Sampler settings ride on a copy of the connection's defaults.
    const overrides = {
      seed: finite(args.seed),
      steps: finite(args.steps),
      guidance: finite(args.guidance),
      guidanceRescale: finite(args.guidance_rescale),
      sampler: str(args.sampler).trim() || null,
      scheduler: str(args.scheduler).trim() || null,
    };
    for (const [name, key] of [
      ["seed", "seed"],
      ["steps", "steps"],
      ["guidance", "guidance"],
      ["guidance_rescale", "guidanceRescale"],
      ["sampler", "sampler"],
      ["scheduler", "scheduler"],
    ] as const) {
      if (overrides[key] != null && !knobs.includes(name)) {
        ignored.push(name);
        (overrides as Record<string, unknown>)[key] = null;
      }
    }
    // Choosing the seed here is what lets the result report it.
    const seed = knobs.includes("seed") ? (overrides.seed ?? Math.floor(Math.random() * 2 ** 32)) : null;
    const imageDefaults = patchReagentImageDefaults(connection.defaults, connection.backend, connection.nativeNovelAi, {
      ...overrides,
      seed,
      denoise,
      explicitSize,
    });

    // NovelAI's presets stack under what the writer wrote; elsewhere there are none to add.
    let finalPrompt = prompt;
    let negativePrompt = str(args.negative_prompt).trim();
    let presetsApplied: { quality_tags: boolean; negative_preset: string } | null = null;
    if (novelai) {
      const qualityTags = args.quality_tags !== false && args.quality_tags !== "false";
      const applied = applyNovelAiPresets({
        model: connection.model,
        prompt,
        negativePrompt,
        qualityTags,
        negativePreset: str(args.negative_preset) || "heavy",
        promptPrefix: connection.defaults?.novelai?.promptPrefix,
        negativePromptPrefix: connection.defaults?.novelai?.negativePromptPrefix,
      });
      finalPrompt = applied.prompt;
      negativePrompt = applied.negativePrompt;
      presetsApplied = { quality_tags: qualityTags, negative_preset: applied.negativePreset };
    } else {
      if (args.quality_tags !== undefined) ignored.push("quality_tags");
      if (str(args.negative_preset)) ignored.push("negative_preset");
    }
    const request: ImageGenRequest = {
      prompt: finalPrompt,
      negativePrompt: negativePrompt || undefined,
      model: connection.model,
      width: size.width,
      height: size.height,
      imageEndpointId: connection.row.imageEndpointId || undefined,
      comfyWorkflow: connection.row.comfyuiWorkflow || undefined,
      imageDefaults,
      quality: resolveConnectionImageQuality(connection.row),
      ...(characterPrompts.length ? { characterPrompts } : {}),
      ...(preciseReferences.length ? { preciseReferences } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
      ...(sourceImage ? { sourceImage } : {}),
      signal: context.signal,
      debugMode: context.debugMode,
      // A fallback connection would draw with other settings than the ones the writer chose
      // and reported back, so it is only used when the writer asked for nothing specific.
      fallback:
        preciseReferences.length || sourceImage || Object.values(overrides).some((value) => value != null)
          ? undefined
          : await resolveImageConnectionFallback(connectionsStore, connection.row.id),
    };
    logger.debug(
      "[reagent/images] generate_image on %s (%s): %s",
      connection.name,
      connection.model,
      JSON.stringify({
        prompt: finalPrompt,
        negativePrompt,
        characterPrompts,
        size,
        seed,
        references: referenceLabels,
      }),
    );
    drawn += 1;
    const result = await draw(
      connection.model,
      connection.baseUrl,
      connection.row.apiKey || "",
      connection.serviceHint,
      request,
    );

    const buffer = Buffer.from(result.base64, "base64");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const path = `${REAGENT_IMAGES_DIR}/img-${stamp}-${Math.random().toString(36).slice(2, 5)}.${result.ext || "png"}`;
    const actual = pngSize(buffer) ?? size;
    const draft: ReagentImageDraft = {
      path,
      prompt: result.effectivePrompt ?? finalPrompt,
      negativePrompt: result.effectiveNegativePrompt ?? negativePrompt,
      connectionId: result.effectiveConnection?.connectionId ?? connection.row.id,
      connectionName: result.effectiveConnection?.connectionName ?? connection.name,
      provider: result.effectiveConnection?.provider ?? connection.row.provider ?? "image_generation",
      model: result.effectiveConnection?.model || connection.model || "unknown",
      width: actual.width,
      height: actual.height,
      seed,
      ...(characterPrompts.length ? { characterPrompts } : {}),
      at: new Date().toISOString(),
    };
    await mkdir(join(context.workspaceDir, REAGENT_IMAGES_DIR), { recursive: true });
    await writeFile(join(context.workspaceDir, path), buffer);
    await writeFile(draftMetaPath(context.workspaceDir, path), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    await pruneDrafts(context.workspaceDir);

    const left = REAGENT_MAX_DRAFTS_PER_REPLY - drawn;
    return {
      text: JSON.stringify({
        draft: path,
        connection: draft.connectionName,
        model: draft.model,
        width: draft.width,
        height: draft.height,
        ...(seed !== null ? { seed } : {}),
        ...(presetsApplied ? { presets: presetsApplied } : {}),
        ...(referenceLabels.length ? { references: referenceLabels } : {}),
        ...(ignored.length ? { ignored_settings: ignored } : {}),
        drafts_left: left,
        note: `The draft is attached; look at it. Right for the moment: send_image("${path}"). Wrong: say to yourself what is wrong, then repair it rather than drawing something simpler${
          seed !== null ? " (same seed to fix a detail, no seed for a new composition)" : ""
        }${left === 0 ? "; this was the last draft for this reply" : ""}. The user sees nothing until you send.`,
      }),
      media: await asInput(buffer, path),
    };
  }

  async function view(args: Record<string, unknown>): Promise<ImageToolOutcome> {
    const { buffer, label } = await readSource(args.source);
    const media = await asInput(buffer, label);
    if (!media.length) throw new Error(`${label} could not be prepared for viewing.`);
    return { text: `${label} is attached to this turn as an input; look at it directly.`, media };
  }

  async function list(): Promise<ImageToolOutcome> {
    const drafts = await listDrafts(context.workspaceDir);
    const rows = await gallery.listByChatId(context.chatId);
    return {
      text: JSON.stringify({
        drafts: drafts.slice(-15).map((draft) => ({
          source: draft.path,
          prompt: draft.prompt.slice(0, 160),
          size: `${draft.width}x${draft.height}`,
          ...(draft.seed !== null ? { seed: draft.seed } : {}),
          at: draft.at,
          sent: Boolean(draft.sentGalleryId) || sent.has(draft.path),
        })),
        gallery: rows.slice(0, 20).map((row) => ({
          source: `gallery:${row.id}`,
          prompt: str(row.prompt).slice(0, 160),
          at: row.createdAt,
        })),
        avatars: context.people
          .filter((person) => person.id || person.avatarPath)
          .map((person) => `avatar:${person.name}`),
        persona: context.persona?.avatarPath ? "persona" : null,
      }),
    };
  }

  async function send(args: Record<string, unknown>): Promise<ImageToolOutcome> {
    const { workspaceRelative } = resolveReagentPath(str(args.draft ?? args.image), {
      workspaceDir: context.workspaceDir,
      settings: context.settings,
      forWrite: false,
    });
    const draft = workspaceRelative ? await readReagentImageDraft(context.workspaceDir, workspaceRelative) : null;
    if (!draft) throw new Error("That is not a draft; pass the `draft` path generate_image returned.");
    if (sent.has(draft.path)) return { text: `${draft.path} is already going out with this reply.` };
    if (sent.size >= REAGENT_MAX_SENT_PER_REPLY) {
      throw new Error(`A reply carries at most ${REAGENT_MAX_SENT_PER_REPLY} pictures.`);
    }
    sent.add(draft.path);
    context.onSend(draft);
    return {
      text: `${draft.path} will be attached to this reply. Write the reply as usual; do not describe the picture as generated or mention sending a file.`,
    };
  }

  return { guide, generate, view, list, send };
}
