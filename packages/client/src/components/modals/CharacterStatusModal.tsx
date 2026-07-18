// ──────────────────────────────────────────────
// Character body/mood status editor modal
// ──────────────────────────────────────────────
// Roomy replacement for the old floating status panel: per-character tabs,
// slider-based bars with canonical descriptions, emotion + cause, body states
// that only show what's set, and a snapshot-history picker.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ConvoBarMeta, ConvoCharacterStatus, ConvoCharacterStatusMap, Message } from "@marinara-engine/shared";
import {
  CONVO_STATUS_BAR_SPECS,
  DEFAULT_CONVO_STATUS_LIMBS,
  formatConvoBarKeyLabel,
  getConvoBarDisplayLabel,
  getConvoBarSpec,
  isDefaultConvoLimbKey,
  listConvoBarKeys,
  sanitizeConvoBarKey,
} from "@marinara-engine/shared";
import { Modal } from "../ui/Modal";
import { useChat, useUpdateChatMetadata, useUpdateMessageExtra } from "../../hooks/use-chats";
import { useCharacters } from "../../hooks/use-characters";
import { parseChatMetadata } from "../../lib/chat-display";
import {
  messageStatusHistoryLabel,
  migrateStatusBarKey,
  normalizeStatusDraft,
  pruneStatusDraft,
  readMessageConvoCharacterStatus,
} from "../chat/convo-character-status-utils";

const LIVE_SOURCE = "live";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs outline-none transition-colors focus:border-[var(--primary)]";
const sectionLabelClass = "text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]";

function parseCharacterIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === "string");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function parseCharacterName(data: unknown): string | null {
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    const name = (parsed as { name?: unknown } | null)?.name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

// ── Bar row ──

interface BarRowProps {
  barKey: string;
  value: number;
  meta?: ConvoBarMeta;
  expanded: boolean;
  onToggleExpand: () => void;
  onValueChange: (value: number) => void;
  onMetaChange: (meta: ConvoBarMeta) => void;
  onRenameKey: (newKey: string) => void;
  onRemove: () => void;
}

function BarRow({
  barKey,
  value,
  meta,
  expanded,
  onToggleExpand,
  onValueChange,
  onMetaChange,
  onRenameKey,
  onRemove,
}: BarRowProps) {
  const [keyDraft, setKeyDraft] = useState(barKey);
  const spec = getConvoBarSpec(barKey);
  const label = getConvoBarDisplayLabel(barKey, meta);
  const description = meta?.description?.trim() || spec?.description;

  useEffect(() => {
    setKeyDraft(barKey);
  }, [barKey]);

  const commitKeyRename = () => {
    const next = sanitizeConvoBarKey(keyDraft);
    if (!next || next === barKey) {
      setKeyDraft(barKey);
      return;
    }
    onRenameKey(next);
  };

  return (
    <div className="rounded-md border border-[var(--border)]/50 bg-[var(--card)]/50">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex h-5 w-4 shrink-0 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${label} details` : `Expand ${label} details`}
        >
          {expanded ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
        </button>
        <span className="w-24 shrink-0 truncate text-xs font-medium" title={description ?? label}>
          {label}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onValueChange(Number(e.target.value))}
          className="h-1.5 min-w-0 flex-1 accent-[var(--primary)]"
          aria-label={`${label} value`}
        />
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onValueChange(Number(e.target.value))}
          className={`${inputClass} w-14 shrink-0 text-center tabular-nums`}
          aria-label={`${label} percentage`}
        />
        <button
          type="button"
          className="shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
          onClick={onRemove}
          aria-label={`Remove ${label} bar`}
        >
          <Trash2 size="0.75rem" />
        </button>
      </div>
      {expanded ? (
        <div className="space-y-1.5 border-t border-[var(--border)]/50 px-2.5 py-2">
          {spec ? (
            <p className="text-[0.65rem] leading-snug text-[var(--muted-foreground)]">
              {spec.description} <span className="opacity-75">{spec.dynamics}</span>
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block space-y-0.5">
              <span className="text-[0.6rem] text-[var(--muted-foreground)]">Display name</span>
              <input
                className={inputClass}
                value={meta?.label ?? ""}
                onChange={(e) => onMetaChange({ ...(meta ?? {}), label: e.target.value })}
                placeholder={spec?.label ?? formatConvoBarKeyLabel(barKey)}
              />
            </label>
            <label className="block space-y-0.5">
              <span className="text-[0.6rem] text-[var(--muted-foreground)]">Key (JSON id)</span>
              <input
                className={inputClass}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onBlur={commitKeyRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitKeyRename();
                  }
                }}
              />
            </label>
          </div>
          <label className="block space-y-0.5">
            <span className="text-[0.6rem] text-[var(--muted-foreground)]">What this meter means (sent to the AI)</span>
            <textarea
              className={`${inputClass} min-h-[2rem] resize-y`}
              rows={1}
              value={meta?.description ?? ""}
              onChange={(e) => onMetaChange({ ...(meta ?? {}), description: e.target.value })}
              placeholder={spec ? "Override the built-in meaning…" : "What does this meter measure?"}
            />
          </label>
          <label className="block space-y-0.5">
            <span className="text-[0.6rem] text-[var(--muted-foreground)]">Notes for the AI</span>
            <textarea
              className={`${inputClass} min-h-[2rem] resize-y`}
              rows={1}
              value={meta?.notes ?? ""}
              onChange={(e) => onMetaChange({ ...(meta ?? {}), notes: e.target.value })}
              placeholder="Scene-specific reminders…"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

// ── Per-character editor form ──

type ExtraRow = { id: string; key: string; value: string };

interface StatusEditorFormProps {
  draft: ConvoCharacterStatus;
  onChange: (next: ConvoCharacterStatus) => void;
}

function StatusEditorForm({ draft, onChange }: StatusEditorFormProps) {
  const [expandedBars, setExpandedBars] = useState<Set<string>>(() => new Set());
  const [newBarKey, setNewBarKey] = useState("");
  const [newLimbKey, setNewLimbKey] = useState("");
  const [extraRows, setExtraRows] = useState<ExtraRow[]>([]);

  const barKeys = useMemo(() => listConvoBarKeys(draft.bars), [draft.bars]);
  const missingDefaultBars = useMemo(
    () => CONVO_STATUS_BAR_SPECS.filter((spec) => (draft.bars ?? {})[spec.key] === undefined),
    [draft.bars],
  );

  const setLimbKeys = useMemo(() => {
    const limbs = draft.limbs ?? {};
    return [
      ...DEFAULT_CONVO_STATUS_LIMBS.filter((key) => limbs[key] !== undefined),
      ...Object.keys(limbs)
        .filter((key) => !isDefaultConvoLimbKey(key))
        .sort((a, b) => a.localeCompare(b)),
    ];
  }, [draft.limbs]);
  const unsetDefaultLimbs = useMemo(
    () => DEFAULT_CONVO_STATUS_LIMBS.filter((key) => (draft.limbs ?? {})[key] === undefined),
    [draft.limbs],
  );

  useEffect(() => {
    const extras = draft.extras ?? {};
    setExtraRows((prev) => {
      const prevByKey = new Map(prev.map((row) => [row.key.trim(), row]));
      const next = Object.entries(extras)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ id: prevByKey.get(key)?.id ?? `extra-${key}`, key, value }));
      // Keep in-progress blank rows (being typed) at the end.
      for (const row of prev) {
        if (!row.key.trim() || !row.value.trim()) {
          if (!next.some((r) => r.id === row.id)) next.push(row);
        }
      }
      return next;
    });
  }, [draft.extras]);

  const toggleBarExpanded = (key: string) => {
    setExpandedBars((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setBar = (key: string, value: number) => {
    onChange({ ...draft, bars: { ...(draft.bars ?? {}), [key]: value } });
  };

  const setBarMeta = (key: string, meta: ConvoBarMeta) => {
    onChange({ ...draft, barMeta: { ...(draft.barMeta ?? {}), [key]: meta } });
  };

  const removeBar = (key: string) => {
    const nextBars = { ...(draft.bars ?? {}) };
    delete nextBars[key];
    const nextMeta = { ...(draft.barMeta ?? {}) };
    delete nextMeta[key];
    setExpandedBars((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    onChange({ ...draft, bars: nextBars, barMeta: nextMeta });
  };

  const renameBar = (oldKey: string, newKey: string) => {
    if ((draft.bars ?? {})[newKey] !== undefined) return;
    setExpandedBars((prev) => {
      const next = new Set(prev);
      if (next.has(oldKey)) {
        next.delete(oldKey);
        next.add(newKey);
      }
      return next;
    });
    onChange(migrateStatusBarKey(draft, oldKey, newKey));
  };

  const addBar = (key: string, value = 50) => {
    const clean = sanitizeConvoBarKey(key);
    if (!clean || (draft.bars ?? {})[clean] !== undefined) return;
    setBar(clean, value);
  };

  const setLimb = (key: string, value: string) => {
    onChange({ ...draft, limbs: { ...(draft.limbs ?? {}), [key]: value } });
  };

  const removeLimb = (key: string) => {
    const nextLimbs = { ...(draft.limbs ?? {}) };
    delete nextLimbs[key];
    onChange({ ...draft, limbs: nextLimbs });
  };

  const syncExtras = (rows: ExtraRow[]) => {
    setExtraRows(rows);
    const extras: Record<string, string> = {};
    for (const row of rows) {
      const key = row.key.trim();
      const value = row.value.trim();
      if (key && value) extras[key] = value;
    }
    onChange({ ...draft, extras });
  };

  return (
    <div className="space-y-4">
      {/* ── Mood ── */}
      <div className="space-y-1.5">
        <span className={sectionLabelClass}>Mood</span>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_1.4fr_1fr]">
          <label className="block space-y-0.5">
            <span className="text-[0.6rem] text-[var(--muted-foreground)]">Emotion</span>
            <input
              className={inputClass}
              value={draft.emotion ?? ""}
              onChange={(e) => onChange({ ...draft, emotion: e.target.value })}
              placeholder="jealous, giddy, tender…"
            />
          </label>
          <label className="block space-y-0.5">
            <span className="text-[0.6rem] text-[var(--muted-foreground)]">Because…</span>
            <input
              className={inputClass}
              value={draft.emotionCause ?? ""}
              onChange={(e) => onChange({ ...draft, emotionCause: e.target.value })}
              placeholder="why they feel this way"
            />
          </label>
          <label className="block space-y-0.5">
            <span className="text-[0.6rem] text-[var(--muted-foreground)]">Temperature</span>
            <input
              className={inputClass}
              value={draft.temperature ?? ""}
              onChange={(e) => onChange({ ...draft, temperature: e.target.value })}
              placeholder="warm, flushed, chilled…"
            />
          </label>
        </div>
      </div>

      {/* ── Bars ── */}
      <div className="space-y-1.5">
        <span className={sectionLabelClass}>Meters</span>
        <div className="space-y-1">
          {barKeys.map((key) => (
            <BarRow
              key={key}
              barKey={key}
              value={draft.bars?.[key] ?? 50}
              meta={draft.barMeta?.[key]}
              expanded={expandedBars.has(key)}
              onToggleExpand={() => toggleBarExpanded(key)}
              onValueChange={(v) => setBar(key, Number.isFinite(v) ? v : 0)}
              onMetaChange={(m) => setBarMeta(key, m)}
              onRenameKey={(newKey) => renameBar(key, newKey)}
              onRemove={() => removeBar(key)}
            />
          ))}
          {!barKeys.length ? (
            <p className="rounded-md border border-dashed border-[var(--border)] px-2 py-1.5 text-[0.65rem] text-[var(--muted-foreground)]">
              No meters yet — add the ones below, or let the AI establish them in chat.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {missingDefaultBars.map((spec) => (
            <button
              key={spec.key}
              type="button"
              onClick={() => addBar(spec.key)}
              className="flex items-center gap-0.5 rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 text-[0.65rem] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/60 hover:text-[var(--foreground)]"
              title={spec.description}
            >
              <Plus size="0.6rem" /> {spec.label}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <input
              className={`${inputClass} w-28`}
              value={newBarKey}
              onChange={(e) => setNewBarKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addBar(newBarKey);
                  setNewBarKey("");
                }
              }}
              placeholder="custom meter…"
            />
            <button
              type="button"
              onClick={() => {
                addBar(newBarKey);
                setNewBarKey("");
              }}
              disabled={!sanitizeConvoBarKey(newBarKey)}
              className="rounded-md border border-[var(--border)] px-1.5 py-1 text-[0.65rem] transition-colors hover:bg-[var(--accent)]/40 disabled:opacity-40"
              aria-label="Add custom meter"
            >
              <Plus size="0.7rem" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="space-y-1.5">
        <span className={sectionLabelClass}>Body</span>
        <p className="text-[0.65rem] leading-snug text-[var(--muted-foreground)]">
          Sensation, position, held items, objects inside — e.g. &quot;sore, holding a beer can&quot;. Only set parts are
          saved.
        </p>
        <div className="space-y-1">
          {setLimbKeys.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-xs text-[var(--muted-foreground)]">
                {formatConvoBarKeyLabel(key)}
              </span>
              <input
                className={inputClass}
                value={draft.limbs?.[key] ?? ""}
                onChange={(e) => setLimb(key, e.target.value)}
                placeholder="fine; sore; holding…"
              />
              <button
                type="button"
                className="shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
                onClick={() => removeLimb(key)}
                aria-label={`Clear ${formatConvoBarKeyLabel(key)}`}
              >
                <X size="0.75rem" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {unsetDefaultLimbs.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setLimb(key, "")}
              className="flex items-center gap-0.5 rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 text-[0.65rem] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/60 hover:text-[var(--foreground)]"
            >
              <Plus size="0.6rem" /> {formatConvoBarKeyLabel(key)}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <input
              className={`${inputClass} w-28`}
              value={newLimbKey}
              onChange={(e) => setNewLimbKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (newLimbKey.trim()) setLimb(newLimbKey.trim(), "");
                  setNewLimbKey("");
                }
              }}
              placeholder="custom part…"
            />
            <button
              type="button"
              onClick={() => {
                if (newLimbKey.trim()) setLimb(newLimbKey.trim(), "");
                setNewLimbKey("");
              }}
              disabled={!newLimbKey.trim()}
              className="rounded-md border border-[var(--border)] px-1.5 py-1 text-[0.65rem] transition-colors hover:bg-[var(--accent)]/40 disabled:opacity-40"
              aria-label="Add custom body part"
            >
              <Plus size="0.7rem" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Extras & notes ── */}
      <div className="space-y-1.5">
        <span className={sectionLabelClass}>Extras</span>
        {extraRows.map((row, idx) => (
          <div key={row.id} className="flex items-center gap-2">
            <input
              className={`${inputClass} w-32 shrink-0`}
              value={row.key}
              placeholder="field"
              onChange={(e) => {
                const rows = [...extraRows];
                rows[idx] = { ...row, key: e.target.value };
                syncExtras(rows);
              }}
            />
            <input
              className={inputClass}
              value={row.value}
              placeholder="value"
              onChange={(e) => {
                const rows = [...extraRows];
                rows[idx] = { ...row, value: e.target.value };
                syncExtras(rows);
              }}
            />
            <button
              type="button"
              className="shrink-0 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)]"
              onClick={() => syncExtras(extraRows.filter((_, i) => i !== idx))}
              aria-label="Remove extra field"
            >
              <X size="0.75rem" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="flex items-center gap-0.5 text-[0.65rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          onClick={() => setExtraRows([...extraRows, { id: `new-${Date.now()}`, key: "", value: "" }])}
        >
          <Plus size="0.65rem" /> Add field
        </button>
        <label className="block space-y-0.5">
          <span className="text-[0.6rem] text-[var(--muted-foreground)]">Notes</span>
          <textarea
            className={`${inputClass} min-h-[2.5rem] resize-y`}
            value={draft.notes ?? ""}
            onChange={(e) => onChange({ ...draft, notes: e.target.value })}
            placeholder="breathless, tipsy, aftercare…"
            rows={2}
          />
        </label>
      </div>
    </div>
  );
}

// ── Modal ──

interface CharacterStatusModalProps {
  open: boolean;
  onClose: () => void;
  chatId: string;
  initialCharacterId?: string | null;
  messages?: Message[];
}

export function CharacterStatusModal({
  open,
  onClose,
  chatId,
  initialCharacterId,
  messages,
}: CharacterStatusModalProps) {
  const { data: chat } = useChat(chatId);
  const { data: characters } = useCharacters();
  const updateMetadata = useUpdateChatMetadata();
  const updateMessageExtra = useUpdateMessageExtra(chatId);

  const chatCharIds = useMemo(() => parseCharacterIdList(chat?.characterIds), [chat?.characterIds]);
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const character of characters ?? []) {
      const name = parseCharacterName((character as { data?: unknown }).data);
      if (name) map.set((character as { id: string }).id, name);
    }
    return map;
  }, [characters]);

  const statusMap = useMemo(
    () => (parseChatMetadata(chat?.metadata).convoCharacterStatus ?? {}) as ConvoCharacterStatusMap,
    [chat?.metadata],
  );

  const [selectedCharId, setSelectedCharId] = useState<string | null>(initialCharacterId ?? null);
  const [historySource, setHistorySource] = useState(LIVE_SOURCE);
  const [drafts, setDrafts] = useState<Record<string, ConvoCharacterStatus>>({});
  const [dirty, setDirty] = useState(false);

  const activeCharId = selectedCharId && chatCharIds.includes(selectedCharId) ? selectedCharId : (chatCharIds[0] ?? null);

  const historyOptions = useMemo(() => {
    const options: Array<{ id: string; label: string }> = [{ id: LIVE_SOURCE, label: "Current (live)" }];
    if (!messages?.length) return options;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.role !== "assistant") continue;
      const snap = readMessageConvoCharacterStatus(msg);
      if (!snap || !Object.keys(snap).length) continue;
      const charName = msg.characterId ? nameById.get(msg.characterId) : "Assistant";
      options.push({ id: msg.id, label: messageStatusHistoryLabel(msg, i + 1, charName ?? undefined) });
    }
    return options;
  }, [messages, nameById]);

  const selectedSnapshot = useMemo((): ConvoCharacterStatusMap => {
    if (historySource === LIVE_SOURCE) return statusMap;
    const msg = messages?.find((m) => m.id === historySource);
    return (msg ? readMessageConvoCharacterStatus(msg) : undefined) ?? {};
  }, [historySource, statusMap, messages]);

  const resetDrafts = useCallback(
    (snapshot: ConvoCharacterStatusMap) => {
      const next: Record<string, ConvoCharacterStatus> = {};
      for (const id of chatCharIds) next[id] = normalizeStatusDraft(snapshot[id]);
      setDrafts(next);
      setDirty(false);
    },
    [chatCharIds],
  );

  useEffect(() => {
    if (!open) return;
    setHistorySource(LIVE_SOURCE);
    setSelectedCharId(initialCharacterId ?? null);
  }, [open, chatId, initialCharacterId]);

  useEffect(() => {
    if (dirty) return;
    resetDrafts(selectedSnapshot);
  }, [dirty, resetDrafts, selectedSnapshot]);

  const handleHistoryChange = useCallback(
    (sourceId: string) => {
      if (dirty && !window.confirm("Discard unsaved status edits?")) return;
      setHistorySource(sourceId);
      const snapshot =
        sourceId === LIVE_SOURCE
          ? statusMap
          : (readMessageConvoCharacterStatus(messages?.find((m) => m.id === sourceId) ?? ({} as Message)) ?? {});
      resetDrafts(snapshot);
    },
    [dirty, messages, resetDrafts, statusMap],
  );

  const handleDraftChange = useCallback((charId: string, next: ConvoCharacterStatus) => {
    setDrafts((prev) => ({ ...prev, [charId]: next }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    const convoCharacterStatus: ConvoCharacterStatusMap = {};
    for (const [charId, draft] of Object.entries(drafts)) {
      const pruned = pruneStatusDraft(draft);
      if (Object.keys(pruned).length) convoCharacterStatus[charId] = pruned;
    }
    try {
      if (historySource === LIVE_SOURCE) {
        await updateMetadata.mutateAsync({ id: chatId, convoCharacterStatus });
        toast.success("Character status saved");
      } else {
        await updateMessageExtra.mutateAsync({ messageId: historySource, extra: { convoCharacterStatus } });
        toast.success("Status snapshot updated for that message");
      }
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save status");
    }
  }, [chatId, drafts, historySource, updateMessageExtra, updateMetadata]);

  const saving = updateMetadata.isPending || updateMessageExtra.isPending;
  const viewingHistorical = historySource !== LIVE_SOURCE;

  return (
    <Modal open={open} onClose={onClose} title="Character status" width="max-w-2xl" mobileFullscreen>
      <div className="space-y-3">
        <p className="text-[0.7rem] leading-snug text-[var(--muted-foreground)]">
          The AI reads this ledger every turn and updates it with hidden{" "}
          <code className="rounded bg-[var(--secondary)] px-1">&lt;character_status&gt;</code> tags. Edits here become
          the new truth for the next reply.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {chatCharIds.length > 1 ? (
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
              {chatCharIds.map((id) => {
                const name = nameById.get(id) ?? "Character";
                const active = id === activeCharId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedCharId(id)}
                    className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)]/15 font-medium text-[var(--foreground)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)]/20 text-[0.55rem] font-semibold text-[var(--primary)]">
                      {name.charAt(0).toUpperCase()}
                    </span>
                    {name}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="flex-1 text-xs font-medium">{activeCharId ? (nameById.get(activeCharId) ?? "Character") : ""}</span>
          )}
          {historyOptions.length > 1 ? (
            <select
              className={`${inputClass} w-auto max-w-[14rem] shrink-0`}
              value={historySource}
              onChange={(e) => handleHistoryChange(e.target.value)}
              aria-label="Status history"
            >
              {historyOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {viewingHistorical ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[0.65rem] leading-snug text-amber-600 dark:text-amber-400">
            Viewing a per-message snapshot. Saving updates that message&apos;s snapshot only — switch to
            &quot;Current&quot; to edit the live ledger.
          </p>
        ) : null}

        {activeCharId ? (
          <StatusEditorForm
            draft={drafts[activeCharId] ?? normalizeStatusDraft(undefined)}
            onChange={(next) => handleDraftChange(activeCharId, next)}
          />
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">No characters in this chat.</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => resetDrafts(selectedSnapshot)}
            className="flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs transition-colors hover:bg-[var(--accent)]/40 disabled:opacity-40"
          >
            <RotateCcw size="0.7rem" /> Reset
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
            className="rounded-md bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
