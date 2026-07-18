// ──────────────────────────────────────────────
// World photos — minds attach generated images to their messages
// ──────────────────────────────────────────────
// A compact sibling of the conversation selfie pipeline: the mind writes an
// in-character photo description; we resolve the Noodle image connection (or
// the default image connection), generate, save to the chat gallery, and
// attach to the already-sent message. Fire-and-forget from wakes so image
// latency never blocks a character's turn.
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { compileImagePrompt } from "../image/image-prompt-compiler.js";
import { persistGeneratedImageToEntityGalleries } from "../image/generated-image-entity-gallery.js";
import { resolveConnectionImageDefaults } from "../image/image-generation-defaults.js";
import { generateImage, saveImageToDisk } from "../image/image-generation.js";
import { loadImageGenerationUserSettings } from "../image/image-generation-settings.js";
import { resolveImageConnectionFallback } from "../generation/media-connection-fallback.js";
import { createGalleryStorage } from "../storage/gallery.storage.js";
import { createCharacterGalleryStorage } from "../storage/character-gallery.storage.js";
import { createPersonaGalleryStorage } from "../storage/persona-gallery.storage.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";

function parseJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The image connection world photos use: Noodle's, falling back to the default. */
export async function resolveWorldImageConnection(db: DB) {
  const connections = createConnectionsStorage(db);
  const noodle = createNoodleStorage(db);
  const settings = await noodle.getSettings();
  if (settings.imageGenerationConnectionId) {
    return connections.getWithKey(settings.imageGenerationConnectionId);
  }
  const fallback = await connections.getDefaultForImageGeneration();
  return fallback ? connections.getWithKey(fallback.id) : null;
}

export async function hasWorldImageConnection(db: DB): Promise<boolean> {
  try {
    return !!(await resolveWorldImageConnection(db));
  } catch {
    return false;
  }
}

export interface WorldPhotoResult {
  imageUrl: string;
  galleryId?: string;
  prompt: string;
}

/**
 * Generate a photo for a message already sent and attach it. Returns the
 * attachment info, or null. Never throws — a failed photo is just a text message.
 */
export async function generateWorldPhoto(
  db: DB,
  input: {
    chatId: string;
    messageId: string;
    characterId: string;
    prompt: string;
    /** When the character appears in the image, blend in their appearance for likeness. */
    includeSelf?: boolean;
  },
): Promise<WorldPhotoResult | null> {
  try {
    const conn = await resolveWorldImageConnection(db);
    if (!conn) {
      logger.debug("[world/photo] No image connection available; skipping photo");
      return null;
    }
    const chats = createChatsStorage(db);
    const chars = createCharactersStorage(db);
    const gallery = createGalleryStorage(db);

    const charRow = (await chars.getById(input.characterId)) as { data: unknown } | null;
    const charData = parseJson(charRow?.data);
    const charName = typeof charData.name === "string" && charData.name.trim() ? charData.name.trim() : "character";
    const appearance =
      typeof charData.appearance === "string" && charData.appearance.trim()
        ? charData.appearance.trim().slice(0, 600)
        : typeof charData.description === "string"
          ? charData.description.trim().slice(0, 400)
          : "";

    // Characters can generate ANYTHING — their art, memes, the view, a photo
    // of someone else. Appearance only blends in when they're in the shot.
    const basePrompt =
      input.includeSelf && appearance ? `${input.prompt}\n\n${charName}'s appearance: ${appearance}` : input.prompt;

    const imgModel = conn.model || "";
    const imgBaseUrl = conn.baseUrl || "https://image.pollinations.ai";
    const imgApiKey = conn.apiKey || "";
    const imgSource = conn.imageGenerationSource || imgModel;
    const serviceHint = conn.imageService || "";
    const imageDefaults = resolveConnectionImageDefaults(conn);
    const imageSettings = await loadImageGenerationUserSettings(db);
    const compiled = compileImagePrompt({
      kind: input.includeSelf ? "selfie" : "illustration",
      prompt: basePrompt,
      styleProfiles: imageSettings.styleProfiles,
      styleProfileId: imageSettings.styleProfiles.defaultProfileId,
      imageDefaults,
    });
    const imageFallback = await resolveImageConnectionFallback(createConnectionsStorage(db), conn.id);

    const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, serviceHint || imgSource, {
      prompt: compiled.prompt,
      negativePrompt: compiled.negativePrompt || undefined,
      model: imgModel,
      width: imageSettings.selfie.width,
      height: imageSettings.selfie.height,
      imageEndpointId: conn.imageEndpointId || undefined,
      comfyWorkflow: conn.comfyuiWorkflow || undefined,
      imageDefaults,
      fallback: imageFallback,
    });

    const filePath = saveImageToDisk(input.chatId, imageResult.base64, imageResult.ext);
    const provider = imageResult.effectiveConnection?.provider ?? conn.provider ?? "image_generation";
    const model = imageResult.effectiveConnection?.model || imgModel || "unknown";
    const galleryEntry = await gallery.create({
      chatId: input.chatId,
      filePath,
      prompt: compiled.prompt,
      provider,
      model,
      width: imageSettings.selfie.width,
      height: imageSettings.selfie.height,
    });
    await persistGeneratedImageToEntityGalleries({
      sourceFilePath: filePath,
      characterIds: [input.characterId],
      characterGallery: createCharacterGalleryStorage(db),
      personaGallery: createPersonaGalleryStorage(db),
      prompt: compiled.prompt,
      provider,
      model,
      width: imageSettings.selfie.width,
      height: imageSettings.selfie.height,
    });

    const filename = filePath.split("/").pop()!;
    const imageUrl = `/api/gallery/file/${input.chatId}/${encodeURIComponent(filename)}`;
    const attachment = {
      type: "image",
      url: imageUrl,
      filename: `photo_${charName.toLowerCase().replace(/\s+/g, "_")}.${imageResult.ext}`,
      prompt: compiled.prompt,
      galleryId: galleryEntry?.id,
    };
    const message = await chats.getMessage(input.messageId);
    const activeSwipeIndex = message?.activeSwipeIndex ?? 0;
    await chats.appendSwipeAttachment(input.messageId, activeSwipeIndex, attachment);
    if (message) {
      await chats.appendMessageAttachment(input.messageId, attachment);
    }
    logger.info("[world/photo] %s attached a photo in chat %s", charName, input.chatId);
    return { imageUrl, galleryId: galleryEntry?.id, prompt: compiled.prompt };
  } catch (error) {
    logger.warn(error, "[world/photo] Photo generation failed for chat %s", input.chatId);
    return null;
  }
}
