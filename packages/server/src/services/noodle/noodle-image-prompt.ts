// Joins text blocks (each already internally formatted, single- or
// multi-line) with a blank line between them, while dropping any line from a
// later block that's a near-duplicate (normalized on whitespace/case) of one
// already emitted by an earlier block. Guards against the same
// appearance/personality sentence surviving from two different source
// blocks into one image prompt, without disturbing each block's own
// internal line breaks.
export function joinDedupedBlocks(blocks: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const keptBlocks: string[] = [];
  for (const block of blocks) {
    if (!block?.trim()) continue;
    const keptLines = block.split("\n").filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    if (keptLines.length > 0) keptBlocks.push(keptLines.join("\n"));
  }
  return keptBlocks.join("\n\n");
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1]?.trim() || trimmed;
}

/**
 * Recover the visual idea when a weaker timeline model wraps imagePrompt in
 * JSON or repeats Marinara's legacy prompt-assembly labels inside the field.
 */
export function normalizeNoodleImagePrompt(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const candidate = stripCodeFence(value);

  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      for (const key of ["imagePrompt", "image_prompt", "prompt", "draftPrompt"]) {
        const nested = parsed[key];
        if (typeof nested === "string" && nested.trim() && nested.trim() !== candidate) {
          return normalizeNoodleImagePrompt(nested);
        }
      }
      return null;
    } catch {
      // Keep the original text when it only happens to begin with a brace.
    }
  }

  const legacyMarker = /(?:^|\n)\s*(?:draft image idea|image prompt)\s*:\s*/iu.exec(candidate);
  if (legacyMarker?.index !== undefined) {
    const visualStart = legacyMarker.index + legacyMarker[0].length;
    const visualTail = candidate.slice(visualStart);
    const nextMetadata = visualTail.search(
      /\n\s*(?:user instructions|character appearance notes|post text|output only)\s*:/iu,
    );
    const recovered = (nextMetadata >= 0 ? visualTail.slice(0, nextMetadata) : visualTail).trim();
    if (recovered) return recovered;
  }

  return candidate;
}
