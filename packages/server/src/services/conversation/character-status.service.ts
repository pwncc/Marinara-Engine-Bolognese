// ──────────────────────────────────────────────
// Conversation character status — parse, merge, prompt formatting
// ──────────────────────────────────────────────
// Per-character body/mood ledger for Conversation and Roleplay chats.
// The model reads a <character_status_context> block each turn and patches
// state with hidden <character_status>{...json...}</character_status> tags,
// which are parsed + stripped at generation finalization (generate.routes.ts).
// The live map lives in chat metadata (`convoCharacterStatus`); every turn
// that patched it also snapshots the full map into that message swipe's
// `extra.convoCharacterStatus`, so history can be rebuilt after deletes,
// swipe switches, and regenerations.
import {
  CONVO_STATUS_BAR_SPECS,
  DEFAULT_CONVO_STATUS_LIMBS,
  getConvoBarDisplayLabel,
  isDefaultConvoLimbKey,
  listConvoBarKeys,
  normalizeTextForMatch,
  type ConvoBarMeta,
  type ConvoCharacterStatus,
  type ConvoCharacterStatusMap,
} from "@marinara-engine/shared";

const CHARACTER_STATUS_TAG_RE =
  /<character[\s_-]*status>([\s\S]*?)<\/character[\s_-]*status>/gi;

// ── Normalization ──

function clampBar(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeStringRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || !key.trim()) continue;
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) out[key.trim()] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeBarMetaRecord(raw: unknown): Record<string, ConvoBarMeta> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, ConvoBarMeta> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || !key.trim() || !value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const row = value as Record<string, unknown>;
    const meta: ConvoBarMeta = {};
    if (typeof row.label === "string" && row.label.trim()) {
      meta.label = row.label.trim().slice(0, 120);
    }
    if (typeof row.description === "string" && row.description.trim()) {
      meta.description = row.description.trim().slice(0, 400);
    }
    if (typeof row.notes === "string" && row.notes.trim()) {
      meta.notes = row.notes.trim().slice(0, 400);
    }
    if (Object.keys(meta).length) out[key.trim()] = meta;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeBarsRecord(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || !key.trim()) continue;
    const clamped = clampBar(typeof value === "string" ? Number.parseFloat(value) : value);
    if (clamped === undefined) continue;
    out[key.trim()] = clamped;
  }
  return Object.keys(out).length ? out : undefined;
}

const STATUS_SCALAR_KEYS = ["temperature", "emotion", "emotionCause", "notes"] as const;
const STATUS_OBJECT_KEYS = ["bars", "barMeta", "limbs", "extras"] as const;

/** Parse a partial status patch from JSON (hidden tag body or manual edit). */
export function normalizeConvoCharacterStatusPatch(raw: unknown): ConvoCharacterStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const patch: ConvoCharacterStatus = {};

  if (typeof data.temperature === "string" && data.temperature.trim()) {
    patch.temperature = data.temperature.trim().slice(0, 120);
  }
  if (typeof data.emotion === "string" && data.emotion.trim()) {
    patch.emotion = data.emotion.trim().slice(0, 120);
  }
  // Accept a couple of near-miss spellings models produce for the cause field.
  const rawCause = data.emotionCause ?? data.emotion_cause ?? data.emotionReason ?? data.because;
  if (typeof rawCause === "string" && rawCause.trim()) {
    patch.emotionCause = rawCause.trim().slice(0, 200);
  }
  if (typeof data.notes === "string" && data.notes.trim()) {
    patch.notes = data.notes.trim().slice(0, 500);
  }

  const bars = normalizeBarsRecord(data.bars);
  if (bars) patch.bars = bars;

  const limbs = normalizeStringRecord(data.limbs);
  if (limbs) patch.limbs = limbs;

  const extras = normalizeStringRecord(data.extras);
  if (extras) patch.extras = extras;

  const barMeta = normalizeBarMetaRecord(data.barMeta);
  if (barMeta) patch.barMeta = barMeta;

  // Allow top-level bar keys for compact patches: {"arousal": 90, "stress": 10}
  const topLevelBars: Record<string, number> = { ...(patch.bars ?? {}) };
  for (const [key, value] of Object.entries(data)) {
    if ((STATUS_SCALAR_KEYS as readonly string[]).includes(key)) continue;
    if ((STATUS_OBJECT_KEYS as readonly string[]).includes(key)) continue;
    const clamped = clampBar(typeof value === "string" ? Number.parseFloat(value) : value);
    if (clamped !== undefined) topLevelBars[key] = clamped;
  }
  if (Object.keys(topLevelBars).length) patch.bars = topLevelBars;

  return Object.keys(patch).length ? patch : null;
}

// ── Merge & map helpers ──

export function mergeConvoCharacterStatus(
  existing: ConvoCharacterStatus | undefined,
  patch: ConvoCharacterStatus,
): ConvoCharacterStatus {
  const base = existing ?? {};
  const merged: ConvoCharacterStatus = {
    ...base,
    ...patch,
    bars: { ...(base.bars ?? {}), ...(patch.bars ?? {}) },
    barMeta: { ...(base.barMeta ?? {}), ...(patch.barMeta ?? {}) },
    limbs: { ...(base.limbs ?? {}), ...(patch.limbs ?? {}) },
    extras: { ...(base.extras ?? {}), ...(patch.extras ?? {}) },
  };
  // A new emotion without a cause invalidates the old cause — a stale "why"
  // attached to a fresh feeling reads as nonsense in the prompt.
  if (patch.emotion && !patch.emotionCause) delete merged.emotionCause;
  if (!Object.keys(merged.bars ?? {}).length) delete merged.bars;
  if (!Object.keys(merged.barMeta ?? {}).length) delete merged.barMeta;
  if (!Object.keys(merged.limbs ?? {}).length) delete merged.limbs;
  if (!Object.keys(merged.extras ?? {}).length) delete merged.extras;
  return merged;
}

/** Deep-clone a status map for per-message snapshots. */
export function cloneConvoCharacterStatusMap(map: ConvoCharacterStatusMap): ConvoCharacterStatusMap {
  return JSON.parse(JSON.stringify(map)) as ConvoCharacterStatusMap;
}

export function readConvoCharacterStatusMap(meta: Record<string, unknown>): ConvoCharacterStatusMap {
  const raw = meta.convoCharacterStatus;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ConvoCharacterStatusMap;
}

/** Apply attributed patches onto a map, returning a new map (input untouched). */
export function applyConvoCharacterStatusPatches(
  map: ConvoCharacterStatusMap,
  patches: ReadonlyArray<{ characterId: string; patch: ConvoCharacterStatus }>,
): ConvoCharacterStatusMap {
  const next = cloneConvoCharacterStatusMap(map);
  for (const { characterId, patch } of patches) {
    if (!characterId) continue;
    next[characterId] = mergeConvoCharacterStatus(next[characterId], patch);
  }
  return next;
}

// ── Tag parsing ──

export function parseCharacterStatusTags(content: string): {
  cleanContent: string;
  patches: ConvoCharacterStatus[];
} {
  const patches: ConvoCharacterStatus[] = [];
  for (const match of content.matchAll(CHARACTER_STATUS_TAG_RE)) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
      const patch = normalizeConvoCharacterStatusPatch(parsed);
      if (patch) patches.push(patch);
    } catch {
      /* ignore invalid JSON */
    }
  }
  const cleanContent = content
    .replace(CHARACTER_STATUS_TAG_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanContent, patches };
}

/**
 * Parse status tags from a merged group response, attributing each patch to
 * the speaker of the `Name:`-prefixed segment it appears in (mirroring
 * parseCharacterCommandsBySpeaker). Text above the first recognized prefix is
 * credited to the first named speaker; unattributable patches fall back to
 * `fallbackCharacterId`.
 */
export function parseCharacterStatusTagsBySpeaker(
  content: string,
  knownCharacters: ReadonlyArray<{ id: string; name: string }>,
  fallbackCharacterId: string | null,
): { cleanContent: string; patches: Array<{ characterId: string | null; patch: ConvoCharacterStatus }> } {
  const base = parseCharacterStatusTags(content);

  const nameToId = new Map<string, string>();
  for (const character of knownCharacters) {
    const key = normalizeTextForMatch(character.name);
    if (key && !nameToId.has(key)) nameToId.set(key, character.id);
  }

  const segments: Array<{ characterId: string | null; text: string; leading: boolean }> = [];
  let currentId: string | null = fallbackCharacterId;
  let inLeadingRegion = true;
  let currentLines: string[] = [];
  const flush = () => {
    if (currentLines.length > 0) {
      segments.push({ characterId: currentId, text: currentLines.join("\n"), leading: inLeadingRegion });
    }
    currentLines = [];
  };
  for (const line of content.split("\n")) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx > 0) {
      const mappedId = nameToId.get(normalizeTextForMatch(line.slice(0, colonIdx)));
      if (mappedId) {
        flush();
        inLeadingRegion = false;
        currentId = mappedId;
        currentLines = [line.slice(colonIdx + 2)];
        continue;
      }
    }
    currentLines.push(line);
  }
  flush();

  const firstNamed = segments.find((segment) => !segment.leading);
  if (firstNamed) {
    for (const segment of segments) {
      if (segment.leading) segment.characterId = firstNamed.characterId;
    }
  }

  // Match whole-response patches to per-segment parses by shape, consumed in
  // order so duplicate patches attribute left-to-right.
  const queue = new Map<string, (string | null)[]>();
  for (const segment of segments) {
    for (const patch of parseCharacterStatusTags(segment.text).patches) {
      const key = JSON.stringify(patch);
      const ids = queue.get(key) ?? [];
      ids.push(segment.characterId);
      queue.set(key, ids);
    }
  }

  const patches = base.patches.map((patch) => {
    const ids = queue.get(JSON.stringify(patch));
    const matched = ids?.shift();
    return { characterId: matched === undefined ? fallbackCharacterId : matched, patch };
  });

  return { cleanContent: base.cleanContent, patches };
}

// ── Transcript resolution (regen / delete / swipe correctness) ──

function parseMessageExtra(extra: unknown): Record<string, unknown> {
  if (!extra) return {};
  if (typeof extra === "string") {
    try {
      const parsed = JSON.parse(extra);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof extra === "object" && !Array.isArray(extra)) {
    return extra as Record<string, unknown>;
  }
  return {};
}

export type TranscriptMessageForStatus = {
  id?: string;
  extra?: unknown;
};

/**
 * Rebuild chat status from per-message snapshots (extra.convoCharacterStatus).
 * Each snapshot is the full map captured after that turn; the latest
 * applicable snapshot wins. Snapshots ride the active swipe's extra, so swipe
 * switches change the resolved state automatically.
 */
export function resolveConvoCharacterStatusFromTranscript(
  messages: readonly TranscriptMessageForStatus[],
  options?: { beforeMessageId?: string; excludeMessageIds?: Iterable<string> },
): ConvoCharacterStatusMap {
  const exclude = new Set(options?.excludeMessageIds ?? []);
  let endIndex = messages.length;
  if (options?.beforeMessageId) {
    const idx = messages.findIndex((m) => m.id === options.beforeMessageId);
    if (idx >= 0) endIndex = idx;
  }

  let resolved: ConvoCharacterStatusMap = {};
  for (let i = 0; i < endIndex; i++) {
    const msg = messages[i]!;
    if (msg.id && exclude.has(msg.id)) continue;
    const raw = parseMessageExtra(msg.extra).convoCharacterStatus;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      resolved = cloneConvoCharacterStatusMap(raw as ConvoCharacterStatusMap);
    }
  }
  return resolved;
}

export type ChatsStorageForStatusSync = {
  listMessages: (chatId: string) => Promise<TranscriptMessageForStatus[]>;
  patchMetadata: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
};

/** Persist transcript-derived status into chat metadata. */
export async function syncChatConvoCharacterStatusFromTranscript(
  chats: ChatsStorageForStatusSync,
  chatId: string,
  options?: { beforeMessageId?: string; excludeMessageIds?: Iterable<string> },
): Promise<ConvoCharacterStatusMap> {
  const rows = await chats.listMessages(chatId);
  const resolved = resolveConvoCharacterStatusFromTranscript(rows, options);
  await chats.patchMetadata(chatId, { convoCharacterStatus: resolved });
  return resolved;
}

export async function maybeSyncChatConvoCharacterStatusFromTranscript(
  chats: ChatsStorageForStatusSync,
  chatId: string,
  chatMode: string,
  meta: Record<string, unknown>,
  options?: { beforeMessageId?: string; excludeMessageIds?: Iterable<string> },
): Promise<ConvoCharacterStatusMap | null> {
  if (!isCharacterStatusEnabled(chatMode, meta)) return null;
  return syncChatConvoCharacterStatusFromTranscript(chats, chatId, options);
}

// ── Enablement ──

/**
 * Whether the ledger is active for this chat.
 * Conversation: on by default, governed by the master hidden-commands switch
 * plus the per-chat `character_status` command toggle.
 * Roleplay / VN: opt-in via the chat's `characterStatus` setting.
 */
export function isCharacterStatusEnabled(chatMode: string, meta: Record<string, unknown>): boolean {
  if (chatMode === "conversation") {
    if (meta.characterCommands === false) return false;
    const toggles = meta.conversationCommandToggles;
    if (toggles && typeof toggles === "object" && !Array.isArray(toggles)) {
      return (toggles as Record<string, unknown>).character_status !== false;
    }
    return true;
  }
  if (chatMode === "roleplay" || chatMode === "visual_novel") {
    return meta.characterStatus === true;
  }
  return false;
}

// ── Prompt building ──

/** Single ledger entry rendered into <character_physical_status>. */
export function formatConvoCharacterStatusLine(name: string, status: ConvoCharacterStatus): string {
  const lines: string[] = [];
  if (status.emotion) {
    lines.push(`  emotion: ${status.emotion}${status.emotionCause ? ` — ${status.emotionCause}` : ""}`);
  }
  if (status.temperature) lines.push(`  temperature: ${status.temperature}`);
  const bars = status.bars ?? {};
  const barMeta = status.barMeta ?? {};
  const barKeys = listConvoBarKeys(bars);
  if (barKeys.length) {
    lines.push("  bars:");
    for (const key of barKeys) {
      const meta = barMeta[key];
      const label = getConvoBarDisplayLabel(key, meta);
      const labelSuffix = label.toLowerCase() !== key.toLowerCase() ? ` (${label})` : "";
      lines.push(`    ${key}: ${bars[key]}%${labelSuffix}`);
      if (meta?.description) lines.push(`      meaning: ${meta.description}`);
      if (meta?.notes) lines.push(`      note: ${meta.notes}`);
    }
  }
  const limbs = status.limbs ?? {};
  const limbKeys = [
    ...DEFAULT_CONVO_STATUS_LIMBS.filter((k) => limbs[k]),
    ...Object.keys(limbs)
      .filter((k) => !isDefaultConvoLimbKey(k))
      .sort((a, b) => a.localeCompare(b)),
  ];
  if (limbKeys.length) {
    lines.push("  body:");
    for (const key of limbKeys) {
      lines.push(`    ${key}: ${limbs[key]}`);
    }
  }
  for (const [key, value] of Object.entries(status.extras ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${key}: ${value}`);
  }
  if (status.notes) lines.push(`  notes: ${status.notes}`);
  if (!lines.length) return `${name}: (ledger empty — establish it with <character_status> when body/mood matters)`;
  return [`${name}:`, ...lines].join("\n");
}

/** Per-turn directive + ledger block, injected right before <commands>. */
export function formatConvoCharacterStatusContextBlock(
  statusMap: ConvoCharacterStatusMap,
  characterIds: string[],
  idToName: Map<string, string>,
  options?: { isGroupChat?: boolean },
): string {
  const snapshotLines: string[] = [];
  for (const charId of characterIds) {
    const status = statusMap[charId];
    if (!status || !Object.keys(status).length) continue;
    const name = idToName.get(charId) ?? "Character";
    snapshotLines.push(formatConvoCharacterStatusLine(name, status));
  }

  const hasAny = snapshotLines.length > 0;
  const groupLine = options?.isGroupChat
    ? `Group scene: each ledger below belongs to one character. Only patch the ledger of the character speaking — patches are attributed to the speaker whose section they appear in.`
    : null;

  const directive = hasAny
    ? [
        `<character_status_directive>`,
        `The ledger below is your character's current body/mood state. Treat it as fact:`,
        `1. Let it shape this reply — emotion (and its cause) sets your tone; bars set your physical capacity; body states constrain movement.`,
        `2. Show it through behavior and word choice; never recite the numbers.`,
        `3. If this turn changes anything, append ONE hidden <character_status> patch (see <commands>) at the very start or very end of your reply. When your feeling shifts, update emotion AND emotionCause together.`,
        ...(groupLine ? [groupLine] : []),
        `</character_status_directive>`,
      ]
    : [
        `<character_status_directive>`,
        `No body/mood ledger exists yet for this chat. If this turn involves your body, mood, energy, pain, or desire, establish a baseline with one hidden <character_status> tag (see <commands>) — emotion + emotionCause, temperature, the bars you'll track, and any notable body states.`,
        ...(groupLine ? [groupLine] : []),
        `</character_status_directive>`,
      ];

  const inner = [
    ...directive,
    `<character_physical_status>`,
    ...(hasAny ? snapshotLines : [`(empty)`]),
    `</character_physical_status>`,
  ].join("\n");
  return `<character_status_context>\n${inner}\n</character_status_context>`;
}

/** Hidden-command instructions for the <commands> block. */
export function buildCharacterStatusCommandInstructionLines(
  mode: "conversation" | "roleplay" = "conversation",
): string[] {
  const sceneLabel = mode === "roleplay" ? "scene" : "conversation";
  const barLines = CONVO_STATUS_BAR_SPECS.map(
    (spec) => `  • ${spec.key} — ${spec.description} ${spec.dynamics}`,
  );

  return [
    `- <character_status>{...JSON...}</character_status> — your HIDDEN body/mood ledger (stripped before the user sees the message). Send at most ONE tag per reply, at the very start or very end — never mid-dialogue.`,
    `  WHEN: any turn that meaningfully changes body or mood — eating, exertion, intimacy, orgasm, injury, illness, alcohol, sleep, strong emotional beats, or any bar moving ~10+ points. First relevant turn: send a fuller baseline. Pure small talk: skip it.`,
    `  JSON — send ONLY what changed; omitted fields keep their previous values:`,
    `  {`,
    `    "emotion": "dominant feeling, 1-2 words",`,
    `    "emotionCause": "why — one short clause (always pair with emotion)",`,
    `    "temperature": "body heat in plain words (warm, flushed, chilled)",`,
    `    "notes": "other bodily facts (shaking, tipsy, breathless)",`,
    `    "bars": { "happiness": 0-100, "hunger": 0-100, "horny": 0-100, "arousal": 0-100, "energy": 0-100, "stress": 0-100, custom keys OK },`,
    `    "limbs": { "head|neck|torso|leftArm|rightArm|leftHand|rightHand|leftLeg|rightLeg|groin|custom": "sensation + position + objects held or inside" }`,
    `  }`,
    `  BARS (integers 0-100):`,
    ...barLines,
    `  KEEP horny AND arousal DISTINCT: horny = appetite (how much they want it; slow, survives climax). arousal = the body's build-up (how close to orgasm; fast, ~0 right after climax). A character can be very horny at low arousal, and vice versa.`,
    `  EMOTION: always send emotion and emotionCause together, and refresh BOTH whenever the feeling shifts — a stale cause is worse than none. The pair should explain your tone this turn.`,
    `  LIMBS: short phrases — sensation (sore, numb, trembling), position (crossed, raised), objects held or inside when relevant. "fine" when nothing notable; omit unchanged limbs. Add custom parts (mouth, ass, wings…) as needed for the ${sceneLabel}.`,
    `  Example: <character_status>{"emotion":"flustered","emotionCause":"you complimented me in front of everyone","temperature":"warm","bars":{"happiness":76,"horny":58,"arousal":20,"stress":34},"limbs":{"torso":"heart racing","rightHand":"fidgeting with my sleeve"}}</character_status>`,
    ``,
  ];
}

/** Standalone <commands> block for Roleplay mode (which has no shared commands reminder). */
export function buildRoleplayCharacterStatusCommandsReminder(): string {
  return [
    `<commands>`,
    `Hidden commands for this roleplay (stripped before the user sees your message):`,
    ``,
    ...buildCharacterStatusCommandInstructionLines("roleplay"),
    `</commands>`,
  ].join("\n");
}
