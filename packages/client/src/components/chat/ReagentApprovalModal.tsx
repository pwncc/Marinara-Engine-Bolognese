import { useCallback, useEffect, useState } from "react";
import { useTranslation as useUiTranslation } from "react-i18next";
import { TerminalSquare } from "lucide-react";
import { toast } from "sonner";
import type { ReagentApprovalRequest } from "@marinara-engine/shared";
import { Modal } from "../ui/Modal";
import { respondToReagentApproval } from "../../hooks/use-reagent";

export const REAGENT_APPROVAL_EVENT = "marinara:reagent-approval";

const BUTTON_CLASS =
  "mari-chrome-control mari-chrome-control--small inline-flex items-center gap-1.5 px-3 text-[0.6875rem]";

/** Listens for shell commands that need the user's answer and shows them one at a time. */
export function ReagentApprovalModal() {
  const { t: localizeUi } = useUiTranslation();
  const [queue, setQueue] = useState<ReagentApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<ReagentApprovalRequest>).detail;
      if (!detail?.id || typeof detail.command !== "string") return;
      setQueue((current) => (current.some((entry) => entry.id === detail.id) ? current : [...current, detail]));
    };
    window.addEventListener(REAGENT_APPROVAL_EVENT, handle);
    return () => window.removeEventListener(REAGENT_APPROVAL_EVENT, handle);
  }, []);

  const current = queue[0] ?? null;
  const answer = useCallback(
    async (decision: "approved" | "denied") => {
      if (!current) return;
      setBusy(true);
      try {
        await respondToReagentApproval(current.id, decision);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : localizeUi("ui.chat.reagent.approval.failed"));
      } finally {
        setBusy(false);
        setQueue((entries) => entries.filter((entry) => entry.id !== current.id));
      }
    },
    [current, localizeUi],
  );

  if (!current) return null;
  return (
    <Modal
      open
      onClose={() => void answer("denied")}
      title={localizeUi("ui.chat.reagent.approval.title")}
      width="max-w-lg"
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2.5">
          <TerminalSquare size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[0.75rem] text-[var(--foreground)]">{localizeUi("ui.chat.reagent.approval.prompt")}</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2.5 font-mono text-[0.75rem]">
              {current.command}
            </pre>
            <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.reagent.approval.cwd", { cwd: current.cwd })}
            </p>
            {current.reason && (
              <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
                {localizeUi("ui.chat.reagent.approval.reason", { reason: current.reason })}
              </p>
            )}
            {queue.length > 1 && (
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                {localizeUi("ui.chat.reagent.approval.more", { count: queue.length - 1 })}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={() => void answer("denied")}>
            {localizeUi("ui.chat.reagent.approval.deny")}
          </button>
          <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={() => void answer("approved")}>
            {localizeUi("ui.chat.reagent.approval.allow")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
