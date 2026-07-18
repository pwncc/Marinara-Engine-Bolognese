import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, "extension.css"), "utf8");
const js = readFileSync(join(dir, "extension.js"), "utf8");

const manifest = {
  name: "CONVO Character Status",
  description:
    "Body/mood status panel for Conversation chats. AI can update via hidden <character_status> tags; status stays in prompt context.",
  css,
  js,
};

writeFileSync(join(dir, "convo-character-status.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log("Wrote convo-character-status.json");
