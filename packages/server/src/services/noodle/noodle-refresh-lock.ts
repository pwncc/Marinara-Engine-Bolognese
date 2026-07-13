// ──────────────────────────────────────────────
// Per-scope lock for Noodle/NoodleR refresh generation.
//
// Replaces a single global in-flight flag: the public timeline refresh and
// each private NoodleR account's guided generation get independent scope
// keys, so refreshing one doesn't block the others. Scope key is "public"
// for the main timeline, or the private account's id for a guided
// single-account generation.
// ──────────────────────────────────────────────

const activeRefreshScopes = new Set<string>();

export const NOODLE_PUBLIC_REFRESH_SCOPE = "public";

export function isNoodleRefreshLocked(scopeKey: string): boolean {
  return activeRefreshScopes.has(scopeKey);
}

export function acquireNoodleRefreshLock(scopeKey: string): void {
  activeRefreshScopes.add(scopeKey);
}

export function releaseNoodleRefreshLock(scopeKey: string): void {
  activeRefreshScopes.delete(scopeKey);
}

export async function withNoodleRefreshLock<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
  acquireNoodleRefreshLock(scopeKey);
  try {
    return await fn();
  } finally {
    releaseNoodleRefreshLock(scopeKey);
  }
}
