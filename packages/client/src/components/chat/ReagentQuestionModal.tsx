import { useCallback, useEffect, useState } from "react";
import { useTranslation as useUiTranslation } from "react-i18next";
import { MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";
import type { ReagentQuestionRequest } from "@marinara-engine/shared";
import { Modal } from "../ui/Modal";
import { respondToReagentQuestion } from "../../hooks/use-reagent";

export const REAGENT_QUESTION_EVENT = "marinara:reagent-question";

const BUTTON_CLASS =
  "mari-chrome-control mari-chrome-control--small inline-flex items-center gap-1.5 px-3 text-[0.6875rem]";
const OPTION_CLASS =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-left text-[0.75rem] text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/50 disabled:opacity-50";
const TEXTAREA_CLASS =
  "min-h-[4rem] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2.5 text-[0.75rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 placeholder:text-[var(--muted-foreground)]/40";

/** The character's questions to the user, asked while it reasons; generation waits for each answer. */
export function ReagentQuestionModal() {
  const { t: localizeUi } = useUiTranslation();
  const [queue, setQueue] = useState<ReagentQuestionRequest[]>([]);
  const [other, setOther] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<ReagentQuestionRequest>).detail;
      if (!detail?.id || typeof detail.question !== "string") return;
      setQueue((current) => (current.some((entry) => entry.id === detail.id) ? current : [...current, detail]));
    };
    window.addEventListener(REAGENT_QUESTION_EVENT, handle);
    return () => window.removeEventListener(REAGENT_QUESTION_EVENT, handle);
  }, []);

  const current = queue[0] ?? null;
  const answer = useCallback(
    async (value: string | null) => {
      if (!current) return;
      setBusy(true);
      try {
        await respondToReagentQuestion(current.id, value);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : localizeUi("ui.chat.reagent.question.failed"));
      } finally {
        setBusy(false);
        setOther("");
        setWriting(false);
        setQueue((entries) => entries.filter((entry) => entry.id !== current.id));
      }
    },
    [current, localizeUi],
  );

  if (!current) return null;
  const options = Array.isArray(current.options) ? current.options : [];
  return (
    <Modal open onClose={() => void answer(null)} title={localizeUi("ui.chat.reagent.question.title")} width="max-w-lg">
      <div className="space-y-3">
        <div className="flex items-start gap-2.5">
          <MessageCircleQuestion size="0.875rem" className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.reagent.question.prompt")}
            </p>
            {current.context && (
              <p className="whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2.5 text-[0.6875rem] text-[var(--muted-foreground)]">
                {current.context}
              </p>
            )}
            <p className="whitespace-pre-wrap text-[0.8125rem] text-[var(--foreground)]">{current.question}</p>
            {options.length > 0 && (
              <div className="space-y-1.5">
                {options.map((option, index) => (
                  <button
                    key={`${index}-${option}`}
                    type="button"
                    className={OPTION_CLASS}
                    disabled={busy}
                    onClick={() => void answer(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            {writing || options.length === 0 ? (
              <textarea
                autoFocus
                value={other}
                onChange={(event) => setOther(event.target.value)}
                placeholder={localizeUi("ui.chat.reagent.question.otherPlaceholder")}
                className={TEXTAREA_CLASS}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && other.trim())
                    void answer(other.trim());
                }}
              />
            ) : (
              <button type="button" className={OPTION_CLASS} disabled={busy} onClick={() => setWriting(true)}>
                {localizeUi("ui.chat.reagent.question.other")}
              </button>
            )}
            {queue.length > 1 && (
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                {localizeUi("ui.chat.reagent.question.more", { count: queue.length - 1 })}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={() => void answer(null)}>
            {localizeUi("ui.chat.reagent.question.skip")}
          </button>
          {(writing || options.length === 0) && (
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={busy || !other.trim()}
              onClick={() => void answer(other.trim())}
            >
              {localizeUi("ui.chat.reagent.question.send")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
