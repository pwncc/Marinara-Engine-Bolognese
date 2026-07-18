// ──────────────────────────────────────────────
// Strip hidden <character_status> tags from visible/streaming text
// ──────────────────────────────────────────────

/** Tag name variants: character_status, character status, character-status */
const CHARACTER_STATUS_TAG = "character[\\s_-]*status";

const CHARACTER_STATUS_COMPLETE_RE = new RegExp(
  `<${CHARACTER_STATUS_TAG}>[\\s\\S]*?</${CHARACTER_STATUS_TAG}>`,
  "gi",
);
const CHARACTER_STATUS_OPEN_TAIL_RE = new RegExp(`<${CHARACTER_STATUS_TAG}[\\s\\S]*$`, "i");

/**
 * Strip a trailing "<charac"-style fragment: any tail whose normalized form is
 * a prefix of "character_status" (streaming chunks can cut the opener at any
 * character, which a whole-word regex misses).
 */
function stripPartialOpenTail(content: string): string {
  const idx = content.lastIndexOf("<");
  if (idx === -1) return content;
  const tail = content.slice(idx + 1);
  if (tail.includes(">")) return content;
  const normalized = tail.toLowerCase().replace(/[\s_-]+/g, "_");
  return "character_status".startsWith(normalized) ? content.slice(0, idx) : content;
}

/** Collapsible HTML wrappers models sometimes use around hidden status JSON. */
const CHARACTER_STATUS_DETAILS_RE =
  /<details\b[^>]*>\s*<summary\b[^>]*>\s*character[\s_-]*status\s*<\/summary>[\s\S]*?<\/details>/gi;
const EMPTY_DETAILS_RE = /<details\b[^>]*>\s*<summary\b[^>]*>[\s\S]*?<\/summary>\s*<\/details>/gi;

function stripCharacterStatusDetailsWrappers(content: string): string {
  let out = content.replace(CHARACTER_STATUS_DETAILS_RE, "");
  // Remove any <details> block that became empty after tag stripping
  for (let i = 0; i < 8; i++) {
    const next = out.replace(EMPTY_DETAILS_RE, (block) => {
      const inner = block
        .replace(/<details\b[^>]*>/i, "")
        .replace(/<\/details>/i, "")
        .replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, "")
        .trim();
      return inner ? block : "";
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Remove complete or in-progress <character_status> tags from text shown in the UI. */
export function stripCharacterStatusTagsForDisplay(content: string): string {
  if (!content) return content;
  let out = content.replace(CHARACTER_STATUS_COMPLETE_RE, "");
  out = out.replace(CHARACTER_STATUS_OPEN_TAIL_RE, "");
  out = stripPartialOpenTail(out);
  out = stripCharacterStatusDetailsWrappers(out);
  return out.replace(/\n{3,}/g, "\n\n");
}
