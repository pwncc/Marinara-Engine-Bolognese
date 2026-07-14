// ──────────────────────────────────────────────
// NoodleR: private creator hub (verification screen, hub tabs:
// timeline/subscriptions/discover/owned). Mechanical extraction
// from NoodleView.tsx (Phase 5 of MARI_NOODLER_SEPARATION_TASK.md)
// — this component is purely presentational. All state, data
// fetching, and mutation handlers still live in the NoodleView
// shell and are passed down as props.
// ──────────────────────────────────────────────
import { AtSign, Check, ImageIcon, Loader2, Lock, User } from "lucide-react";
import { toast } from "sonner";
import type { NoodleAccount } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { Avatar, MobileTimelineBackButton, type NoodlerHubTab, type NoodlerTimelineItem } from "./noodle-shared";

const NOODLER_HUB_TABS: Array<{ id: NoodlerHubTab; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "discover", label: "Discover" },
  { id: "owned", label: "Your Pages" },
];

export interface NoodlerHub {
  subscribed: NoodleAccount[];
  owned: NoodleAccount[];
}

export interface NoodlerHomeProps {
  activeNoodleView: "noodler-verification" | "noodler";
  personaAccount: NoodleAccount | null;

  // Verification screen
  onBackToHome: () => void;
  onToggleMobileAccountSwitcher: () => void;
  mobileAccountSwitcherOpen: boolean;
  onEnableNoodlerFromVerification: () => void;
  hasSettings: boolean;
  updateSettingsPending: boolean;

  // Hub
  noodlerHubLoading: boolean;
  noodlerHubTab: NoodlerHubTab;
  onNoodlerHubTabChange: (tab: NoodlerHubTab) => void;
  noodlerTimelineItems: NoodlerTimelineItem[];
  renderNoodlerTimelineItem: (item: NoodlerTimelineItem) => React.ReactNode;
  privateAccountsCount: number;
  noodlerHub: NoodlerHub | undefined;
  renderNoodlerAccountRow: (account: NoodleAccount) => React.ReactNode;
  sortedNoodlerDiscoverAccounts: NoodleAccount[];
  renderNoodlerDiscoverCard: (account: NoodleAccount) => React.ReactNode;
}

export function NoodlerHome(props: NoodlerHomeProps) {
  const {
    activeNoodleView,
    personaAccount,
    onBackToHome,
    onToggleMobileAccountSwitcher,
    mobileAccountSwitcherOpen,
    onEnableNoodlerFromVerification,
    hasSettings,
    updateSettingsPending,
    noodlerHubLoading,
    noodlerHubTab,
    onNoodlerHubTabChange,
    noodlerTimelineItems,
    renderNoodlerTimelineItem,
    privateAccountsCount,
    noodlerHub,
    renderNoodlerAccountRow,
    sortedNoodlerDiscoverAccounts,
    renderNoodlerDiscoverCard,
  } = props;

  if (activeNoodleView === "noodler-verification") {
    return (
      <div className="min-h-full" data-component="NoodlerHome.Verification">
        <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
          <div className="flex min-h-14 items-center gap-3 px-2 py-2 lg:px-4">
            <button
              data-component="NoodleView.MobileAccountSwitcher"
              type="button"
              onClick={onToggleMobileAccountSwitcher}
              aria-label="Switch persona account"
              aria-expanded={mobileAccountSwitcherOpen}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--accent)] lg:hidden"
              title="Switch persona"
            >
              {personaAccount ? (
                <Avatar account={personaAccount} size="sm" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 ring-1 ring-[var(--noodle-blue)]/25">
                  <AtSign size={18} />
                </span>
              )}
            </button>
            <MobileTimelineBackButton label="Back to Noodle" onClick={onBackToHome} />
            <Lock size={22} className="hidden text-[var(--noodle-blue)] lg:block" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold">NoodleR Verification</h2>
              <p className="truncate text-xs text-[var(--muted-foreground)]">Private creator network access</p>
            </div>
          </div>
        </div>

        <section className="px-4 py-6 sm:px-6 sm:py-8">
          <div className="rounded-lg border border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/8 px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--noodle-blue)] text-zinc-950">
                <Lock size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-normal text-[var(--noodle-blue)]">Verification Desk</p>
                <h3 className="mt-1 text-2xl font-black leading-tight">Verify your NoodleR eligibility.</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
                  NoodleR uses private creator pages, subscriptions, and paid unlocks. This quick check marks the
                  feature as intentionally enabled before those controls appear.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              { icon: User, title: "Government ID", detail: "Passport, license, or anything that looks official enough." },
              { icon: ImageIcon, title: "Photo pass", detail: "A current profile photo for the badge desk." },
              { icon: AtSign, title: "Handle match", detail: "Confirm the Noodle account requesting access." },
              { icon: Check, title: "Access notice", detail: "Acknowledge that NoodleR profiles are private pages." },
            ].map((item, index) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-lg border border-[var(--noodle-divider)] bg-[var(--card)] p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--noodle-blue)]/10 text-[var(--noodle-blue)]">
                      <Icon size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-bold">{item.title}</p>
                        <span className="shrink-0 rounded-full bg-[var(--noodle-blue)]/10 px-2 py-0.5 text-[0.65rem] font-bold text-[var(--noodle-blue)]">
                          Step {index + 1}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{item.detail}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-5 rounded-lg border border-dashed border-[var(--noodle-blue)]/45 bg-[var(--background)] p-4">
            <p className="text-sm font-bold">Upload packet</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {["Front of ID", "Back of ID", "Photo pass"].map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toast.info("No upload needed. This verification desk is only a preview.")}
                  className="flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--noodle-divider)] bg-[var(--card)] text-xs font-bold text-[var(--muted-foreground)] transition-colors hover:border-[var(--noodle-blue)]/60 hover:text-[var(--foreground)]"
                >
                  <ImageIcon size={18} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-[var(--noodle-divider)] bg-[var(--card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">Review status</span>
              <span className="rounded-full bg-[var(--noodle-blue)]/10 px-2 py-1 text-xs font-black text-[var(--noodle-blue)]">
                Ready instantly
              </span>
            </div>
            <div className="mt-3 space-y-2 text-xs leading-5 text-[var(--muted-foreground)]">
              <p>1. Review the requested materials.</p>
              <p>2. Click start verification.</p>
              <p>3. NoodleR unlocks immediately after the very short review.</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onEnableNoodlerFromVerification}
              disabled={!hasSettings || updateSettingsPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--noodle-blue)] px-5 text-sm font-black text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateSettingsPending ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
              {updateSettingsPending ? "Verifying" : "Start verification"}
            </button>
            <button
              type="button"
              onClick={onBackToHome}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--noodle-divider)] px-5 text-sm font-bold transition-colors hover:bg-[var(--accent)]"
            >
              Maybe later
            </button>
          </div>
        </section>
      </div>
    );
  }

  // "noodler" hub
  return (
    <div className="min-h-full" data-component="NoodlerHome.Hub">
      <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
        <div className="flex min-h-14 items-center gap-3 px-2 py-2 lg:px-4">
          <button
            data-component="NoodleView.MobileAccountSwitcher"
            type="button"
            onClick={onToggleMobileAccountSwitcher}
            aria-label="Switch persona account"
            aria-expanded={mobileAccountSwitcherOpen}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--accent)] lg:hidden"
            title="Switch persona"
          >
            {personaAccount ? (
              <Avatar account={personaAccount} size="sm" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 ring-1 ring-[var(--noodle-blue)]/25">
                <AtSign size={18} />
              </span>
            )}
          </button>
          <MobileTimelineBackButton label="Back to Noodle" onClick={onBackToHome} />
          <Lock size={22} className="hidden text-[var(--noodle-blue)] lg:block" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold">NoodleR</h2>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {personaAccount ? `Private creator network · @${personaAccount.handle}` : "Choose a persona account"}
            </p>
          </div>
        </div>
      </div>
      {!personaAccount ? (
        <p className="px-4 py-6 text-sm text-[var(--muted-foreground)]">Choose a persona account first.</p>
      ) : noodlerHubLoading ? (
        <div className="flex justify-center py-14">
          <Loader2 size={24} className="animate-spin text-[var(--noodle-blue)]" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 border-b border-[var(--noodle-divider)]">
            {NOODLER_HUB_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNoodlerHubTabChange(tab.id)}
                className={cn(
                  "relative flex h-12 min-w-0 items-center justify-center px-1 text-center text-xs font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] sm:text-sm",
                  noodlerHubTab === tab.id && "text-[var(--foreground)]",
                )}
              >
                <span className="truncate">{tab.label}</span>
                {noodlerHubTab === tab.id && (
                  <span className="absolute bottom-0 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
                )}
              </button>
            ))}
          </div>
          {noodlerHubTab === "timeline" ? (
            noodlerTimelineItems.length > 0 ? (
              <div>{noodlerTimelineItems.map(renderNoodlerTimelineItem)}</div>
            ) : privateAccountsCount > 0 ? (
              <div className="px-8 py-14 text-center">
                <Lock size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
                <p className="text-base font-bold">Nothing here yet.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                  NoodleR posts, comments, subscribers, and unlocks will show here.
                </p>
              </div>
            ) : (
              <div className="px-8 py-14 text-center">
                <Lock size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
                <p className="text-base font-bold">No NoodleR accounts yet.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                  Create a private page from a persona or character profile.
                </p>
              </div>
            )
          ) : noodlerHubTab === "subscriptions" ? (
            noodlerHub && noodlerHub.subscribed.length > 0 ? (
              <div>{noodlerHub.subscribed.map((account) => renderNoodlerAccountRow(account))}</div>
            ) : (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                Not subscribed to any NoodleR creators yet.
              </p>
            )
          ) : noodlerHubTab === "discover" ? (
            sortedNoodlerDiscoverAccounts.length > 0 ? (
              <div>{sortedNoodlerDiscoverAccounts.map(renderNoodlerDiscoverCard)}</div>
            ) : (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                No other NoodleR creators to discover yet.
              </p>
            )
          ) : noodlerHub && noodlerHub.owned.length > 0 ? (
            <div>{noodlerHub.owned.map((account) => renderNoodlerAccountRow(account))}</div>
          ) : (
            <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
              No NoodleR pages of your own yet. Create one from a persona's profile.
            </p>
          )}
        </>
      )}
    </div>
  );
}
