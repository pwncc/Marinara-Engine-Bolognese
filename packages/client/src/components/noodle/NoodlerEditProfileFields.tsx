import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type {
  NoodleAccount,
  NoodleFanActivityIntensity,
  NoodlePostingMode,
  NoodlePrivateIdentityDisclosure,
} from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import {
  FieldLabel,
  fieldClass,
  parseRecord,
  readAutoPostEnabled,
  readAutoPostIntensity,
  readFanActivityAutoSchedule,
  readFanActivityEnabled,
  readFanActivityIntensity,
  readPrivateIdentityDisclosure,
  readPrivatePostingMode,
  readPrivateStageSetting,
  textareaClass,
} from "./noodle-shared";

export interface NoodlerEditProfileDraft {
  identityDisclosure: NoodlePrivateIdentityDisclosure;
  privatePersona: string;
  dynamic: string;
  appearanceOverride: string;
  postingMode: NoodlePostingMode;
  subscriptionIncludesPpv: boolean;
  subscriptionPrice: string;
  knownAccountIds: string[];
  hiddenAccountIds: string[];
  fanActivityEnabled: boolean;
  fanActivityIntensity: NoodleFanActivityIntensity;
  fanActivityAutoSchedule: boolean;
  autoPostEnabled: boolean;
  autoPostIntensity: NoodleFanActivityIntensity;
}

export type NoodlerEditProfileDraftPatch = Partial<NoodlerEditProfileDraft>;

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string")));
}

/** Builds a fresh edit draft without including the profile's common display-name or bio fields. */
export function noodlerEditProfileDraftFromAccounts(
  account: NoodleAccount,
  accounts: readonly NoodleAccount[],
): NoodlerEditProfileDraft {
  const linkedPublicAccount = accounts.find((candidate) => candidate.linkedAccountId === account.id);
  const socialSettings = parseRecord(linkedPublicAccount?.settings?.social);
  const hiddenFromSettings = parseRecord(account.settings?.hiddenFrom);
  const subscriptionPrice = account.settings?.subscriptionPrice;

  return {
    identityDisclosure: readPrivateIdentityDisclosure(account),
    privatePersona: readPrivateStageSetting(account, "stagePersonality"),
    dynamic: readPrivateStageSetting(account, "stageDynamic"),
    appearanceOverride: readPrivateStageSetting(account, "stageAppearanceOverride"),
    postingMode: readPrivatePostingMode(account),
    subscriptionIncludesPpv: account.settings?.subscriptionIncludesPpv === true,
    subscriptionPrice:
      typeof subscriptionPrice === "number" && Number.isFinite(subscriptionPrice) ? String(subscriptionPrice) : "",
    knownAccountIds: readStringArray(socialSettings.knownAccountIds),
    hiddenAccountIds: readStringArray(hiddenFromSettings.hiddenFromAccountIds),
    fanActivityEnabled: readFanActivityEnabled(account),
    fanActivityIntensity: readFanActivityIntensity(account),
    fanActivityAutoSchedule: readFanActivityAutoSchedule(account),
    autoPostEnabled: readAutoPostEnabled(account),
    autoPostIntensity: readAutoPostIntensity(account),
  };
}

export interface NoodlerEditProfileFieldsProps {
  account: NoodleAccount;
  accounts: readonly NoodleAccount[];
  draft: NoodlerEditProfileDraft;
  onChange: (patch: NoodlerEditProfileDraftPatch) => void;
  savePending?: boolean;
  onSimulateFanActivity?: (accountId: string) => void;
  simulateFanActivityPending?: boolean;
  onRetryIdentity?: (accountId: string) => void;
  retryIdentityPending?: boolean;
}

function SubSection({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--noodle-divider)] pt-4 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-bold text-[var(--foreground)]">{title}</h4>
      {help && <p className="mt-1 text-[0.68rem] leading-4 text-[var(--muted-foreground)]">{help}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

const intensityOptions: ReadonlyArray<{ value: NoodleFanActivityIntensity; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function NoodlerEditProfileFields({
  account,
  accounts,
  draft,
  onChange,
  savePending = false,
  onSimulateFanActivity,
  simulateFanActivityPending = false,
  onRetryIdentity,
  retryIdentityPending = false,
}: NoodlerEditProfileFieldsProps) {
  const linkedPublicAccount = accounts.find((candidate) => candidate.linkedAccountId === account.id);
  const selectablePublicAccounts = accounts.filter(
    (candidate) => candidate.visibility === "public" && candidate.id !== linkedPublicAccount?.id,
  );
  const identityGenerationFailed =
    account.settings?.stageIdentityGenerationFailed === true || account.settings?.avatarGenerationFailed === true;
  const identityError =
    account.settings?.stageIdentityGenerationFailed === true
      ? (account.settings.stageIdentityGenerationError as string | undefined) ||
        "Stage identity generation failed. This profile is using placeholder defaults."
      : (account.settings?.avatarGenerationError as string | undefined) || "Avatar generation failed for this profile.";

  return (
    <div className="space-y-4">
      <SubSection title="Stage identity" help="Page-specific creator settings for this NoodleR profile.">
        <div className="space-y-3">
          {identityGenerationFailed && (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)] sm:flex-row sm:items-center sm:justify-between">
              <span className="flex min-w-0 items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{identityError}</span>
              </span>
              {onRetryIdentity && (
                <button
                  type="button"
                  onClick={() => onRetryIdentity(account.id)}
                  disabled={retryIdentityPending}
                  className="h-8 shrink-0 rounded-full border border-[var(--destructive)]/50 px-3 font-bold transition-colors hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {retryIdentityPending ? "Retrying..." : "Retry"}
                </button>
              )}
            </div>
          )}

          <label className="block space-y-1.5">
            <FieldLabel help="Secret filters the linked name out of generated posts/images. This is AI-generated content moderation, not a hard guarantee.">
              Identity disclosure
            </FieldLabel>
            <select
              value={draft.identityDisclosure}
              onChange={(event) =>
                onChange({ identityDisclosure: event.target.value as NoodlePrivateIdentityDisclosure })
              }
              disabled={savePending}
              className={fieldClass}
            >
              <option value="open">Open</option>
              <option value="hinted">Hinted</option>
              <option value="secret">Secret</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <FieldLabel>Private persona</FieldLabel>
            <textarea
              value={draft.privatePersona}
              onChange={(event) => onChange({ privatePersona: event.target.value })}
              disabled={savePending}
              className={cn(textareaClass, "min-h-20 resize-none")}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <FieldLabel>Dynamic</FieldLabel>
              <input
                value={draft.dynamic}
                onChange={(event) => onChange({ dynamic: event.target.value })}
                disabled={savePending}
                className={fieldClass}
              />
            </label>
            <label className="block space-y-1.5">
              <FieldLabel>Posting mode</FieldLabel>
              <select
                value={draft.postingMode}
                onChange={(event) => onChange({ postingMode: event.target.value as NoodlePostingMode })}
                disabled={savePending}
                className={fieldClass}
              >
                <option value="active">Active - this account posts too</option>
                <option value="passive">Passive - lurk only</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1.5">
            <FieldLabel>Appearance/style override</FieldLabel>
            <textarea
              value={draft.appearanceOverride}
              onChange={(event) => onChange({ appearanceOverride: event.target.value })}
              disabled={savePending}
              placeholder="Optional styling, outfit, or presentation notes. The linked account's body and face are still preserved."
              className={cn(textareaClass, "min-h-20 resize-none")}
            />
          </label>
        </div>
      </SubSection>

      <SubSection title="Monetization" help="Subscription pricing and pay-per-view bundling for this page.">
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-xs leading-5 text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={draft.subscriptionIncludesPpv}
              onChange={(event) => onChange({ subscriptionIncludesPpv: event.target.checked })}
              disabled={savePending}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--noodle-blue)]"
            />
            <span>
              Subscribers automatically unlock pay-per-post content too. Off means each post is unlocked separately.
            </span>
          </label>
          <label className="block space-y-1.5 sm:max-w-xs">
            <FieldLabel>Subscription price per month</FieldLabel>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted-foreground)]">$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={draft.subscriptionPrice}
                onChange={(event) => onChange({ subscriptionPrice: event.target.value })}
                disabled={savePending}
                placeholder="9.99"
                className={fieldClass}
              />
              <span className="shrink-0 text-xs text-[var(--muted-foreground)]">/mo</span>
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)]">Shown to fans; no real payment is processed.</p>
          </label>
        </div>
      </SubSection>

      <SubSection
        title="Page privacy"
        help="Manage who this character knows and who this private page should remain invisible to."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--foreground)]">People this character knows</p>
            <p className="mt-0.5 text-xs leading-4 text-[var(--muted-foreground)]">
              Biases interactions; it is not an access restriction.
            </p>
            {!linkedPublicAccount ? (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">No linked public account found.</p>
            ) : (
              <AccountChecklist
                accounts={selectablePublicAccounts}
                selectedIds={draft.knownAccountIds}
                onToggle={(id) => onChange({ knownAccountIds: toggleId(draft.knownAccountIds, id) })}
                disabled={savePending}
                emptyLabel="No other public accounts."
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--foreground)]">Hide this page from</p>
            <p className="mt-0.5 text-xs leading-4 text-[var(--muted-foreground)]">
              Selected accounts never see this page, including in Discover.
            </p>
            <AccountChecklist
              accounts={selectablePublicAccounts}
              selectedIds={draft.hiddenAccountIds}
              onToggle={(id) => onChange({ hiddenAccountIds: toggleId(draft.hiddenAccountIds, id) })}
              disabled={savePending}
              emptyLabel="No other public accounts."
            />
          </div>
        </div>
      </SubSection>

      <SubSection
        title="Fan activity"
        help="Lets filler accounts like, comment, subscribe, and unlock posts. The global NoodleR fan activity setting must also be enabled."
      >
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={draft.fanActivityEnabled}
              onChange={(event) => onChange({ fanActivityEnabled: event.target.checked })}
              disabled={savePending}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--noodle-blue)]"
            />
            <span>Turn on fan activity for this page. Off by default.</span>
          </label>
          {draft.fanActivityEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <FieldLabel>Fan activity intensity</FieldLabel>
                <select
                  value={draft.fanActivityIntensity}
                  onChange={(event) =>
                    onChange({ fanActivityIntensity: event.target.value as NoodleFanActivityIntensity })
                  }
                  disabled={savePending}
                  className={fieldClass}
                >
                  {intensityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} (
                      {option.value === "low" ? "up to 3" : option.value === "medium" ? "up to 6" : "up to 10"}{" "}
                      actions/run)
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-2 self-end rounded-md border border-[var(--noodle-divider)] p-2.5 text-xs text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={draft.fanActivityAutoSchedule}
                  onChange={(event) => onChange({ fanActivityAutoSchedule: event.target.checked })}
                  disabled={savePending}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--noodle-blue)]"
                />
                <span>Run fan activity unattended on a schedule.</span>
              </label>
            </div>
          )}
          {draft.fanActivityEnabled && onSimulateFanActivity && (
            <div className="flex justify-start sm:justify-end">
              <button
                type="button"
                onClick={() => onSimulateFanActivity(account.id)}
                disabled={simulateFanActivityPending}
                className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-full border border-[var(--noodle-blue)]/50 px-4 text-xs font-bold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {simulateFanActivityPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {simulateFanActivityPending ? "Simulating..." : "Simulate fan activity now"}
              </button>
            </div>
          )}
        </div>
      </SubSection>

      <SubSection
        title="Automatic posting"
        help="Lets refreshes and the unattended scheduler generate posts for this page. Passive pages still never post."
      >
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={draft.autoPostEnabled}
              onChange={(event) => onChange({ autoPostEnabled: event.target.checked })}
              disabled={savePending}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--noodle-blue)]"
            />
            <span>Include this page when refreshing NoodleR automatically.</span>
          </label>
          {draft.autoPostEnabled && (
            <label className="block space-y-1.5 sm:max-w-xs">
              <FieldLabel>Posting frequency</FieldLabel>
              <select
                value={draft.autoPostIntensity}
                onChange={(event) => onChange({ autoPostIntensity: event.target.value as NoodleFanActivityIntensity })}
                disabled={savePending}
                className={fieldClass}
              >
                {intensityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} (
                    {option.value === "low" ? "up to 1" : option.value === "medium" ? "up to 3" : "up to 6"} posts/day)
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </SubSection>
    </div>
  );
}

function AccountChecklist({
  accounts,
  selectedIds,
  onToggle,
  disabled,
  emptyLabel,
}: {
  accounts: readonly NoodleAccount[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
  disabled: boolean;
  emptyLabel: string;
}) {
  return (
    <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-md border border-[var(--noodle-divider)] p-2">
      {accounts.length === 0 ? (
        <p className="px-1 py-1 text-xs text-[var(--muted-foreground)]">{emptyLabel}</p>
      ) : (
        accounts.map((account) => (
          <label
            key={account.id}
            className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[var(--accent)]"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(account.id)}
              onChange={() => onToggle(account.id)}
              disabled={disabled}
              className="h-4 w-4 shrink-0 accent-[var(--noodle-blue)]"
            />
            <span className="min-w-0 truncate">
              {account.displayName} <span className="text-[var(--muted-foreground)]">@{account.handle}</span>
            </span>
          </label>
        ))
      )}
    </div>
  );
}
