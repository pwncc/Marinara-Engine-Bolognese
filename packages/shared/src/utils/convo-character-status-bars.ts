// ──────────────────────────────────────────────
// Bar ordering and display helpers (CONVO status)
// ──────────────────────────────────────────────
import {
  CONVO_STATUS_BAR_SPECS,
  DEFAULT_CONVO_STATUS_BARS,
  isDefaultConvoBarKey,
  type ConvoBarMeta,
  type ConvoStatusBarSpec,
} from "../types/convo-character-status.js";

export function formatConvoBarKeyLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical spec for a default bar key, if it is one. */
export function getConvoBarSpec(key: string): ConvoStatusBarSpec | undefined {
  return CONVO_STATUS_BAR_SPECS.find((spec) => spec.key === key);
}

export function getConvoBarDisplayLabel(key: string, meta?: ConvoBarMeta): string {
  const label = meta?.label?.trim();
  if (label) return label;
  return getConvoBarSpec(key)?.label ?? formatConvoBarKeyLabel(key);
}

/** Effective description for a bar: user override first, then canonical spec. */
export function getConvoBarDescription(key: string, meta?: ConvoBarMeta): string | undefined {
  const description = meta?.description?.trim();
  if (description) return description;
  return getConvoBarSpec(key)?.description;
}

/** Default bars first (in canonical order), then custom keys alphabetically. */
export function listConvoBarKeys(bars: Record<string, number> | undefined): string[] {
  const keys = new Set(Object.keys(bars ?? {}));
  const ordered: string[] = [];
  for (const key of DEFAULT_CONVO_STATUS_BARS) {
    if (keys.has(key)) ordered.push(key);
  }
  for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
    if (!isDefaultConvoBarKey(key)) ordered.push(key);
  }
  return ordered;
}

export function sanitizeConvoBarKey(raw: string): string | null {
  const key = raw.trim().replace(/\s+/g, "_");
  if (!key || key.length > 64) return null;
  return key;
}

export function clampConvoBarValue(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
