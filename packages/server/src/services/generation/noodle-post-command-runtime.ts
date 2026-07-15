import { logger } from "../../lib/logger.js";
import type { CharacterCommand, NoodlePostCommand } from "../conversation/character-commands.js";
import { createManualNoodlePost } from "../noodle/noodle-manual-post.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import type { DB } from "../../db/connection.js";

export async function handleNoodlePostCommand(args: {
  command: CharacterCommand;
  characterId: string | null;
  db: DB;
}): Promise<boolean> {
  if (args.command.type !== "noodle_post") return false;
  const command = args.command as NoodlePostCommand;

  if (!args.characterId) {
    logger.debug("[commands] Skipped roleplay Noodle post: no speaking character to attribute it to");
    return true;
  }

  try {
    const noodle = createNoodleStorage(args.db);
    const characters = createCharactersStorage(args.db);
    const result = await createManualNoodlePost(noodle, characters, {
      authorKind: "character",
      authorEntityId: args.characterId,
      target: command.target,
      content: command.content,
    });
    if ("error" in result) {
      logger.debug(
        '[commands] Skipped roleplay Noodle post for character %s: %s (target="%s")',
        args.characterId,
        result.error,
        command.target,
      );
      return true;
    }
    logger.info(
      '[commands] Roleplay character %s posted to %s: %s',
      args.characterId,
      command.target,
      result.post.id,
    );
  } catch (err) {
    logger.error(err, "[commands] Roleplay Noodle post creation failed");
  }

  return true;
}
