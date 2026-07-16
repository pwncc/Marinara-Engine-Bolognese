// ──────────────────────────────────────────────
// NoodleR: private creator hub, profile creation, and profile view.
// State and mutations live in NoodleView and are passed down as props.
// ──────────────────────────────────────────────
import { AtSign, Check, ImageIcon, Loader2, Menu, Trash2, User } from "lucide-react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import type { NoodleAccount, NoodlePost } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import type { AvatarCropValue } from "../../lib/utils";
import {
  fieldClass,
  textareaClass,
  subscribeLabel,
  readPrivateIdentityDisclosure,
  readPrivateStageSetting,
  Avatar,
  MobileTimelineBackButton,
  NoodlerLogo,
  NoodlerPrivateBadge,
  ProfileHeaderChrome,
  ProfileTabsAndGrid,
  RefreshTimelineButton,
  type NoodlerHubTab,
  type NoodlerTimelineItem,
  type PrivateStageDraft,
  type ProfileTab,
} from "./noodle-shared";

const NOODLER_HUB_TABS: Array<{ id: NoodlerHubTab; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "discover", label: "Discover" },
  { id: "owned", label: "Creator Pages" },
];

export interface NoodlerHub {
  subscribed: NoodleAccount[];
  owned: NoodleAccount[];
}

export interface NoodlerHomeProps {
  activeNoodleView: "noodler-verification" | "noodler" | "profile";
  personaAccount: NoodleAccount | null;
  isGlobalPersonaSelected: boolean;

  // Verification screen
  onBackToHome: () => void;
  onEnableNoodlerFromVerification: () => void;
  hasSettings: boolean;
  updateSettingsPending: boolean;

  // Hub
  onOpenMobileDrawer: () => void;
  noodlerHubLoading: boolean;
  noodlerHubTab: NoodlerHubTab;
  onNoodlerHubTabChange: (tab: NoodlerHubTab) => void;
  noodlerTimelineItems: NoodlerTimelineItem[];
  renderNoodlerTimelineItem: (item: NoodlerTimelineItem) => React.ReactNode;
  privateAccountsCount: number;
  noodlerHub: NoodlerHub | undefined;
  renderNoodlerAccountRow: (account: NoodleAccount, isOwn: boolean) => React.ReactNode;
  sortedNoodlerDiscoverAccounts: NoodleAccount[];
  renderNoodlerDiscoverCard: (account: NoodleAccount) => React.ReactNode;

  // Shared rich posting surface
  renderPostComposer: (account: NoodleAccount, mode: "noodle" | "noodler", expanded: boolean, id: string) => ReactNode;
  onTriggerRefresh: () => void;
  refreshNoodlePending: boolean;
  // Whether the current persona already has a linked NoodleR account.
  // Gates the Hub timeline composer and the Profile tab sign-up.
  hasNoodlerAccount: boolean;
  personaLinkedNoodlerAccount: NoodleAccount | null;

  // Private profile (activeNoodleView === "profile" && activeNoodleMode === "noodler")
  // When true, the persona has no NoodleR account yet — show the sign-up
  // screen instead of PrivateProfileView.
  showNoodlerSignup: boolean;
  stageDraft: PrivateStageDraft | null;
  onStartStageDraft: () => void;
  onStageDraftChange: (patch: Partial<PrivateStageDraft>) => void;
  onSubmitStageDraft: () => void;
  onCancelStageDraft: () => void;
  stageDraftPending: boolean;
  onOpenOwnProfile: () => void;
  profileViewProps?: PrivateProfileViewProps;
}

export function NoodlerHome(props: NoodlerHomeProps) {
  const {
    activeNoodleView,
    personaAccount,
    isGlobalPersonaSelected,
    onBackToHome,
    onEnableNoodlerFromVerification,
    hasSettings,
    updateSettingsPending,
    onOpenMobileDrawer,
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
    renderPostComposer,
    onTriggerRefresh,
    refreshNoodlePending,
    hasNoodlerAccount,
    personaLinkedNoodlerAccount,
    showNoodlerSignup,
    stageDraft,
    onStartStageDraft,
    onStageDraftChange,
    onSubmitStageDraft,
    onCancelStageDraft,
    stageDraftPending,
    onOpenOwnProfile,
    profileViewProps,
  } = props;
  const activeNoodlerHubTab = isGlobalPersonaSelected ? "timeline" : noodlerHubTab;

  if (activeNoodleView === "profile") {
    if (showNoodlerSignup) {
      if (!stageDraft) {
        return (
          <div className="min-h-full" data-component="NoodlerHome.ProfileSignup">
            <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
              <div className="flex min-h-14 items-center gap-3 px-2 py-2 lg:px-4">
                <MobileTimelineBackButton label="Back to Hub" onClick={onBackToHome} />
                <NoodlerLogo size={28} className="hidden lg:block" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-bold">NoodleR profile</h2>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                    {personaAccount ? `@${personaAccount.handle}` : "Choose a persona account"}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--noodle-blue)] text-zinc-950">
                <NoodlerLogo size={30} />
              </span>
              <h3 className="mt-4 text-xl font-black">Create a NoodleR profile</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                Give this persona a separate NoodleR identity for subscriber and pay-per-view posts. You can edit it
                later from the profile page.
              </p>
              <button
                type="button"
                onClick={onStartStageDraft}
                disabled={!personaAccount}
                className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--noodle-blue)] px-6 text-sm font-black text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <NoodlerLogo size={18} />
                Create NoodleR profile
              </button>
            </div>
          </div>
        );
      }
      return (
        <NoodlerIdBuilder
          personaAccount={personaAccount}
          draft={stageDraft}
          onChange={onStageDraftChange}
          onSubmit={onSubmitStageDraft}
          onCancel={onCancelStageDraft}
          pending={stageDraftPending}
          onBack={onBackToHome}
        />
      );
    }
    return profileViewProps ? <PrivateProfileView {...profileViewProps} /> : null;
  }

  if (activeNoodleView === "noodler-verification") {
    return (
      <div className="min-h-full" data-component="NoodlerHome.Verification">
        <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
          <div className="flex min-h-14 items-center gap-3 px-2 py-2 lg:px-4">
            <MobileTimelineBackButton label="Back to Noodle" onClick={onBackToHome} />
            <NoodlerLogo size={28} className="hidden lg:block" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold">About NoodleR</h2>
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                Optional private creator profiles for adults
              </p>
            </div>
          </div>
        </div>

        <section className="px-4 py-6 sm:px-6 sm:py-8">
          <div className="rounded-lg border border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/8 px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--noodle-blue)]/10">
                <NoodlerLogo size={30} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-normal text-[var(--noodle-blue)]">
                  Before you continue
                </p>
                <h3 className="mt-1 text-2xl font-black leading-tight">NoodleR is an optional 18+ space.</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
                  NoodleR keeps creator profiles, subscriptions, and pay-per-view posts separate from the public Noodle
                  timeline. Enable it only if you want adult creator content in this installation.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              {
                icon: User,
                title: "Separate from Noodle",
                detail: "NoodleR profiles and posts stay out of the public Noodle timeline.",
              },
              {
                icon: ImageIcon,
                title: "Subscriptions and unlocks",
                detail: "Posts can be public, subscriber-only, or pay-per-view. Payments are simulated.",
              },
              {
                icon: AtSign,
                title: "Dedicated profiles",
                detail: "Each NoodleR identity has its own profile, stage persona, and posting settings.",
              },
              {
                icon: Check,
                title: "Adults only",
                detail: "Enable NoodleR only if you are an adult and want this content in Marinara.",
              },
            ].map((item, index) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="rounded-lg border border-[var(--noodle-divider)] bg-[var(--card)] p-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--noodle-blue)]/10 text-[var(--noodle-blue)]">
                      <Icon size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-bold">{item.title}</p>
                        <span className="shrink-0 rounded-full bg-[var(--noodle-blue)]/10 px-2 py-0.5 text-[0.65rem] font-bold text-[var(--noodle-blue)]">
                          {index + 1}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{item.detail}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onEnableNoodlerFromVerification}
              disabled={!hasSettings || updateSettingsPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--noodle-blue)] px-5 text-sm font-black text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateSettingsPending ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
              {updateSettingsPending ? "Enabling..." : "I am 18+ and want to enable NoodleR"}
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
      <div
        className="sticky top-0 z-30 grid h-14 grid-cols-[3rem_minmax(0,1fr)_3rem] items-center border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 px-3 backdrop-blur lg:hidden"
        data-component="NoodlerHome.MobileHeader"
      >
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--accent)]"
          title="Open menu"
          aria-label="Open NoodleR menu"
        >
          <Menu size={22} />
        </button>
        <NoodlerLogo size={34} className="mx-auto" />
        <div aria-hidden="true" />
      </div>
      {!personaAccount && !isGlobalPersonaSelected ? (
        <p className="px-4 py-6 text-sm text-[var(--muted-foreground)]">Choose a persona account first.</p>
      ) : noodlerHubLoading ? (
        <div className="flex justify-center py-14">
          <Loader2 size={24} className="animate-spin text-[var(--noodle-blue)]" />
        </div>
      ) : (
        <>
          <div
            className={cn(
              "sticky top-14 z-20 grid border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur lg:top-0",
              isGlobalPersonaSelected ? "grid-cols-1" : "grid-cols-4",
            )}
          >
            {NOODLER_HUB_TABS.filter((tab) => !isGlobalPersonaSelected || tab.id === "timeline").map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNoodlerHubTabChange(tab.id)}
                className={cn(
                  "relative flex h-12 min-w-0 items-center justify-center px-1 text-center text-xs font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] sm:text-sm",
                  activeNoodlerHubTab === tab.id && "text-[var(--foreground)]",
                )}
              >
                <span className="truncate">{tab.label}</span>
                {activeNoodlerHubTab === tab.id && (
                  <span className="absolute bottom-0 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
                )}
              </button>
            ))}
          </div>
          {activeNoodlerHubTab === "timeline" ? (
            <>
              {isGlobalPersonaSelected ? (
                <div
                  className="border-b border-[var(--noodle-divider)] px-4 py-3 text-sm text-[var(--muted-foreground)]"
                  data-component="NoodlerHome.GlobalComposerNotice"
                >
                  Global mode is view-only. Select a persona to post, subscribe, or unlock content.
                </div>
              ) : !hasNoodlerAccount ? (
                <div
                  className="border-b border-[var(--noodle-divider)] px-4 py-3 text-sm text-[var(--muted-foreground)]"
                  data-component="NoodlerHome.NoAccountComposerNotice"
                >
                  <button
                    type="button"
                    onClick={onOpenOwnProfile}
                    className="font-bold text-[var(--noodle-blue)] hover:underline"
                  >
                    Create a NoodleR profile
                  </button>{" "}
                  to post from the Hub.
                </div>
              ) : (
                <>
                  {personaLinkedNoodlerAccount &&
                    renderPostComposer(personaLinkedNoodlerAccount, "noodler", true, "noodler-hub")}
                  <RefreshTimelineButton
                    onTriggerRefresh={onTriggerRefresh}
                    refreshNoodlePending={refreshNoodlePending}
                  />
                </>
              )}
              {noodlerTimelineItems.length > 0 ? (
                <div>{noodlerTimelineItems.map(renderNoodlerTimelineItem)}</div>
              ) : privateAccountsCount > 0 ? (
                <div className="px-8 py-14 text-center">
                  <NoodlerLogo size={48} className="mx-auto mb-4" />
                  <p className="text-base font-bold">No NoodleR activity yet.</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                    Posts and fan activity visible to this persona will appear here.
                  </p>
                </div>
              ) : (
                <div className="px-8 py-14 text-center">
                  <NoodlerLogo size={48} className="mx-auto mb-4" />
                  <p className="text-base font-bold">No NoodleR profiles yet.</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                    Open a persona or character profile to create its NoodleR profile.
                  </p>
                </div>
              )}
            </>
          ) : activeNoodlerHubTab === "subscriptions" ? (
            noodlerHub && noodlerHub.subscribed.length > 0 ? (
              <div>{noodlerHub.subscribed.map((account) => renderNoodlerAccountRow(account, false))}</div>
            ) : (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                This persona is not subscribed to any NoodleR profiles yet.
              </p>
            )
          ) : activeNoodlerHubTab === "discover" ? (
            sortedNoodlerDiscoverAccounts.length > 0 ? (
              <div>{sortedNoodlerDiscoverAccounts.map(renderNoodlerDiscoverCard)}</div>
            ) : (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                No NoodleR profiles are available to discover yet.
              </p>
            )
          ) : noodlerHub && noodlerHub.owned.length > 0 ? (
            <>
              <p className="border-b border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/8 px-4 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
                Creator Pages shows every persona and character profile you can direct. Subscriptions and unlocks still
                belong to the selected persona.
              </p>
              <div>{noodlerHub.owned.map((account) => renderNoodlerAccountRow(account, true))}</div>
            </>
          ) : (
            <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
              No creator pages yet. Open a persona or character profile to create one.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// NoodleR profile builder, themed as a faux ID card. Flavor only; nothing here
// is real identity verification. Completing it creates the actual
// NoodleR account (via onSubmit -> createPrivateAccount).
// ──────────────────────────────────────────────
function NoodlerIdBuilder({
  personaAccount,
  draft,
  onChange,
  onSubmit,
  onCancel,
  pending,
  onBack,
}: {
  personaAccount: NoodleAccount | null;
  draft: PrivateStageDraft;
  onChange: (patch: Partial<PrivateStageDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  onBack: () => void;
}) {
  const canSubmit = draft.ageAcknowledged && draft.stageName.trim().length > 0 && !pending;

  return (
    <div className="min-h-full" data-component="NoodlerHome.IdBuilder">
      <style>{`
        @keyframes noodler-id-scan {
          0% { transform: translateY(-100%); opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateY(100%); opacity: 0; }
        }
        @keyframes noodler-id-stamp {
          0%, 60% { opacity: 0; transform: scale(1.4) rotate(-12deg); }
          75% { opacity: 1; transform: scale(0.95) rotate(-12deg); }
          100% { opacity: 1; transform: scale(1) rotate(-12deg); }
        }
      `}</style>
      <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
        <div className="flex min-h-14 items-center gap-3 px-2 py-2 lg:px-4">
          <MobileTimelineBackButton label="Back to Hub" onClick={onBack} />
          <NoodlerLogo size={28} className="hidden lg:block" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold">Create NoodleR profile</h2>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {personaAccount ? `@${personaAccount.handle}` : "Choose a persona account"}
            </p>
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Profile preview updates as the fields below change. */}
        <div className="relative overflow-hidden rounded-xl border border-[var(--noodle-divider)] bg-[var(--card)] p-4 shadow-sm">
          <div className="flex items-start gap-4">
            {personaAccount && <Avatar account={personaAccount} size="lg" />}
            <div className="min-w-0 flex-1">
              <p className="text-[0.65rem] font-black uppercase tracking-widest text-[var(--noodle-blue)]">
                NoodleR profile
              </p>
              <p className="mt-1 truncate text-lg font-black leading-tight">{draft.stageName.trim() || "Unnamed"}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                {draft.stageBio.trim() || "No bio yet"}
              </p>
              <p className="mt-2 text-[0.65rem] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                {draft.identityDisclosure} identity &middot;{" "}
                {draft.postingMode === "active" ? "AI posting available" : "Manual posts only"}
              </p>
            </div>
          </div>
          {pending && (
            <>
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[var(--noodle-blue)]/50 to-transparent"
                style={{ animation: "noodler-id-scan 900ms ease-in-out" }}
              />
              <div
                className="pointer-events-none absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full border-2 border-[var(--noodle-blue)] text-[var(--noodle-blue)]"
                style={{ animation: "noodler-id-stamp 900ms ease-in-out forwards" }}
              >
                <Check size={22} />
              </div>
            </>
          )}
        </div>

        <div className="mt-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              Profile name
            </span>
            <input
              value={draft.stageName}
              onChange={(event) => onChange({ stageName: event.target.value })}
              placeholder="Choose a stage name"
              className={fieldClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              Bio
            </span>
            <textarea
              value={draft.stageBio}
              onChange={(event) => onChange({ stageBio: event.target.value })}
              placeholder="Introduce this NoodleR profile"
              className={cn(textareaClass, "min-h-20 resize-none")}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              Stage persona
            </span>
            <textarea
              value={draft.stagePersonality}
              onChange={(event) => onChange({ stagePersonality: event.target.value })}
              placeholder="Voice, attitude, boundaries, and creator persona"
              className={cn(textareaClass, "min-h-24 resize-none")}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              Creator dynamic
            </span>
            <input
              value={draft.stageDynamic}
              onChange={(event) => onChange({ stageDynamic: event.target.value })}
              placeholder="How this profile relates to its audience or collaborators"
              className={fieldClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              Disclosure level
            </span>
            <select
              value={draft.identityDisclosure}
              onChange={(event) =>
                onChange({ identityDisclosure: event.target.value as PrivateStageDraft["identityDisclosure"] })
              }
              className={fieldClass}
            >
              <option value="open">Open</option>
              <option value="hinted">Hinted</option>
              <option value="secret">Secret</option>
            </select>
            <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
              Open allows AI-generated posts to use the linked public identity. Hinted avoids the public name but allows
              subtle references. Secret asks generation to avoid identifying details. These are AI instructions, not a
              privacy guarantee.
            </p>
          </label>

          <div className="space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              AI posting
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                {
                  value: "active" as const,
                  title: "Active",
                  detail: "Manual posts, guided AI, and scheduled AI posting are available.",
                },
                {
                  value: "passive" as const,
                  title: "Passive",
                  detail: "Manual roleplay posts remain available; AI-generated posting is disabled.",
                },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ postingMode: option.value })}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    draft.postingMode === option.value
                      ? "border-[var(--noodle-blue)] bg-[var(--noodle-blue)]/10"
                      : "border-[var(--noodle-divider)] bg-[var(--card)] hover:border-[var(--noodle-blue)]/50",
                  )}
                >
                  <p className="text-sm font-bold">{option.title}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{option.detail}</p>
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-[var(--noodle-divider)] bg-[var(--card)] p-3">
            <input
              type="checkbox"
              checked={draft.ageAcknowledged}
              onChange={(event) => onChange({ ageAcknowledged: event.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--noodle-blue)]"
            />
            <span className="text-xs leading-5 text-[var(--muted-foreground)]">
              I confirm that I am 18 or older and want to create an adult NoodleR profile.
            </span>
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--noodle-blue)] px-6 text-sm font-black text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
            {pending ? "Creating..." : "Create NoodleR profile"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--noodle-divider)] px-5 text-sm font-bold transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────
// Private profile view with shared profile chrome, posting, and tabs.
// ──────────────────────────────────────────────
export interface PrivateProfileViewProps {
  onBackToHome: () => void;
  viewedProfileAccount: NoodleAccount | null;
  profileDisplayHandle: string;
  canEditViewedProfile: boolean;
  profileUploadTarget: "avatar" | "banner" | null;
  bannerFileRef: RefObject<HTMLInputElement | null>;
  avatarFileRef: RefObject<HTMLInputElement | null>;
  onProfileImageFile: (target: "avatar" | "banner", event: ChangeEvent<HTMLInputElement>) => void;
  profileBannerPreview: string;
  profilePreviewAccount: { displayName: string; avatarUrl: string | null; avatarCrop: AvatarCropValue | null };
  isEditingProfile: boolean;
  onEditToggle: () => void;
  canSaveProfile: boolean;
  updateAccountPending: boolean;
  profileName: string;
  onProfileNameChange: (value: string) => void;
  profileHandle: string;
  onProfileHandleChange: (value: string) => void;
  profileBio: string;
  onProfileBioChange: (value: string) => void;
  profileLocation: string;
  onProfileLocationChange: (value: string) => void;
  profileBioPreview: string;
  noodleCustomEmojiMap: Map<string, string>;
  profileLocationPreview: string;
  profileFollowingCount: number;
  profileFollowerCount: number;
  onOpenFollowing: () => void;
  onOpenFollowers: () => void;
  isNoodlerEnabled: boolean;

  // Non-edit action: Subscribe
  subscribed: boolean;
  onToggleSubscription: (creatorAccountId: string) => void;
  subscriptionActionPending: boolean;

  // Extra action: Delete NoodleR profile (own page only)
  viewingOwnPrivateAccount: boolean;
  onDeleteNoodlerProfile: (account: NoodleAccount) => void;
  deletePrivateAccountPending: boolean;

  // Edit-profile settings and shared posting tools
  editExtraContent: ReactNode;
  postingTools: ReactNode;

  // Tabs and grid
  profileTab: ProfileTab;
  onProfileTabChange: (tab: ProfileTab) => void;
  profileVisiblePosts: NoodlePost[];
  isGridLayout: boolean;
  renderPostGrid: (posts: NoodlePost[]) => ReactNode;
  renderPostArticle: (post: NoodlePost) => ReactNode;
}

export function PrivateProfileView(props: PrivateProfileViewProps) {
  const {
    onBackToHome,
    viewedProfileAccount,
    profileDisplayHandle,
    canEditViewedProfile,
    profileUploadTarget,
    bannerFileRef,
    avatarFileRef,
    onProfileImageFile,
    profileBannerPreview,
    profilePreviewAccount,
    isEditingProfile,
    onEditToggle,
    canSaveProfile,
    updateAccountPending,
    profileName,
    onProfileNameChange,
    profileHandle,
    onProfileHandleChange,
    profileBio,
    onProfileBioChange,
    profileLocation,
    onProfileLocationChange,
    profileBioPreview,
    noodleCustomEmojiMap,
    profileLocationPreview,
    profileFollowingCount,
    profileFollowerCount,
    onOpenFollowing,
    onOpenFollowers,
    isNoodlerEnabled,
    subscribed,
    onToggleSubscription,
    subscriptionActionPending,
    viewingOwnPrivateAccount,
    onDeleteNoodlerProfile,
    deletePrivateAccountPending,
    editExtraContent,
    postingTools,
    profileTab,
    onProfileTabChange,
    profileVisiblePosts,
    isGridLayout,
    renderPostGrid,
    renderPostArticle,
  } = props;

  return (
    <div className="border-b border-[var(--noodle-divider)]">
      <ProfileHeaderChrome
        onBackToHome={onBackToHome}
        profileDisplayHandle={profileDisplayHandle}
        canEditViewedProfile={canEditViewedProfile}
        hasViewedProfileAccount={Boolean(viewedProfileAccount)}
        profileUploadTarget={profileUploadTarget}
        onBannerClick={() => {
          if (canEditViewedProfile) bannerFileRef.current?.click();
        }}
        onAvatarClick={() => {
          if (canEditViewedProfile) avatarFileRef.current?.click();
        }}
        profileBannerPreview={profileBannerPreview}
        profilePreviewAccount={profilePreviewAccount}
        bannerFileRef={bannerFileRef}
        avatarFileRef={avatarFileRef}
        onProfileImageFile={onProfileImageFile}
        isEditingProfile={isEditingProfile}
        onEditToggle={onEditToggle}
        canSaveProfile={canSaveProfile}
        updateAccountPending={updateAccountPending}
        nonEditAction={
          viewedProfileAccount && !viewingOwnPrivateAccount ? (
            <button
              type="button"
              onClick={() => onToggleSubscription(viewedProfileAccount.id)}
              disabled={subscriptionActionPending}
              className={cn(
                "mb-1 h-9 rounded-full px-5 text-xs font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                subscribed
                  ? "border border-[var(--noodle-divider)] text-[var(--foreground)]"
                  : "bg-[var(--foreground)] text-[var(--background)]",
              )}
            >
              {subscribeLabel(viewedProfileAccount, subscribed)}
            </button>
          ) : null
        }
        extraActionButtons={
          viewingOwnPrivateAccount && viewedProfileAccount ? (
            <button
              type="button"
              onClick={() => onDeleteNoodlerProfile(viewedProfileAccount)}
              disabled={deletePrivateAccountPending}
              className="mb-1 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--destructive)]/40 text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-50"
              title="Delete NoodleR profile"
              aria-label="Delete NoodleR profile"
            >
              <Trash2 size={15} />
            </button>
          ) : null
        }
        profileName={profileName}
        onProfileNameChange={onProfileNameChange}
        profileHandle={profileHandle}
        onProfileHandleChange={onProfileHandleChange}
        profileBio={profileBio}
        onProfileBioChange={onProfileBioChange}
        profileLocation={profileLocation}
        onProfileLocationChange={onProfileLocationChange}
        badge={isNoodlerEnabled ? <NoodlerPrivateBadge /> : undefined}
        profileBioPreview={profileBioPreview}
        noodleCustomEmojiMap={noodleCustomEmojiMap}
        emojiKeyPrefix={`noodle-profile-bio-${viewedProfileAccount?.id ?? "preview"}`}
        profileLocationPreview={profileLocationPreview}
        belowBioContent={
          viewedProfileAccount ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[var(--noodle-divider)] px-2.5 py-1 font-semibold text-[var(--muted-foreground)]">
                {readPrivateIdentityDisclosure(viewedProfileAccount)} identity
              </span>
              {readPrivateStageSetting(viewedProfileAccount, "stageDynamic") && (
                <span className="rounded-full border border-[var(--noodle-divider)] px-2.5 py-1 text-[var(--muted-foreground)]">
                  {readPrivateStageSetting(viewedProfileAccount, "stageDynamic")}
                </span>
              )}
            </div>
          ) : null
        }
        editExtraContent={editExtraContent}
        profileFollowingCount={profileFollowingCount}
        profileFollowerCount={profileFollowerCount}
        onOpenFollowing={onOpenFollowing}
        onOpenFollowers={onOpenFollowers}
      />
      {postingTools}
      <ProfileTabsAndGrid
        activeTab={profileTab}
        onTabChange={onProfileTabChange}
        posts={profileVisiblePosts}
        isGridLayout={isGridLayout}
        renderPostGrid={renderPostGrid}
        renderPostArticle={renderPostArticle}
      />
    </div>
  );
}
