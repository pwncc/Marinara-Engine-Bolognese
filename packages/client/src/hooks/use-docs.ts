// ──────────────────────────────────────────────
// React Query: In-app documentation (docs/*.md)
// ──────────────────────────────────────────────
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export interface DocSummary {
  /** Path relative to the docs folder, forward slashes (e.g. "installation/windows.md") */
  path: string;
  title: string;
  /** Subfolder relative to docs ("" for root-level guides) */
  dir: string;
}

export interface DocsIndex {
  /** Absolute on-disk path of the docs folder */
  root: string;
  docs: DocSummary[];
}

export interface DocContent {
  path: string;
  title: string;
  content: string;
}

export const docsKeys = {
  all: ["docs"] as const,
  index: () => [...docsKeys.all, "index"] as const,
  content: (path: string) => [...docsKeys.all, "content", path] as const,
};

/** The docs shipped with the app only change on update, so cache for the session. */
export function useDocsIndex(enabled = true) {
  return useQuery({
    queryKey: docsKeys.index(),
    queryFn: () => api.get<DocsIndex>("/docs"),
    enabled,
    staleTime: Infinity,
  });
}

export function useDocContent(path: string | null) {
  return useQuery({
    queryKey: docsKeys.content(path ?? ""),
    queryFn: () => api.get<DocContent>(`/docs/content?path=${encodeURIComponent(path ?? "")}`),
    enabled: !!path,
    staleTime: Infinity,
  });
}
