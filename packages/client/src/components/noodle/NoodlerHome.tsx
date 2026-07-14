// ──────────────────────────────────────────────
// NoodleR: private creator hub (verification screen, hub tabs:
// timeline/subscriptions/discover/owned). Mechanical extraction
// from NoodleView.tsx (Phase 5 of MARI_NOODLER_SEPARATION_TASK.md)
// — this component is purely presentational. All state, data
// fetching, and mutation handlers still live in the NoodleView
// shell and are passed down as props.
// ──────────────────────────────────────────────
import { AtSign, Check, ImageIcon, Loader2, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import type { ChangeEvent, CSSProperties, ReactNode, RefObject } from "react";
import type {
  NoodleAccount,
  NoodlePost,
  NoodlePostAccess,
  NoodlePrivateIdentityDisclosure,
} from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import type { AvatarCropValue } from "../../lib/utils";
import {
  fieldClass,
  labelClass,
  textareaClass,
  subscribeLabel,
  readPrivateIdentityDisclosure,
  readPrivateStageSetting,
  readFanActivityEnabled,
  readFanActivityIntensity,
  readFanActivityAutoSchedule,
  fanActivitySettingsFromAccount,
  MobileTimelineBackButton,
  NoodlerMark,
  NoodlerPrivateBadge,
  ProfileHeaderChrome,
  ProfileTabsAndGrid,
  type NoodlerHubTab,
  type NoodlerTimelineItem,
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

  // Verification screen
  onBackToHome: () => void;
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

  // Private profile (activeNoodleView === "profile" && activeNoodleMode === "noodler")
  profileViewProps?: PrivateProfileViewProps;
}

export function NoodlerHome(props: NoodlerHomeProps) {
  const {
    activeNoodleView,
    personaAccount,
    onBackToHome,
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
    profileViewProps,
  } = props;

  if (activeNoodleView === "profile") {
    return profileViewProps ? <PrivateProfileView {...profileViewProps} /> : null;
  }

  if (activeNoodleView === "noodler-verification") {
    return (
      <div className="min-h-full" data-component="NoodlerHome.Verification">
        <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
          <div className="flex min-h-14 items-center gap-3 px-2 py-2 lg:px-4">
            <MobileTimelineBackButton label="Back to Noodle" onClick={onBackToHome} />
            <NoodlerMark size={22} className="hidden text-[var(--noodle-blue)] lg:block" />
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
                <NoodlerMark size={22} />
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
          <MobileTimelineBackButton label="Back to Noodle" onClick={onBackToHome} />
          <NoodlerMark size={22} className="hidden text-[var(--noodle-blue)] lg:block" />
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
                <NoodlerMark size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
                <p className="text-base font-bold">Nothing here yet.</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                  NoodleR posts, comments, subscribers, and unlocks will show here.
                </p>
              </div>
            ) : (
              <div className="px-8 py-14 text-center">
                <NoodlerMark size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
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

  // Stage profile panel (linked character pages only)
  stageProfileEditing: boolean;
  onStageProfileEditingChange: (editing: boolean) => void;
  stageProfileDisclosure: NoodlePrivateIdentityDisclosure;
  onStageProfileDisclosureChange: (value: NoodlePrivateIdentityDisclosure) => void;
  stageProfileName: string;
  onStageProfileNameChange: (value: string) => void;
  stageProfilePersonality: string;
  onStageProfilePersonalityChange: (value: string) => void;
  stageProfileDynamic: string;
  onStageProfileDynamicChange: (value: string) => void;
  stageProfileAppearanceOverride: string;
  onStageProfileAppearanceOverrideChange: (value: string) => void;
  stageProfileBio: string;
  onStageProfileBioChange: (value: string) => void;
  onSaveStageProfile: () => void;
  onOpenGuidedPrivatePost: (account: NoodleAccount) => void;
  refreshNoodlePending: boolean;

  // Creator-tools composer (own page only)
  onRetryPrivateIdentity: (accountId: string) => void;
  retryPrivateIdentityPending: boolean;
  onUpdateAccountSettings: (accountId: string, settings: Record<string, unknown>) => void;
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

  // Fan activity panel
  onSimulateFanActivity: (accountId: string) => void;
  simulateFanActivityPending: boolean;

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
    stageProfileEditing,
    onStageProfileEditingChange,
    stageProfileDisclosure,
    onStageProfileDisclosureChange,
    stageProfileName,
    onStageProfileNameChange,
    stageProfilePersonality,
    onStageProfilePersonalityChange,
    stageProfileDynamic,
    onStageProfileDynamicChange,
    stageProfileAppearanceOverride,
    onStageProfileAppearanceOverrideChange,
    stageProfileBio,
    onStageProfileBioChange,
    onSaveStageProfile,
    onOpenGuidedPrivatePost,
    refreshNoodlePending,
    onRetryPrivateIdentity,
    retryPrivateIdentityPending,
    onUpdateAccountSettings,
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
    onSimulateFanActivity,
    simulateFanActivityPending,
    profileTab,
    onProfileTabChange,
    profileVisiblePosts,
    isGridLayout,
    renderPostGrid,
    renderPostArticle,
  } = props;

  const linkedAccountKindLabel = viewedProfileAccount?.kind === "character" ? "character" : "persona";

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
          viewedProfileAccount ? (
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
        <div className="border-t border-[var(--noodle-divider)] p-4">
          <div className="mb-4">
            <h4 className="text-sm font-bold text-[var(--foreground)]">NoodleR creator tools</h4>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Manage your stage identity, generate a post with AI, or post manually. Timeline refreshes will not
              post here automatically.
            </p>
          </div>
          <div className="mb-4 rounded-lg border border-[var(--noodle-divider)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h5 className="text-sm font-bold text-[var(--foreground)]">Stage profile</h5>
                <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                  Controls the private creator identity while the linked {linkedAccountKindLabel} keeps the visual
                  anchor.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onStageProfileEditingChange(!stageProfileEditing)}
                className="h-8 shrink-0 rounded-full border border-[var(--noodle-divider)] px-3 text-xs font-bold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                {stageProfileEditing ? "Close" : "Edit"}
              </button>
            </div>
            {stageProfileEditing ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className={labelClass}>Identity</span>
                    <select
                      value={stageProfileDisclosure}
                      onChange={(event) =>
                        onStageProfileDisclosureChange(event.target.value as NoodlePrivateIdentityDisclosure)
                      }
                      className={fieldClass}
                    >
                      <option value="open">Open</option>
                      <option value="hinted">Hinted</option>
                      <option value="secret">Secret</option>
                    </select>
                    <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
                      "Secret" filters the linked name out of generated posts/images — it's AI-generated content
                      moderation, not a hard guarantee it can never slip through.
                    </p>
                  </label>
                  <label className="block space-y-1.5">
                    <span className={labelClass}>Stage name</span>
                    <input
                      value={stageProfileName}
                      onChange={(event) => onStageProfileNameChange(event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                </div>
                <label className="block space-y-1.5">
                  <span className={labelClass}>Private persona</span>
                  <textarea
                    value={stageProfilePersonality}
                    onChange={(event) => onStageProfilePersonalityChange(event.target.value)}
                    className={cn(textareaClass, "min-h-20 resize-none")}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className={labelClass}>Dynamic</span>
                  <input
                    value={stageProfileDynamic}
                    onChange={(event) => onStageProfileDynamicChange(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className={labelClass}>Appearance/style override</span>
                  <textarea
                    value={stageProfileAppearanceOverride}
                    onChange={(event) => onStageProfileAppearanceOverrideChange(event.target.value)}
                    placeholder={`Optional styling, outfit, or presentation notes. The linked ${linkedAccountKindLabel}'s body/face is still preserved.`}
                    className={cn(textareaClass, "min-h-20 resize-none")}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className={labelClass}>Bio</span>
                  <textarea
                    value={stageProfileBio}
                    onChange={(event) => onStageProfileBioChange(event.target.value)}
                    className={cn(textareaClass, "min-h-20 resize-none")}
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onStageProfileEditingChange(false)}
                    disabled={updateAccountPending}
                    className="h-8 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] px-3 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onSaveStageProfile}
                    disabled={updateAccountPending}
                    className="flex h-8 items-center justify-center gap-2 rounded-md bg-[var(--noodle-blue)] px-3 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateAccountPending && <Loader2 size={14} className="animate-spin" />}
                    {updateAccountPending ? "Saving" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 grid gap-2 text-xs text-[var(--muted-foreground)]">
                <p>
                  <span className="font-semibold text-[var(--foreground)]">Identity:</span>{" "}
                  {readPrivateIdentityDisclosure(viewedProfileAccount)}
                </p>
                {readPrivateStageSetting(viewedProfileAccount, "stagePersonality") && (
                  <p className="line-clamp-2">
                    <span className="font-semibold text-[var(--foreground)]">Persona:</span>{" "}
                    {readPrivateStageSetting(viewedProfileAccount, "stagePersonality")}
                  </p>
                )}
                {readPrivateStageSetting(viewedProfileAccount, "stageAppearanceOverride") && (
                  <p className="line-clamp-2">
                    <span className="font-semibold text-[var(--foreground)]">Style:</span>{" "}
                    {readPrivateStageSetting(viewedProfileAccount, "stageAppearanceOverride")}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--noodle-divider)] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h5 className="text-sm font-bold text-[var(--foreground)]">Generate with AI</h5>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                One guided post — choose access, theme, and whether to include text and/or an image.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenGuidedPrivatePost(viewedProfileAccount)}
              disabled={refreshNoodlePending}
              className="h-8 shrink-0 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate guided post
            </button>
          </div>

          {(viewedProfileAccount?.settings?.stageIdentityGenerationFailed === true ||
            viewedProfileAccount?.settings?.avatarGenerationFailed === true) && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
              <span>
                {viewedProfileAccount?.settings?.stageIdentityGenerationFailed === true
                  ? "Stage identity generation failed — this profile is using placeholder defaults."
                  : "Avatar generation failed for this profile."}
              </span>
              <button
                type="button"
                onClick={() => viewedProfileAccount && onRetryPrivateIdentity(viewedProfileAccount.id)}
                disabled={retryPrivateIdentityPending}
                className="h-7 shrink-0 rounded-full border border-[var(--destructive)]/50 px-3 font-bold transition-colors hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retryPrivateIdentityPending ? "Retrying…" : "Retry"}
              </button>
            </div>
          )}
          <label className="mb-3 flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={viewedProfileAccount?.settings?.subscriptionIncludesPpv === true}
              onChange={(event) =>
                viewedProfileAccount &&
                onUpdateAccountSettings(viewedProfileAccount.id, { subscriptionIncludesPpv: event.target.checked })
              }
              disabled={updateAccountPending}
            />
            <span>
              Subscribers automatically unlock pay-per-post content too. Off by default — subscribers still have to
              unlock each pay-per-post individually.
            </span>
          </label>
          <label className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <span className="shrink-0 font-semibold text-[var(--foreground)]">Subscription price</span>
            <span>$</span>
            <input
              key={viewedProfileAccount?.id}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={
                typeof viewedProfileAccount?.settings?.subscriptionPrice === "number"
                  ? (viewedProfileAccount.settings.subscriptionPrice as number)
                  : ""
              }
              placeholder="9.99"
              onBlur={(event) => {
                if (!viewedProfileAccount) return;
                const value = Number.parseFloat(event.target.value);
                onUpdateAccountSettings(viewedProfileAccount.id, {
                  subscriptionPrice: Number.isFinite(value) && value >= 0 ? value : null,
                });
              }}
              className={cn(fieldClass, "h-7 w-24")}
            />
            <span>/mo · shown to fans, no real payment is processed</span>
          </label>
          <textarea
            value={privateComposerText}
            onChange={(event) => onPrivateComposerTextChange(event.target.value)}
            placeholder="Post to your NoodleR…"
            className={cn(textareaClass, "min-h-16 w-full resize-none bg-transparent")}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(
              [
                { value: "public", label: "Public" },
                {
                  value: "subscriber",
                  label:
                    typeof viewedProfileAccount?.settings?.subscriptionPrice === "number"
                      ? `Subscribers · $${(viewedProfileAccount.settings.subscriptionPrice as number).toFixed(2)}/mo`
                      : "Subscribers only",
                },
                { value: "ppv", label: "Pay-per-view" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onPrivateComposerAccessChange(option.value)}
                style={{ "--chip-tint": "var(--noodle-blue)" } as CSSProperties}
                className={cn(
                  "mari-suggestion-chip",
                  privateComposerAccess === option.value && "mari-suggestion-chip--selected",
                )}
              >
                {option.label}
              </button>
            ))}
            {privateComposerAccess === "ppv" && (
              <input
                value={privateComposerPpvPrice}
                onChange={(event) => onPrivateComposerPpvPriceChange(event.target.value)}
                placeholder="Price (optional)"
                inputMode="decimal"
                className={cn(fieldClass, "h-7 w-28")}
              />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={privateComposerImageUrl}
              onChange={(event) => onPrivateComposerImageUrlChange(event.target.value)}
              placeholder="Image URL (optional)"
              className={cn(fieldClass, "h-8 flex-1")}
            />
            <button
              type="button"
              onClick={onSubmitPrivatePost}
              disabled={createPostPending || (!privateComposerText.trim() && !privateComposerImageUrl.trim())}
              className="ml-auto h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Post
            </button>
          </div>
        </div>
      )}

      {viewingOwnPrivateAccount && viewedProfileAccount && (
        <div className="border-t border-[var(--noodle-divider)] p-4">
          <div className="mb-3">
            <h4 className="text-sm font-bold text-[var(--foreground)]">Fan activity</h4>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Lets existing filler accounts like, comment on, subscribe to, and unlock this page's posts on their
              own. Fans never write new posts — only you do that.
            </p>
          </div>
          <label className="mb-3 flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={readFanActivityEnabled(viewedProfileAccount)}
              onChange={(event) =>
                viewedProfileAccount &&
                onUpdateAccountSettings(viewedProfileAccount.id, {
                  fanActivity: {
                    ...fanActivitySettingsFromAccount(viewedProfileAccount),
                    enabled: event.target.checked,
                  },
                })
              }
              disabled={updateAccountPending}
            />
            <span>Turn on fan activity for this page. Off by default.</span>
          </label>
          {readFanActivityEnabled(viewedProfileAccount) && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={readFanActivityIntensity(viewedProfileAccount)}
                onChange={(event) =>
                  viewedProfileAccount &&
                  onUpdateAccountSettings(viewedProfileAccount.id, {
                    fanActivity: {
                      ...fanActivitySettingsFromAccount(viewedProfileAccount),
                      intensity: event.target.value,
                    },
                  })
                }
                disabled={updateAccountPending}
                className="h-8 rounded-full border border-[var(--noodle-divider)] bg-[var(--background)] px-2 text-xs"
              >
                <option value="low">Low (up to 3 actions/run)</option>
                <option value="medium">Medium (up to 6 actions/run)</option>
                <option value="high">High (up to 10 actions/run)</option>
              </select>
              <button
                type="button"
                onClick={() => viewedProfileAccount && onSimulateFanActivity(viewedProfileAccount.id)}
                disabled={simulateFanActivityPending}
                className="ml-auto h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {simulateFanActivityPending ? "Simulating…" : "Simulate fan activity now"}
              </button>
              <label className="mt-1 flex w-full items-start gap-2 text-xs text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={readFanActivityAutoSchedule(viewedProfileAccount)}
                  onChange={(event) =>
                    viewedProfileAccount &&
                    onUpdateAccountSettings(viewedProfileAccount.id, {
                      fanActivity: {
                        ...fanActivitySettingsFromAccount(viewedProfileAccount),
                        autoSchedule: event.target.checked,
                      },
                    })
                  }
                  disabled={updateAccountPending}
                />
                <span>
                  Run fan activity on a schedule, unattended. Also needs "Enable NoodleR fan activity" on in Noodle
                  settings — this only opts this page in, it doesn't turn scheduling on by itself.
                </span>
              </label>
            </div>
          )}
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
