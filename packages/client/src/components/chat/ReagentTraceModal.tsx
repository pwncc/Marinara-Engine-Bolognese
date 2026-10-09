import { useState, type RefObject } from "react";
import { useTranslation as useUiTranslation } from "react-i18next";
import { CheckCircle2, ChevronDown, ChevronRight, Wrench, XCircle } from "lucide-react";
import type { ReagentActivityEntry } from "@marinara-engine/shared";
import { Modal } from "../ui/Modal";

export function readReagentActivity(extra: unknown): ReagentActivityEntry[] {
  if (!extra || typeof extra !== "object") return [];
  const raw = (extra as { reagentActivity?: unknown }).reagentActivity;
  return Array.isArray(raw) ? (raw as ReagentActivityEntry[]) : [];
}

function TraceEntry({ entry }: { entry: ReagentActivityEntry }) {
  const { t: localizeUi } = useUiTranslation();
  const [open, setOpen] = useState(false);
  const summary = Object.entries(entry.args)
    .map(
      ([key, value]) => `${key}=${typeof value === "string" ? value.slice(0, 60) : JSON.stringify(value).slice(0, 60)}`,
    )
    .join(", ");
  return (
    <div className="rounded-lg border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--marinara-chat-chrome-highlight-bg)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-2 p-2 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size="0.75rem" className="mt-0.5 shrink-0" />
        ) : (
          <ChevronRight size="0.75rem" className="mt-0.5 shrink-0" />
        )}
        {entry.ok ? (
          <CheckCircle2 size="0.8rem" className="mt-0.5 shrink-0 text-[var(--primary)]" />
        ) : (
          <XCircle size="0.8rem" className="mt-0.5 shrink-0 text-[var(--destructive)]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[0.75rem] font-semibold text-[var(--marinara-chat-chrome-panel-title)]">
            {entry.tool}
          </span>
          <span className="ml-2 text-[0.6875rem] text-[var(--muted-foreground)]">
            {entry.durationMs} {localizeUi("ui.connections.testresultcard.ms")}
          </span>
          {entry.approval && (
            <span className="ml-2 text-[0.6875rem] text-[var(--muted-foreground)]">
              {localizeUi(`ui.chat.reagent.approval.${entry.approval}`)}
            </span>
          )}
          {!open && summary && (
            <span className="mt-0.5 block truncate text-[0.6875rem] text-[var(--marinara-chat-chrome-panel-text)]">
              {summary}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-[var(--marinara-chat-chrome-panel-border)] p-2">
          <div>
            <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.reagent.trace.arguments")}
            </p>
            <pre className="mari-chat-style-text whitespace-pre-wrap break-words text-[0.6875rem] leading-relaxed">
              {JSON.stringify(entry.args, null, 2)}
            </pre>
          </div>
          <div>
            <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.reagent.trace.result")}
            </p>
            <pre className="mari-chat-style-text max-h-64 overflow-auto whitespace-pre-wrap break-words text-[0.6875rem] leading-relaxed">
              {entry.result}
            </pre>
          </div>
          {entry.media?.length ? (
            <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.reagent.trace.media", { names: entry.media.map((item) => item.name).join(", ") })}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function ReagentTraceModal({
  entries,
  onClose,
  restoreFocusRef,
}: {
  entries: ReagentActivityEntry[];
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t: localizeUi } = useUiTranslation();
  return (
    <Modal
      open
      onClose={onClose}
      title={localizeUi("ui.chat.reagent.trace.title", { count: entries.length })}
      width="max-w-2xl"
      panelClassName="mari-chat-style-surface mari-chat-action-panel max-h-[75vh]"
      chatFloatingPanel
      restoreFocusRef={restoreFocusRef}
    >
      <div className="flex items-start gap-2.5">
        <Wrench
          size="0.875rem"
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[var(--marinara-chat-chrome-button-text-active)]"
        />
        <div className="min-w-0 flex-1 space-y-2">
          {entries.map((entry) => (
            <TraceEntry key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
