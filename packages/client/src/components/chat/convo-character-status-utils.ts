// ──────────────────────────────────────────────
// Helpers for CONVO character status (draft editing + per-message snapshots)
// ──────────────────────────────────────────────
import type { ConvoBarMeta, ConvoCharacterStatus, ConvoCharacterStatusMap, Message } from "@marinara-engine/shared";

export function readMessageConvoCharacterStatus(message: Message): ConvoCharacterStatusMap | undefined {
  try {
    const extra: Record<string, unknown> =
      typeof message.extra === "string"
        ? (JSON.parse(message.extra) as Record<string, unknown>)
        : ({ ...(message.extra ?? {}) } as Record<string, unknown>);
    const raw = extra.convoCharacterStatus;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    return raw as ConvoCharacterStatusMap;
  } catch {
    return undefined;
  }
}

export function messageStatusHistoryLabel(
  message: Message,
  displayIndex: number,
  characterName?: string,
): string {
  const name = characterName ?? "Character";
  const preview = message.content.replace(/\s+/g, " ").trim().slice(0, 40);
  const suffix = preview ? ` — ${preview}${preview.length >= 40 ? "…" : ""}` : "";
  return `#${displayIndex} ${name}${suffix}`;
}

/** Working copy of a status with all containers present (no default seeding). */
export function normalizeStatusDraft(status?: ConvoCharacterStatus): ConvoCharacterStatus {
  return {
    temperature: status?.temperature ?? "",
    emotion: status?.emotion ?? "",
    emotionCause: status?.emotionCause ?? "",
    notes: status?.notes ?? "",
    bars: { ...(status?.bars ?? {}) },
    barMeta: { ...(status?.barMeta ?? {}) },
    limbs: { ...(status?.limbs ?? {}) },
    extras: { ...(status?.extras ?? {}) },
  };
}

function pruneBarMeta(
  barMeta: Record<string, ConvoBarMeta> | undefined,
  barKeys: Set<string>,
): Record<string, ConvoBarMeta> | undefined {
  if (!barMeta) return undefined;
  const out: Record<string, ConvoBarMeta> = {};
  for (const [key, meta] of Object.entries(barMeta)) {
    if (!barKeys.has(key)) continue;
    const row: ConvoBarMeta = {};
    const label = meta.label?.trim();
    const description = meta.description?.trim();
    const notes = meta.notes?.trim();
    if (label) row.label = label;
    if (description) row.description = description;
    if (notes) row.notes = notes;
    if (Object.keys(row).length) out[key] = row;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Drop empty fields so saved statuses stay minimal. */
export function pruneStatusDraft(draft: ConvoCharacterStatus): ConvoCharacterStatus {
  const bars: Record<string, number> = {};
  for (const [key, value] of Object.entries(draft.bars ?? {})) {
    if (!Number.isFinite(value)) continue;
    bars[key] = Math.max(0, Math.min(100, Math.round(value)));
  }
  const barKeys = new Set(Object.keys(bars));
  const limbs: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft.limbs ?? {})) {
    const text = value.trim();
    if (text) limbs[key] = text;
  }
  const extras: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft.extras ?? {})) {
    const text = value.trim();
    if (key.trim() && text) extras[key.trim()] = text;
  }
  const out: ConvoCharacterStatus = {};
  const temp = draft.temperature?.trim();
  const emotion = draft.emotion?.trim();
  const emotionCause = draft.emotionCause?.trim();
  const notes = draft.notes?.trim();
  if (temp) out.temperature = temp;
  if (emotion) out.emotion = emotion;
  if (emotionCause) out.emotionCause = emotionCause;
  if (notes) out.notes = notes;
  if (Object.keys(bars).length) out.bars = bars;
  const barMeta = pruneBarMeta(draft.barMeta, barKeys);
  if (barMeta) out.barMeta = barMeta;
  if (Object.keys(limbs).length) out.limbs = limbs;
  if (Object.keys(extras).length) out.extras = extras;
  return out;
}

/** Rename a bar key, carrying its value and meta along. */
export function migrateStatusBarKey(
  draft: ConvoCharacterStatus,
  oldKey: string,
  newKey: string,
): ConvoCharacterStatus {
  if (oldKey === newKey) return draft;
  const bars = { ...(draft.bars ?? {}) };
  const value = bars[oldKey];
  if (value === undefined) return draft;
  delete bars[oldKey];
  bars[newKey] = value;

  const barMeta = { ...(draft.barMeta ?? {}) };
  const meta = barMeta[oldKey];
  if (meta) {
    delete barMeta[oldKey];
    barMeta[newKey] = meta;
  }
  return { ...draft, bars, barMeta };
}

/** True when a status has anything worth showing. */
export function statusHasContent(status: ConvoCharacterStatus | undefined): boolean {
  if (!status) return false;
  return Object.keys(pruneStatusDraft(normalizeStatusDraft(status))).length > 0;
}
