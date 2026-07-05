// ──────────────────────────────────────────────
// DocsViewerModal: Browse the guides shipped in docs/
// ──────────────────────────────────────────────
import { useState } from "react";
import { ArrowLeft, BookOpen, FileText } from "lucide-react";
import { Modal } from "../ui/Modal";
import { cn } from "../../lib/utils";
import { renderMarkdownBlocks, applyInlineMarkdown } from "../../lib/markdown";
import { useDocContent, useDocsIndex, type DocSummary } from "../../hooks/use-docs";

const DIR_LABELS: Record<string, string> = {
  "": "Guides",
  installation: "Installation",
  integrations: "Integrations",
};

function dirLabel(dir: string) {
  return DIR_LABELS[dir] ?? dir.charAt(0).toUpperCase() + dir.slice(1);
}

export function DocsViewerModal({
  open,
  onClose,
  initialDoc = null,
}: {
  open: boolean;
  onClose: () => void;
  initialDoc?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialDoc);
  const { data: index, isLoading: indexLoading, isError: indexError } = useDocsIndex(open);
  const { data: doc, isLoading: docLoading, isError: docError } = useDocContent(selected);

  const groups: { dir: string; docs: DocSummary[] }[] = [];
  for (const entry of index?.docs ?? []) {
    const group = groups.find((g) => g.dir === entry.dir);
    if (group) group.docs.push(entry);
    else groups.push({ dir: entry.dir, docs: [entry] });
  }

  return (
    <Modal open={open} onClose={onClose} title="Documentation" width="max-w-4xl">
      <div className="flex h-[min(65dvh,42rem)] min-h-0 gap-3">
        {/* Guide list */}
        <aside
          className={cn(
            "flex w-full min-w-0 flex-col sm:w-60 sm:shrink-0",
            selected !== null && "hidden sm:flex",
          )}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {indexLoading ? (
              <p className="px-1 py-2 text-xs text-[var(--muted-foreground)]">Loading guides…</p>
            ) : indexError || !index ? (
              <p className="px-1 py-2 text-xs text-[var(--muted-foreground)]">
                Could not load the documentation list. The docs folder may be missing from this install.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.dir || "root"}>
                  <p className="px-1 pb-1 text-[0.625rem] font-medium uppercase tracking-[0.16em] text-[var(--muted-foreground)]/70">
                    {dirLabel(group.dir)}
                  </p>
                  <div className="space-y-1">
                    {group.docs.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        onClick={() => setSelected(entry.path)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                          selected === entry.path
                            ? "border-[var(--primary)]/40 bg-[var(--accent)] text-[var(--foreground)]"
                            : "border-transparent text-[var(--muted-foreground)] hover:border-[var(--border)] hover:bg-[var(--accent)]/60 hover:text-[var(--foreground)]",
                        )}
                      >
                        <FileText size="0.875rem" className="mt-0.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-xs font-medium leading-snug">{entry.title}</span>
                          <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]/70">
                            {entry.path}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          {index ? (
            <div className="mt-2 shrink-0 border-t border-[var(--border)]/60 pt-2">
              <p className="text-[0.625rem] text-[var(--muted-foreground)]/70">Also on disk at:</p>
              <code className="block break-all text-[0.625rem] text-[var(--muted-foreground)]" title={index.root}>
                {index.root}
              </code>
            </div>
          ) : null}
        </aside>

        {/* Reader */}
        <div
          className={cn(
            "min-w-0 flex-1 flex-col sm:flex sm:border-l sm:border-[var(--border)]/60 sm:pl-3",
            selected === null ? "hidden sm:flex" : "flex",
          )}
        >
          {selected === null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--muted-foreground)]">
              <BookOpen size="1.5rem" className="opacity-60" />
              <p className="text-xs">Pick a guide from the list to start reading.</p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] sm:hidden"
                  aria-label="Back to guide list"
                >
                  <ArrowLeft size="0.875rem" />
                </button>
                <p className="min-w-0 truncate text-[0.625rem] text-[var(--muted-foreground)]/70">docs/{selected}</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {docLoading ? (
                  <p className="py-2 text-xs text-[var(--muted-foreground)]">Loading…</p>
                ) : docError || !doc ? (
                  <p className="py-2 text-xs text-[var(--muted-foreground)]">Could not load this guide.</p>
                ) : (
                  <div className="prose prose-sm max-w-none text-[var(--foreground)]">
                    {renderMarkdownBlocks(doc.content, applyInlineMarkdown, "docs-viewer")}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
