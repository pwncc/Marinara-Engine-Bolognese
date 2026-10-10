// ──────────────────────────────────────────────
// Conversation mode: the tracker's character cards in a window.
//
// Roleplay has the tracker window; Conversation gets the same cards here so
// the one status ledger (present characters) is editable everywhere.
// ──────────────────────────────────────────────
import { useMemo } from "react";
import { useTranslation as useUiTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { TrackerLockProvider } from "../../features/tracker-panel/components/TrackerLockContext";
import { TrackerWindowCharacters } from "../../features/tracker-panel/components/TrackerWindowCharacters";
import { useTrackerRerun } from "../../features/tracker-panel/hooks/use-tracker-rerun";
import { useGameStateStore } from "../../stores/game-state.store";
import { useRoleplayTrackerState } from "./RoleplayHUD";

const CHARACTER_TRACKER_ONLY = new Set(["character-tracker"]);

export function ConversationTrackerModal({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const { t: localizeUi } = useUiTranslation();
  const tracker = useRoleplayTrackerState(chatId, CHARACTER_TRACKER_ONLY, "conversation-status");
  const flushPatch = useGameStateStore((state) => state.flushPatch);
  const gameStateRefreshing = useGameStateStore((state) => state.isRefreshing);
  const { rerunTracker, trackerRetryBusy } = useTrackerRerun({
    activeChatId: chatId,
    enabledAgentTypes: CHARACTER_TRACKER_ONLY,
    flushPatch: useMemo(() => flushPatch ?? (async () => {}), [flushPatch]),
    gameStateRefreshing,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={localizeUi("ui.chat.characterswidget.presentCharacters")}
      width="max-w-3xl"
      chatFloatingPanel
      panelClassName="max-h-[85vh]"
    >
      <TrackerLockProvider {...tracker.lockProviderProps}>
        <TrackerWindowCharacters
          chatId={chatId}
          characters={tracker.presentCharacters}
          patchField={tracker.patchField}
          patchPlayerStats={tracker.patchPlayerStats}
          onRerunSingleTracker={(agentType) => void rerunTracker(agentType)}
          isTrackerRetryBusy={trackerRetryBusy}
        />
      </TrackerLockProvider>
    </Modal>
  );
}
