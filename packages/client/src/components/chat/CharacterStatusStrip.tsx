// ──────────────────────────────────────────────
// Compact per-character status strip (above the conversation input)
// ──────────────────────────────────────────────
// One slim row: a chip per present character showing mood and a few stat
// meters, read from the tracker's game state. Clicking a chip opens the
// tracker's character cards. Collapses to a tiny pill so it never competes
// with the transcript.
import { useCallback, useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import type { PresentCharacter } from "@marinara-engine/shared";
import { useTranslation as useUiTranslation } from "react-i18next";
import { useTrackerGameState } from "../../features/tracker-panel/hooks/use-tracker-game-state";
import type { CharacterMap } from "./chat-area.types";
import { ConversationTrackerModal } from "./ConversationTrackerModal";

const STRIP_COLLAPSED_KEY = "marinara.convoStatus.stripCollapsed";
const MAX_CHIP_BARS = 3;

interface CharacterStatusStripProps {
  chatId: string;
  characterMap: CharacterMap;
}

function readCollapsed() {
  try {
    return localStorage.getItem(STRIP_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function CharacterStatusStrip({ chatId, characterMap }: CharacterStatusStripProps) {
  const { t: localizeUi } = useUiTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [editorOpen, setEditorOpen] = useState(false);
  const { currentGameState } = useTrackerGameState(chatId);
  const presentCharacters: PresentCharacter[] = useMemo(
    () => (Array.isArray(currentGameState?.presentCharacters) ? currentGameState.presentCharacters : []),
    [currentGameState?.presentCharacters],
  );

  const chips = useMemo(
    () =>
      presentCharacters.map((character, index) => {
        const card = characterMap.get(character.characterId);
        const stats = Array.isArray(character.stats) ? character.stats.slice(0, MAX_CHIP_BARS) : [];
        return {
          key: `${character.characterId || character.name}-${index}`,
          name: character.name || card?.name || "?",
          avatarUrl: card?.avatarUrl ?? character.avatarPath ?? null,
          mood: character.mood?.trim() || null,
          emotionCause: character.emotionCause?.trim() || null,
          temperature: character.temperature?.trim() || null,
          stats: stats.map((stat) => ({
            name: stat.name,
            value: stat.value,
            max: stat.max > 0 ? stat.max : 100,
            color: stat.color,
          })),
        };
      }),
    [characterMap, presentCharacters],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STRIP_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  if (!chips.length) return null;

  const editor = editorOpen ? <ConversationTrackerModal chatId={chatId} onClose={() => setEditorOpen(false)} /> : null;

  if (collapsed) {
    return (
      <div className="flex justify-end px-3 pb-0.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-2 py-0.5 text-[0.6rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          title={localizeUi("ui.chat.characterstatusstrip.show")}
        >
          <Activity size="0.65rem" />
          {localizeUi("ui.trackerPanel.personainventorypanel.status")}
          <ChevronUp size="0.6rem" />
        </button>
        {editor}
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border)]/60 bg-[var(--card)]/60 px-2 py-1">
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:thin]">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setEditorOpen(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)]/70 bg-[var(--secondary)]/60 py-0.5 pl-1 pr-2.5 text-left transition-colors hover:border-[var(--primary)]/60 hover:bg-[var(--accent)]/40"
              title={[
                chip.name,
                chip.mood ? (chip.emotionCause ? `${chip.mood} (${chip.emotionCause})` : chip.mood) : null,
                chip.temperature,
                localizeUi("ui.chat.characterstatusstrip.clickToEdit"),
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              {chip.avatarUrl ? (
                <img src={chip.avatarUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)]/20 text-[0.5rem] font-semibold text-[var(--primary)]">
                  {chip.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="max-w-[6rem] truncate text-[0.65rem] font-medium">{chip.name}</span>
              {chip.mood ? (
                <span className="max-w-[7rem] truncate text-[0.6rem] italic text-[var(--muted-foreground)]">
                  {chip.mood}
                </span>
              ) : (
                <span className="text-[0.6rem] text-[var(--muted-foreground)]/70">
                  {localizeUi("ui.chat.characterstatusstrip.noMood")}
                </span>
              )}
              {chip.stats.length ? (
                <span className="flex items-center gap-1">
                  {chip.stats.map((stat) => (
                    <span
                      key={stat.name}
                      className="h-1 w-6 overflow-hidden rounded-full bg-[var(--border)]/80"
                      title={localizeUi("ui.chat.characterstatusstrip.value1Value2Value3", {
                        value1: stat.name,
                        value2: stat.value,
                        value3: stat.max,
                      })}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(4, Math.min(100, (stat.value / stat.max) * 100))}%`,
                          backgroundColor: stat.color || "var(--primary)",
                        }}
                      />
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          title={localizeUi("ui.chat.characterstatusstrip.hide")}
          aria-label={localizeUi("ui.chat.characterstatusstrip.hide")}
        >
          <ChevronDown size="0.75rem" />
        </button>
      </div>
      {editor}
    </div>
  );
}
