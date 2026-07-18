import { Brain, X } from "lucide-react";
import { createPortal } from "react-dom";

export function readAssistantPrefillFromExtra(extra: Record<string, unknown>): string | null {
  const gen = extra.generationInfo;
  if (!gen || typeof gen !== "object") return null;
  const record = gen as Record<string, unknown>;
  return typeof record.assistantPrefill === "string" && record.assistantPrefill.trim()
    ? record.assistantPrefill
    : null;
}

export function ModelThoughtsModal({
  thinking,
  assistantPrefill,
  onClose,
}: {
  thinking?: string | null;
  assistantPrefill?: string | null;
  onClose: () => void;
}) {
  const hasThinking = !!thinking?.trim();
  const hasPrefill = !!assistantPrefill?.trim();

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
      onClick={onClose}
    >
      <div
        className="relative mx-4 flex max-h-[70vh] w-full max-w-xl flex-col rounded-xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <Brain size="0.875rem" className="text-[var(--muted-foreground)]" />
            Thoughts &amp; steering
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X size="0.875rem" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-4 py-3">
          {hasPrefill && (
            <section className="space-y-1.5">
              <h3 className="text-[0.75rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
                Assistant prefill (last API message)
              </h3>
              <p className="text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
                Partial assistant turn sent so the model continues from this text (like Continue). Not model
                reasoning output.
              </p>
              <pre className="whitespace-pre-wrap break-words rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/40 px-3 py-2 text-[0.8125rem] leading-relaxed text-[var(--foreground)]/90">
                {assistantPrefill}
              </pre>
            </section>
          )}
          {hasThinking ? (
            <section className="space-y-1.5">
              <h3 className="text-[0.75rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
                Model reasoning (output)
              </h3>
              <pre className="whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
                {thinking}
              </pre>
            </section>
          ) : (
            !hasPrefill && (
              <p className="text-[0.8125rem] text-[var(--muted-foreground)]">No reasoning content was returned.</p>
            )
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
