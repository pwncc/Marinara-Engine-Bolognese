// ──────────────────────────────────────────────
// Noodle: NoodleR page settings — stage identity, monetization, privacy,
// fan activity, and automatic posting for a single NoodleR page. Lives on
// the page itself (rendered from NoodlerHome's PrivateProfileView), not in
// the global Noodle/NoodleR settings panel, since these are per-page and
// not global.
// ──────────────────────────────────────────────
import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type {
  NoodleAccount,
  NoodlePostingMode,
  NoodlePrivateIdentityDisclosure,
  NoodlePrivateStageProfileInput,
} from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { useUpdateNoodleAccount } from "../../hooks/use-noodle";
import { useSimulateNoodlerFanActivity } from "../../hooks/use-noodler";
import {
  FieldLabel,
  autoPostSettingsFromAccount,
  fanActivitySettingsFromAccount,
  fieldClass,
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

function SubSection({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--noodle-divider)] pt-3 first:border-t-0 first:pt-0">
      <h5 className="mb-2 text-xs font-bold text-[var(--foreground)]">{title}</h5>
      {help && <p className="mb-2 text-[0.68rem] leading-4 text-[var(--muted-foreground)]">{help}</p>}
      {children}
    </div>
  );
}

export interface NoodlerPageSettingsPanelProps {
  account: NoodleAccount;
  accounts: NoodleAccount[];
}

export function NoodlerPageSettingsPanel({ account, accounts }: NoodlerPageSettingsPanelProps) {
  const updateAccount = useUpdateNoodleAccount();
  const simulateFanActivity = useSimulateNoodlerFanActivity();

  const [stageProfileDisclosure, setStageProfileDisclosure] = useState<NoodlePrivateIdentityDisclosure>("hinted");
  const [stageProfileName, setStageProfileName] = useState("");
  const [stageProfileBio, setStageProfileBio] = useState("");
  const [stageProfilePersonality, setStageProfilePersonality] = useState("");
  const [stageProfileDynamic, setStageProfileDynamic] = useState("");
  const [stageProfileAppearanceOverride, setStageProfileAppearanceOverride] = useState("");
  const [stageProfilePostingMode, setStageProfilePostingMode] = useState<NoodlePostingMode>("active");

  useEffect(() => {
    setStageProfileDisclosure(readPrivateIdentityDisclosure(account));
    setStageProfileName(readPrivateStageSetting(account, "stageName") || account.displayName);
    setStageProfileBio(readPrivateStageSetting(account, "stageBio") || account.bio);
    setStageProfilePersonality(readPrivateStageSetting(account, "stagePersonality"));
    setStageProfileDynamic(readPrivateStageSetting(account, "stageDynamic"));
    setStageProfileAppearanceOverride(readPrivateStageSetting(account, "stageAppearanceOverride"));
    setStageProfilePostingMode(readPrivatePostingMode(account));
  }, [account]);

  const saveStageProfile = () => {
    if (account.visibility !== "private") return;
    const stageProfile: NoodlePrivateStageProfileInput = {
      identityDisclosure: stageProfileDisclosure,
      stageName: stageProfileName.trim() || account.displayName,
      stageBio: stageProfileBio.trim(),
      stagePersonality: stageProfilePersonality.trim(),
      stageDynamic: stageProfileDynamic.trim(),
      stageAppearanceOverride: stageProfileAppearanceOverride.trim(),
      preserveLinkedAppearance: true,
      postingMode: stageProfilePostingMode,
    };
    updateAccount.mutate(
      {
        id: account.id,
        displayName: stageProfile.stageName,
        bio: stageProfile.stageBio ?? "",
        settings: {
          ...account.settings,
          stageProfile,
          privateStageProfileVersion: 1,
        },
      },
      {
        onSuccess: () => {
          toast.success("NoodleR stage profile updated.");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update stage profile."),
      },
    );
  };

  const linkedPublicAccount = accounts.find((candidate) => candidate.linkedAccountId === account.id);
  const linkedKnownAccountIds = linkedPublicAccount?.settings?.social as { knownAccountIds?: unknown } | undefined;
  const knownAccountIds = new Set(
    Array.isArray(linkedKnownAccountIds?.knownAccountIds) ? (linkedKnownAccountIds!.knownAccountIds as string[]) : [],
  );
  const hiddenFromSetting = account.settings?.hiddenFrom as { hiddenFromAccountIds?: unknown } | undefined;
  const hiddenFromIds = new Set(
    Array.isArray(hiddenFromSetting?.hiddenFromAccountIds) ? (hiddenFromSetting!.hiddenFromAccountIds as string[]) : [],
  );
  const otherPublicAccounts = accounts.filter(
    (candidate) => candidate.visibility === "public" && candidate.id !== linkedPublicAccount?.id,
  );
  const toggleKnown = (accountId: string) => {
    if (!linkedPublicAccount) return;
    const next = new Set(knownAccountIds);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    updateAccount.mutate({
      id: linkedPublicAccount.id,
      settings: { social: { knownAccountIds: Array.from(next) } },
    });
  };
  const toggleHidden = (accountId: string) => {
    const next = new Set(hiddenFromIds);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    updateAccount.mutate({
      id: account.id,
      settings: { hiddenFrom: { hiddenFromAccountIds: Array.from(next) } },
    });
  };

  return (
    <details className="group rounded-lg border border-[var(--noodle-divider)] bg-[var(--card)]/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-bold text-[var(--foreground)] marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <Settings2 size={14} className="text-[var(--noodle-blue)]" />
          NoodleR page settings
        </span>
        <ChevronDown size={15} className="shrink-0 text-[var(--muted-foreground)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-[var(--noodle-divider)] p-3 pt-3">
        <SubSection title="Stage identity" help="Page-specific creator settings for this NoodleR profile.">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <FieldLabel help="Secret filters the linked name out of generated posts/images. This is AI-generated content moderation, not a hard guarantee.">
                  Identity
                </FieldLabel>
                <select
                  value={stageProfileDisclosure}
                  onChange={(event) => setStageProfileDisclosure(event.target.value as NoodlePrivateIdentityDisclosure)}
                  className={fieldClass}
                >
                  <option value="open">Open</option>
                  <option value="hinted">Hinted</option>
                  <option value="secret">Secret</option>
                </select>
              </label>
              <label className="block space-y-1.5">
                <FieldLabel>Stage name</FieldLabel>
                <input
                  value={stageProfileName}
                  onChange={(event) => setStageProfileName(event.target.value)}
                  className={fieldClass}
                />
              </label>
            </div>
            <label className="block space-y-1.5">
              <FieldLabel>Private persona</FieldLabel>
              <textarea
                value={stageProfilePersonality}
                onChange={(event) => setStageProfilePersonality(event.target.value)}
                className={cn(textareaClass, "min-h-20 resize-none")}
              />
            </label>
            <label className="block space-y-1.5">
              <FieldLabel>Dynamic</FieldLabel>
              <input
                value={stageProfileDynamic}
                onChange={(event) => setStageProfileDynamic(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block space-y-1.5">
              <FieldLabel>Appearance/style override</FieldLabel>
              <textarea
                value={stageProfileAppearanceOverride}
                onChange={(event) => setStageProfileAppearanceOverride(event.target.value)}
                placeholder="Optional styling, outfit, or presentation notes. Your linked account's body/face is still preserved."
                className={cn(textareaClass, "min-h-20 resize-none")}
              />
            </label>
            <label className="block space-y-1.5">
              <FieldLabel>Bio</FieldLabel>
              <textarea
                value={stageProfileBio}
                onChange={(event) => setStageProfileBio(event.target.value)}
                className={cn(textareaClass, "min-h-20 resize-none")}
              />
            </label>
            <div className="space-y-1.5">
              <FieldLabel help="Active accounts also post themselves. Passive accounts are lurk-only and never post — this is unrelated to AI auto-posting, which stays off regardless.">
                Posting mode
              </FieldLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { value: "active" as const, title: "Active", detail: "This account posts too." },
                    { value: "passive" as const, title: "Passive", detail: "Lurk only — never posts." },
                  ]
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStageProfilePostingMode(option.value)}
                    className={cn(
                      "rounded-md border p-2.5 text-left transition-colors",
                      stageProfilePostingMode === option.value
                        ? "border-[var(--noodle-blue)] bg-[var(--noodle-blue)]/10"
                        : "border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] hover:border-[var(--noodle-blue)]/50",
                    )}
                  >
                    <p className="text-xs font-bold">{option.title}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted-foreground)]">{option.detail}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveStageProfile}
                disabled={updateAccount.isPending}
                className="flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updateAccount.isPending && <Loader2 size={14} className="animate-spin" />}
                {updateAccount.isPending ? "Saving" : "Save stage profile"}
              </button>
            </div>
          </div>
        </SubSection>

        <SubSection title="Monetization" help="Subscription pricing and pay-per-view bundling for this page.">
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={account.settings?.subscriptionIncludesPpv === true}
                onChange={(event) =>
                  updateAccount.mutate({
                    id: account.id,
                    settings: { subscriptionIncludesPpv: event.target.checked },
                  })
                }
                disabled={updateAccount.isPending}
              />
              <span>
                Subscribers automatically unlock pay-per-post content too. Off by default — subscribers still have to
                unlock each pay-per-post individually.
              </span>
            </label>
            <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <span className="shrink-0 font-semibold text-[var(--foreground)]">Subscription price</span>
              <span>$</span>
              <input
                key={account.id}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                defaultValue={
                  typeof account.settings?.subscriptionPrice === "number"
                    ? (account.settings.subscriptionPrice as number)
                    : ""
                }
                placeholder="9.99"
                onBlur={(event) => {
                  const value = Number.parseFloat(event.target.value);
                  updateAccount.mutate({
                    id: account.id,
                    settings: { subscriptionPrice: Number.isFinite(value) && value >= 0 ? value : null },
                  });
                }}
                className={cn(fieldClass, "h-8 w-24")}
              />
              <span>/mo · shown to fans, no real payment is processed</span>
            </label>
          </div>
        </SubSection>

        <SubSection
          title="Page privacy"
          help="Who this character knows, and who this private page should stay invisible to — separate from the public account's own visibility."
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-[var(--foreground)]">People this character knows</p>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                Biases who this character's public account tries to interact with. It is a preference, not an access
                restriction.
              </p>
              {!linkedPublicAccount ? (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">No linked public account found for this page.</p>
              ) : (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--noodle-divider)] p-2">
                  {otherPublicAccounts.map((candidate) => (
                    <label
                      key={candidate.id}
                      className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[var(--accent)]"
                    >
                      <input
                        type="checkbox"
                        checked={knownAccountIds.has(candidate.id)}
                        onChange={() => toggleKnown(candidate.id)}
                        disabled={updateAccount.isPending}
                      />
                      <span className="truncate">
                        {candidate.displayName} <span className="text-[var(--muted-foreground)]">@{candidate.handle}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--foreground)]">Hide this page from</p>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                These accounts will never see or be shown this page, even in Discover.
              </p>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--noodle-divider)] p-2">
                {otherPublicAccounts.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[var(--accent)]"
                  >
                    <input
                      type="checkbox"
                      checked={hiddenFromIds.has(candidate.id)}
                      onChange={() => toggleHidden(candidate.id)}
                      disabled={updateAccount.isPending}
                    />
                    <span className="truncate">
                      {candidate.displayName} <span className="text-[var(--muted-foreground)]">@{candidate.handle}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </SubSection>

        <SubSection
          title="Fan activity"
          help="Lets existing filler accounts like, comment on, subscribe to, and unlock this page's posts on their own. Fans never write new posts. Also needs Settings → NoodleR → Enable NoodleR fan activity turned on."
        >
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={readFanActivityEnabled(account)}
                onChange={(event) =>
                  updateAccount.mutate({
                    id: account.id,
                    settings: {
                      fanActivity: { ...fanActivitySettingsFromAccount(account), enabled: event.target.checked },
                    },
                  })
                }
                disabled={updateAccount.isPending}
              />
              <span>Turn on fan activity for this page. Off by default.</span>
            </label>
            {readFanActivityEnabled(account) && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={readFanActivityIntensity(account)}
                  onChange={(event) =>
                    updateAccount.mutate({
                      id: account.id,
                      settings: {
                        fanActivity: { ...fanActivitySettingsFromAccount(account), intensity: event.target.value },
                      },
                    })
                  }
                  disabled={updateAccount.isPending}
                  className="h-8 rounded-full border border-[var(--noodle-divider)] bg-[var(--background)] px-2 text-xs"
                >
                  <option value="low">Low (up to 3 actions/run)</option>
                  <option value="medium">Medium (up to 6 actions/run)</option>
                  <option value="high">High (up to 10 actions/run)</option>
                </select>
                <button
                  type="button"
                  onClick={() => simulateFanActivity.mutate(account.id)}
                  disabled={simulateFanActivity.isPending}
                  className="ml-auto h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {simulateFanActivity.isPending ? "Simulating..." : "Simulate fan activity now"}
                </button>
                <label className="mt-1 flex w-full items-start gap-2 text-xs text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={readFanActivityAutoSchedule(account)}
                    onChange={(event) =>
                      updateAccount.mutate({
                        id: account.id,
                        settings: {
                          fanActivity: { ...fanActivitySettingsFromAccount(account), autoSchedule: event.target.checked },
                        },
                      })
                    }
                    disabled={updateAccount.isPending}
                  />
                  <span>Run fan activity on a schedule, unattended. Also needs "Enable NoodleR fan activity" in Settings.</span>
                </label>
              </div>
            )}
          </div>
        </SubSection>

        <SubSection
          title="Automatic posting"
          help="Lets the NoodleR refresh button and unattended scheduler generate new posts for this page. Off by default."
        >
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={readAutoPostEnabled(account)}
                onChange={(event) =>
                  updateAccount.mutate({
                    id: account.id,
                    settings: {
                      autoPost: { ...autoPostSettingsFromAccount(account), enabled: event.target.checked, nextRunAt: null },
                    },
                  })
                }
                disabled={updateAccount.isPending}
              />
              <span>Include this page when refreshing NoodleR automatically. Passive pages still never post.</span>
            </label>
            {readAutoPostEnabled(account) && (
              <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">Posting frequency</span>
                <select
                  value={readAutoPostIntensity(account)}
                  onChange={(event) =>
                    updateAccount.mutate({
                      id: account.id,
                      settings: {
                        autoPost: { ...autoPostSettingsFromAccount(account), intensity: event.target.value, nextRunAt: null },
                      },
                    })
                  }
                  disabled={updateAccount.isPending}
                  className="h-8 rounded-full border border-[var(--noodle-divider)] bg-[var(--background)] px-2 text-xs"
                >
                  <option value="low">Low (up to 1 post/day)</option>
                  <option value="medium">Medium (up to 3 posts/day)</option>
                  <option value="high">High (up to 6 posts/day)</option>
                </select>
              </label>
            )}
          </div>
        </SubSection>
      </div>
    </details>
  );
}
