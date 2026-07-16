import type { NoodleAccount, NoodleFanActivityIntensity } from "@marinara-engine/shared";
import { isNoodlePrivatePostingActive, readAutoPostEnabled } from "./noodle-manual-post.js";

const WEIGHTS: Record<NoodleFanActivityIntensity, number> = { low: 1, medium: 2, high: 4 };

function intensity(account: NoodleAccount): NoodleFanActivityIntensity {
  const value = (account.settings.autoPost as Record<string, unknown> | undefined)?.intensity;
  return value === "medium" || value === "high" ? value : "low";
}

export function eligibleNoodlerCreatorAccounts(accounts: NoodleAccount[]): NoodleAccount[] {
  return accounts.filter(
    (account) => account.visibility === "private" && isNoodlePrivatePostingActive(account) && readAutoPostEnabled(account),
  );
}

export function selectNoodlerCreator(
  accounts: NoodleAccount[],
  random: () => number = Math.random,
): NoodleAccount | null {
  const eligible = eligibleNoodlerCreatorAccounts(accounts).sort((left, right) => left.id.localeCompare(right.id));
  const now = Date.now();
  const effectiveWeight = (account: NoodleAccount) => {
    const last = (account.settings.autoPost as Record<string, unknown> | undefined)?.lastAutomaticPostAt;
    const waitedHours = typeof last === "string" ? Math.max(0, (now - Date.parse(last)) / 3_600_000) : 168;
    return WEIGHTS[intensity(account)] * (1 + Math.min(3, waitedHours / 24));
  };
  const total = eligible.reduce((sum, account) => sum + effectiveWeight(account), 0);
  if (total === 0) return null;
  let cursor = Math.min(0.999_999, Math.max(0, random())) * total;
  for (const account of eligible) {
    cursor -= effectiveWeight(account);
    if (cursor < 0) return account;
  }
  return eligible[eligible.length - 1] ?? null;
}
