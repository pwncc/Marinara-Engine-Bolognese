// ──────────────────────────────────────────────
// NoodleR: private creator hub (verification screen, hub tabs:
// timeline/subscriptions/discover/owned). Mechanical extraction
// from NoodleView.tsx (Phase 5 of MARI_NOODLER_SEPARATION_TASK.md)
// — this component is purely presentational. All state, data
// fetching, and mutation handlers still live in the NoodleView
// shell and are passed down as props.
// ──────────────────────────────────────────────
import { AtSign, Check, ImageIcon, Loader2, Menu, Trash2, User } from "lucide-react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import type { NoodleAccount, NoodlePost, NoodlePostAccess, NoodlePostingMode } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import type { AvatarCropValue } from "../../lib/utils";
import { CreatorToolsPanel } from "./CreatorToolsPanel";
import {
  fieldClass,
  textareaClass,
  subscribeLabel,
  readPrivateIdentityDisclosure,
  readPrivateStageSetting,
  Avatar,
  InlineComposer,
  MobileTimelineBackButton,
  NoodlerLogo,
  NoodlerPrivateBadge,
  ProfileHeaderChrome,
  ProfileTabsAndGrid,
  RefreshTimelineButton,
  type ActiveComposerMention,
  type ComposerTool,
  type NoodlerHubTab,
  type NoodlerTimelineItem,
  type PrivateStageDraft,
  type ProfileTab,
} from "./noodle-shared";

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

  // Hub inline composer + refresh (same composer/refresh state as NoodleHome's
  // "home" timeline — NoodleHome and NoodlerHome are never mounted at once)
  composeOpen: boolean;
  inlineComposerRef: RefObject<HTMLTextAreaElement | null>;
  composer: string;
  onComposerChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onComposerBlur: () => void;
  onComposerKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  activeMention: ActiveComposerMention | null;
  mentionSuggestionsCount: number;
  activeMentionIndex: number;
  composePlaceholder: string;
  composeActionLabel: string;
  renderComposerMentionSuggestions: (listboxId: string) => React.ReactNode;
  renderDraftPoll: () => React.ReactNode;
  attachedImageUrl: string;
  onAttachedImageUrlChange: (url: string) => void;
  imageToolRef: RefObject<HTMLDivElement | null>;
  pollToolRef: RefObject<HTMLDivElement | null>;
  mediaToolRef: RefObject<HTMLDivElement | null>;
  activeComposerTool: ComposerTool | null;
  onActiveComposerToolChange: (tool: ComposerTool | null) => void;
  draftPollActive: boolean;
  onTogglePollComposer: () => void;
  onSubmitPost: () => void;
  canSubmitPost: boolean;
  createPostPending: boolean;
  renderComposerToolPopovers: (refs: {
    imageRef: RefObject<HTMLDivElement | null>;
    pollRef: RefObject<HTMLDivElement | null>;
    mediaRef: RefObject<HTMLDivElement | null>;
  }) => React.ReactNode;
  onTriggerRefresh: () => void;
  refreshNoodlePending: boolean;
  // Whether the current persona already has a linked NoodleR account.
  // Gates the Hub timeline composer and the Profile tab sign-up.
  hasNoodlerAccount: boolean;
  // Active accounts post themselves; passive accounts are lurk-only.
  // Gates the Hub timeline composer alongside hasNoodlerAccount.
  noodlerPostingMode: NoodlePostingMode;

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
    composeOpen,
    inlineComposerRef,
    composer,
    onComposerChange,
    onComposerBlur,
    onComposerKeyDown,
    activeMention,
    mentionSuggestionsCount,
    activeMentionIndex,
    composePlaceholder,
    composeActionLabel,
    renderComposerMentionSuggestions,
    renderDraftPoll,
    attachedImageUrl,
    onAttachedImageUrlChange,
    imageToolRef,
    pollToolRef,
    mediaToolRef,
    activeComposerTool,
    onActiveComposerToolChange,
    draftPollActive,
    onTogglePollComposer,
    onSubmitPost,
    canSubmitPost,
    createPostPending,
    renderComposerToolPopovers,
    onTriggerRefresh,
    refreshNoodlePending,
    hasNoodlerAccount,
    noodlerPostingMode,
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
                  <h2 className="truncate text-lg font-bold">Your NoodleR profile</h2>
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
              <h3 className="mt-4 text-xl font-black">Create your NoodleR profile</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                This is where you post as your NoodleR persona — subscriptions, pay-per-view unlocks, and all.
                Set it up once to start posting to the Hub.
              </p>
              <button
                type="button"
                onClick={onStartStageDraft}
                disabled={!personaAccount}
                className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--noodle-blue)] px-6 text-sm font-black text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <NoodlerLogo size={18} />
                Build your NoodleR ID
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
              <h2 className="truncate text-lg font-bold">Meet NoodleR</h2>
              <p className="truncate text-xs text-[var(--muted-foreground)]">Noodle's private, adult-gated corner</p>
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
                <p className="text-xs font-black uppercase tracking-normal text-[var(--noodle-blue)]">What is NoodleR?</p>
                <h3 className="mt-1 text-2xl font-black leading-tight">Noodle's private, 18+ corner.</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
                  NoodleR is a separate, opt-in space for adult creator content — subscriptions and per-post
                  unlocks, kept entirely out of the main Noodle timeline. It's off by default; turning it on for
                  this install is the only step required to see it.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              {
                icon: User,
                title: "Private by default",
                detail: "NoodleR accounts and posts never show up in the main Noodle feed.",
              },
              {
                icon: ImageIcon,
                title: "Subscriptions & unlocks",
                detail: "Pages can be subscriber-only or unlock individual posts, unlike free-to-view Noodle posts.",
              },
              {
                icon: AtSign,
                title: "Its own profile",
                detail: "Posting here requires setting up a dedicated NoodleR profile, separate from your Noodle handle.",
              },
              {
                icon: Check,
                title: "18+ content",
                detail: "This corner exists for adult creator content — only turn it on if that's what you want.",
              },
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
              {updateSettingsPending ? "Enabling" : "Enable NoodleR for this install"}
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
                  Global mode is view-only. Switch to a persona account to post.
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
                  to post yourself.
                </div>
              ) : noodlerPostingMode === "passive" ? (
                <div
                  className="border-b border-[var(--noodle-divider)] px-4 py-3 text-sm text-[var(--muted-foreground)]"
                  data-component="NoodlerHome.PassiveComposerNotice"
                >
                  This account is passive — lurk only.{" "}
                  <button
                    type="button"
                    onClick={onOpenOwnProfile}
                    className="font-bold text-[var(--noodle-blue)] hover:underline"
                  >
                    Switch to active
                  </button>{" "}
                  in your NoodleR settings to post.
                </div>
              ) : (
                <>
                  <InlineComposer
                    personaAccount={personaAccount}
                    composeOpen={composeOpen}
                    inlineComposerRef={inlineComposerRef}
                    composer={composer}
                    onComposerChange={onComposerChange}
                    onComposerBlur={onComposerBlur}
                    onComposerKeyDown={onComposerKeyDown}
                    activeMention={activeMention}
                    mentionSuggestionsCount={mentionSuggestionsCount}
                    activeMentionIndex={activeMentionIndex}
                    composePlaceholder={composePlaceholder}
                    composeActionLabel={composeActionLabel}
                    renderComposerMentionSuggestions={renderComposerMentionSuggestions}
                    renderDraftPoll={renderDraftPoll}
                    attachedImageUrl={attachedImageUrl}
                    onAttachedImageUrlChange={onAttachedImageUrlChange}
                    imageToolRef={imageToolRef}
                    pollToolRef={pollToolRef}
                    mediaToolRef={mediaToolRef}
                    activeComposerTool={activeComposerTool}
                    onActiveComposerToolChange={onActiveComposerToolChange}
                    draftPollActive={draftPollActive}
                    onTogglePollComposer={onTogglePollComposer}
                    onSubmitPost={onSubmitPost}
                    canSubmitPost={canSubmitPost}
                    createPostPending={createPostPending}
                    renderComposerToolPopovers={renderComposerToolPopovers}
                    mentionListboxId="noodler-inline-mention-list"
                    dataComponent="NoodlerHome.InlineComposer"
                  />
                  <RefreshTimelineButton onTriggerRefresh={onTriggerRefresh} refreshNoodlePending={refreshNoodlePending} />
                </>
              )}
              {noodlerTimelineItems.length > 0 ? (
                <div>{noodlerTimelineItems.map(renderNoodlerTimelineItem)}</div>
              ) : privateAccountsCount > 0 ? (
                <div className="px-8 py-14 text-center">
                  <NoodlerLogo size={48} className="mx-auto mb-4" />
                  <p className="text-base font-bold">Nothing here yet.</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                    NoodleR posts, comments, subscribers, and unlocks will show here.
                  </p>
                </div>
              ) : (
                <div className="px-8 py-14 text-center">
                  <NoodlerLogo size={48} className="mx-auto mb-4" />
                  <p className="text-base font-bold">No NoodleR accounts yet.</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                    Create a private page from a persona or character profile.
                  </p>
                </div>
              )}
            </>
          ) : activeNoodlerHubTab === "subscriptions" ? (
            noodlerHub && noodlerHub.subscribed.length > 0 ? (
              <div>{noodlerHub.subscribed.map((account) => renderNoodlerAccountRow(account, false))}</div>
            ) : (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                Not subscribed to any NoodleR creators yet.
              </p>
            )
          ) : activeNoodlerHubTab === "discover" ? (
            sortedNoodlerDiscoverAccounts.length > 0 ? (
              <div>{sortedNoodlerDiscoverAccounts.map(renderNoodlerDiscoverCard)}</div>
            ) : (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                No other NoodleR creators to discover yet.
              </p>
            )
          ) : noodlerHub && noodlerHub.owned.length > 0 ? (
            <>
              <p className="border-b border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/8 px-4 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
                These are all of your own NoodleR profiles — one per persona or character you've given a private page
                to. Each row shows which main account it belongs to.
              </p>
              <div>{noodlerHub.owned.map((account) => renderNoodlerAccountRow(account, true))}</div>
            </>
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

// ──────────────────────────────────────────────
// NoodleR ID builder: the profile-creation flow, themed as a faux
// government-ID card the user fills out. Flavor only — nothing here
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
            <h2 className="truncate text-lg font-bold">Build your NoodleR ID</h2>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {personaAccount ? `@${personaAccount.handle}` : "Choose a persona account"}
            </p>
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-8">
        {/* ID card mockup: live-updates as the fields below change */}
        <div className="relative overflow-hidden rounded-xl border border-[var(--noodle-divider)] bg-[var(--card)] p-4 shadow-sm">
          <div className="flex items-start gap-4">
            {personaAccount && <Avatar account={personaAccount} size="lg" />}
            <div className="min-w-0 flex-1">
              <p className="text-[0.65rem] font-black uppercase tracking-widest text-[var(--noodle-blue)]">
                NoodleR ID
              </p>
              <p className="mt-1 truncate text-lg font-black leading-tight">{draft.stageName.trim() || "Unnamed"}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                {draft.stageBio.trim() || "No bio yet"}
              </p>
              <p className="mt-2 text-[0.65rem] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                Disclosure: {draft.identityDisclosure} &middot; {draft.postingMode === "active" ? "Active" : "Passive"}
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
              Name on ID
            </span>
            <input
              value={draft.stageName}
              onChange={(event) => onChange({ stageName: event.target.value })}
              placeholder="Leave blank for a generated alias"
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
              placeholder="Leave blank for a generated private profile bio"
              className={cn(textareaClass, "min-h-20 resize-none")}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              Private persona
            </span>
            <textarea
              value={draft.stagePersonality}
              onChange={(event) => onChange({ stagePersonality: event.target.value })}
              placeholder="Submissive but well-spoken, bratty, anonymous, polished, confident..."
              className={cn(textareaClass, "min-h-24 resize-none")}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              Dynamic
            </span>
            <input
              value={draft.stageDynamic}
              onChange={(event) => onChange({ stageDynamic: event.target.value })}
              placeholder="soft-spoken tease, controlled submissive, confident domme"
              className={fieldClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              Disclosure level
            </span>
            <select
              value={draft.identityDisclosure}
              onChange={(event) => onChange({ identityDisclosure: event.target.value as PrivateStageDraft["identityDisclosure"] })}
              className={fieldClass}
            >
              <option value="open">Open</option>
              <option value="hinted">Hinted</option>
              <option value="secret">Secret</option>
            </select>
            <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
              "Open" lets generated posts reuse the linked name/handle directly. "Hinted" keeps the linked name
              out of generated text but still allows subtle allusions and in-jokes. "Secret" also filters out
              the linked handle and first name — it's AI-generated content moderation, not a hard guarantee it
              can never slip through.
            </p>
          </label>

          <div className="space-y-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
              How will this account participate?
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: "active" as const, title: "Active", detail: "This account posts too — you'll be able to publish from it." },
                  { value: "passive" as const, title: "Passive", detail: "Lurk only — this account never posts, just browses and subscribes." },
                ]
              ).map((option) => (
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
              I confirm I'm here for adult creator content and I'm of age.
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
            {pending ? "Scanning" : "Create NoodleR profile"}
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
// Private profile view (activeNoodleMode === "noodler"). Renders the
// shared ProfileHeaderChrome with the private-mode action row
// (Edit Profile / Subscribe, plus Delete NoodleR profile when it's
// the viewer's own page), the stage-profile panel, the creator-tools
// composer, the fan-activity panel, and the locked post grid. Public
// profile is NoodleHome's PublicProfileView instead — see
// MARI_NOODLER_SEPARATION_TASK.md Phase 5/6.
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

  // AI-guided post generation (own page only)
  onOpenGuidedPrivatePost: (account: NoodleAccount) => void;
  refreshNoodlePending: boolean;

  // Creator-tools composer (own page only)
  onRetryPrivateIdentity: (accountId: string) => void;
  retryPrivateIdentityPending: boolean;
  privateComposerText: string;
  onPrivateComposerTextChange: (value: string) => void;
  privateComposerAccess: NoodlePostAccess;
  onPrivateComposerAccessChange: (access: NoodlePostAccess) => void;
  privateComposerPpvPrice: string;
  onPrivateComposerPpvPriceChange: (value: string) => void;
  privateComposerImageUrl: string;
  onPrivateComposerImageUrlChange: (value: string) => void;
  onSubmitPrivatePost: () => void;
  createPostPending: boolean;

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
    onOpenGuidedPrivatePost,
    refreshNoodlePending,
    onRetryPrivateIdentity,
    retryPrivateIdentityPending,
    privateComposerText,
    onPrivateComposerTextChange,
    privateComposerAccess,
    onPrivateComposerAccessChange,
    privateComposerPpvPrice,
    onPrivateComposerPpvPriceChange,
    privateComposerImageUrl,
    onPrivateComposerImageUrlChange,
    onSubmitPrivatePost,
    createPostPending,
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
        profileFollowingCount={profileFollowingCount}
        profileFollowerCount={profileFollowerCount}
        onOpenFollowing={onOpenFollowing}
        onOpenFollowers={onOpenFollowers}
      />

      {viewingOwnPrivateAccount && viewedProfileAccount && (
        <div className="border-t border-[var(--noodle-divider)] px-4 py-3">
          <CreatorToolsPanel
            mode="noodler"
            account={viewedProfileAccount}
            onOpenGuidedPost={onOpenGuidedPrivatePost}
            guidedPostPending={refreshNoodlePending}
            onRetryIdentity={onRetryPrivateIdentity}
            retryIdentityPending={retryPrivateIdentityPending}
            composerText={privateComposerText}
            onComposerTextChange={onPrivateComposerTextChange}
            composerAccess={privateComposerAccess}
            onComposerAccessChange={onPrivateComposerAccessChange}
            composerPpvPrice={privateComposerPpvPrice}
            onComposerPpvPriceChange={onPrivateComposerPpvPriceChange}
            composerImageUrl={privateComposerImageUrl}
            onComposerImageUrlChange={onPrivateComposerImageUrlChange}
            onSubmitPost={onSubmitPrivatePost}
            createPostPending={createPostPending}
          />
        </div>
      )}

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
