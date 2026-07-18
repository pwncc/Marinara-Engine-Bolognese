// ──────────────────────────────────────────────
// Compact per-character body/mood strip (above the conversation input)
// ──────────────────────────────────────────────
// One slim row: a chip per character showing emotion + micro-meters.
// Clicking a chip opens the full CharacterStatusModal. Collapses to a tiny
// pill so it never competes with the transcript.
import { useCallback, useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import type { ConvoCharacterStatusMap, Message } from "@marinara-engine/shared";
import { getConvoBarDisplayLabel, listConvoBarKeys } from "@marinara-engine/shared";
import { useUIStore } from "../../stores/ui.store";
import { statusHasContent } from "./convo-character-status-utils";
import type { CharacterMap } from "./chat-area.types";

const STRIP_COLLAPSED_KEY = "marinara.convoStatus.stripCollapsed";
const MAX_CHIP_BARS = 3;

interface ConvoCharacterStatusStripProps {
  chatId: string;
  chatCharIds: string[];
  characterMap: CharacterMap;
  statusMap?: ConvoCharacterStatusMap;
  messages?: Message[];
}

export function ConvoCharacterStatusStrip({
  chatId,
  chatCharIds,
  characterMap,
  statusMap,
  messages,
}: ConvoCharacterStatusStripProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STRIP_COLLAPSED_KEY) === "1");
  const openModal = useUIStore((s) => s.openModal);

  const chips = useMemo(
    () =>
      chatCharIds
        .filter((id) => characterMap.has(id))
        .map((id) => {
          const info = characterMap.get(id)!;
          const status = statusMap?.[id];
          const barKeys = listConvoBarKeys(status?.bars).slice(0, MAX_CHIP_BARS);
          return {
            id,
            name: info.name,
            avatarUrl: info.avatarUrl ?? null,
            emotion: status?.emotion?.trim() || null,
            emotionCause: status?.emotionCause?.trim() || null,
            bars: barKeys.map((key) => ({
              key,
              label: getConvoBarDisplayLabel(key, status?.barMeta?.[key]),
              value: status?.bars?.[key] ?? 0,
            })),
            hasStatus: statusHasContent(status),
          };
        }),
    [chatCharIds, characterMap, statusMap],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STRIP_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const openEditor = useCallback(
    (characterId?: string) => {
      openModal("character-status", { chatId, initialCharacterId: characterId ?? null, messages: messages ?? [] });
    },
    [chatId, messages, openModal],
  );

  if (!chips.length) return null;

  if (collapsed) {
    return (
      <div className="flex justify-end px-3 pb-0.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-2 py-0.5 text-[0.6rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          title="Show character status"
        >
          <Activity size="0.65rem" />
          Status
          <ChevronUp size="0.6rem" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border)]/60 bg-[var(--card)]/60 px-2 py-1">
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:thin]">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => openEditor(chip.id)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)]/70 bg-[var(--secondary)]/60 py-0.5 pl-1 pr-2.5 text-left transition-colors hover:border-[var(--primary)]/60 hover:bg-[var(--accent)]/40"
              title={
                chip.hasStatus
                  ? `${chip.name}: ${chip.emotion ?? "no emotion set"}${chip.emotionCause ? ` — ${chip.emotionCause}` : ""}\nClick to view & edit`
                  : `${chip.name}: no status yet — click to set one`
              }
            >
              {chip.avatarUrl ? (
                <img src={chip.avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)]/20 text-[0.5rem] font-semibold text-[var(--primary)]">
                  {chip.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="max-w-[6rem] truncate text-[0.65rem] font-medium">{chip.name}</span>
              {chip.hasStatus ? (
                <>
                  {chip.emotion ? (
                    <span className="max-w-[7rem] truncate text-[0.6rem] italic text-[var(--muted-foreground)]">
                      {chip.emotion}
                    </span>
                  ) : null}
                  {chip.bars.length ? (
                    <span className="flex items-center gap-1">
                      {chip.bars.map((bar) => (
                        <span
                          key={bar.key}
                          className="h-1 w-6 overflow-hidden rounded-full bg-[var(--border)]/80"
                          title={`${bar.label}: ${bar.value}%`}
                        >
                          <span
                            className="block h-full rounded-full bg-[var(--primary)]/80"
                            style={{ width: `${Math.max(4, Math.min(100, bar.value))}%` }}
                          />
                        </span>
                      ))}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-[0.6rem] text-[var(--muted-foreground)]/70">no status</span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          title="Hide status strip"
          aria-label="Hide status strip"
        >
          <ChevronDown size="0.75rem" />
        </button>
      </div>
    </div>
  );
}
