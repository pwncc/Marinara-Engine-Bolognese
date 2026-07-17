// ──────────────────────────────────────────────
// Noodle: public feed (home timeline, search, notifications).
// Presentational public-feed surface. State, data fetching, and
// mutation handlers live in NoodleView and are passed down as props.
// ──────────────────────────────────────────────
import { AtSign, Bell, Globe2, Heart, MessageCircle, Search, X } from "lucide-react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import type { NoodleAccount, NoodlePost, NoodleSettings } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import type { AvatarCropValue } from "../../lib/utils";
import {
  Avatar,
  MobileTimelineBackButton,
  NoodleLogo,
  NoodlerBadge,
  ProfileHeaderChrome,
  ProfileTabsAndGrid,
  RefreshTimelineButton,
  type NotificationTab,
  type ProfileTab,
  type TimelineTab,
} from "./noodle-shared";

const TIMELINE_TABS: Array<{ id: TimelineTab; label: string }> = [
  { id: "main", label: "Main" },
  { id: "following", label: "Following" },
];

const NOTIFICATION_TABS: Array<{ id: NotificationTab; label: string }> = [
  { id: "likes", label: "Likes" },
  { id: "follows", label: "Follows" },
  { id: "replies", label: "Replies" },
];

type SuggestedCharacter = {
  account: NoodleAccount;
  accountId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
};

export interface NoodleHomeProps {
  activeNoodleView: "home" | "search" | "notifications";
  isLoading: boolean;
  personaAccount: NoodleAccount | null;
  isGlobalPersonaSelected: boolean;
  settings: NoodleSettings | undefined;

  // Mobile chrome
  onOpenMobileDrawer: () => void;
  onBackToHome: () => void;

  // Search / account lookup
  postSearch: string;
  onPostSearchChange: (value: string) => void;
  rawPostSearch: string;
  normalizedPostSearch: string;
  isAccountSearch: boolean;
  accountSearchTerm: string;
  accountSearchResults: NoodleAccount[];
  renderAccountRow: (account: NoodleAccount, options?: { showFollowButton?: boolean }) => React.ReactNode;

  // Timeline
  timelineTab: TimelineTab;
  onTimelineTabChange: (tab: TimelineTab) => void;
  timelinePosts: NoodlePost[];
  baseTimelinePostsCount: number;
  postsCount: number;
  renderPostArticle: (post: NoodlePost) => React.ReactNode;
  renderPostGrid: (posts: NoodlePost[]) => React.ReactNode;
  onOpenProfile: (account: NoodleAccount | null) => void;

  // Who to follow
  suggestedCharacters: SuggestedCharacter[];
  followableCharacterAccountsCount: number;
  onUpdateFollowedAccount: (account: NoodleAccount, followed: boolean) => void;
  updateAccountPending: boolean;

  // Shared rich posting surface
  renderPostComposer: (account: NoodleAccount, mode: "noodle" | "noodler", expanded: boolean, id: string) => ReactNode;

  // Refresh
  onTriggerRefresh: () => void;
  refreshNoodlePending: boolean;
  imagePromptReviewItemsCount: number;

  // Notifications
  notificationTab: NotificationTab;
  onNotificationTabChange: (tab: NotificationTab) => void;
  notificationLikesCount: number;
  notificationFollowAccountsCount: number;
  notificationReplyItemsCount: number;
  renderLikeNotification: (item: unknown) => React.ReactNode;
  renderFollowNotification: (item: unknown) => React.ReactNode;
  renderReplyNotification: (item: unknown) => React.ReactNode;
  notificationLikes: unknown[];
  notificationFollowAccounts: unknown[];
  notificationReplyItems: unknown[];

  // Load older posts
  hasOlderHistory: boolean;
  oldestLoadedPostCreatedAt: string | null;
  onLoadOlderPosts: (before: string) => void;
  loadOlderPostsPending: boolean;
}

export function NoodleHome(props: NoodleHomeProps) {
  const {
    activeNoodleView,
    isLoading,
    personaAccount,
    isGlobalPersonaSelected,
    settings,
    onOpenMobileDrawer,
    onBackToHome,
    postSearch,
    onPostSearchChange,
    rawPostSearch,
    normalizedPostSearch,
    isAccountSearch,
    accountSearchTerm,
    accountSearchResults,
    renderAccountRow,
    timelineTab,
    onTimelineTabChange,
    timelinePosts,
    baseTimelinePostsCount,
    postsCount,
    renderPostArticle,
    renderPostGrid,
    onOpenProfile,
    suggestedCharacters,
    followableCharacterAccountsCount,
    onUpdateFollowedAccount,
    updateAccountPending,
    renderPostComposer,
    onTriggerRefresh,
    refreshNoodlePending,
    imagePromptReviewItemsCount,
    notificationTab,
    onNotificationTabChange,
    notificationLikesCount,
    notificationFollowAccountsCount,
    notificationReplyItemsCount,
    renderLikeNotification,
    renderFollowNotification,
    renderReplyNotification,
    notificationLikes,
    notificationFollowAccounts,
    notificationReplyItems,
    hasOlderHistory,
    oldestLoadedPostCreatedAt,
    onLoadOlderPosts,
    loadOlderPostsPending,
  } = props;

  const mobileSearchContent = (
    <div className="min-h-full" data-component="NoodleHome.MobileSearch">
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 px-2 py-3 backdrop-blur">
        <MobileTimelineBackButton onClick={onBackToHome} />
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm ring-1 ring-inset ring-[var(--noodle-divider)] transition-colors focus-within:ring-[var(--noodle-blue)]">
          <Search size={18} className="shrink-0 text-[var(--noodle-blue)]" />
          <input
            type="search"
            value={postSearch}
            onChange={(event) => onPostSearchChange(event.target.value)}
            placeholder="Search posts or @users"
            aria-label="Search Noodle"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
          />
          {postSearch.trim() && (
            <button
              type="button"
              onClick={() => onPostSearchChange("")}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </label>
      </div>

      {rawPostSearch && (
        <section className="border-b border-[var(--noodle-divider)]" aria-labelledby="noodle-mobile-search-results">
          <div className="border-b border-[var(--noodle-divider)] px-4 py-3">
            <h2 id="noodle-mobile-search-results" className="text-lg font-bold">
              Search results
            </h2>
          </div>
          {isAccountSearch ? (
            accountSearchResults.length > 0 ? (
              <div>{accountSearchResults.map((account) => renderAccountRow(account, { showFollowButton: true }))}</div>
            ) : (
              <p className="px-4 py-6 text-sm text-[var(--muted-foreground)]">No accounts found.</p>
            )
          ) : timelinePosts.length > 0 ? (
            <div>{timelinePosts.map(renderPostArticle)}</div>
          ) : (
            <p className="px-4 py-6 text-sm text-[var(--muted-foreground)]">No posts found.</p>
          )}
        </section>
      )}

      <section aria-labelledby="noodle-mobile-who-to-follow">
        <div className="border-b border-[var(--noodle-divider)] px-4 py-3">
          <h2 id="noodle-mobile-who-to-follow" className="text-lg font-bold">
            Who to follow
          </h2>
        </div>
        {suggestedCharacters.length > 0 ? (
          <div className="divide-y divide-[var(--noodle-divider)]">
            {suggestedCharacters.map((character) => (
              <div key={character.accountId} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => onOpenProfile(character.account)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors hover:text-[var(--noodle-blue)]"
                >
                  <Avatar account={character.account} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{character.name}</span>
                    <span className="block truncate text-xs text-[var(--muted-foreground)]">@{character.handle}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateFollowedAccount(character.account, true)}
                  disabled={updateAccountPending}
                  className="h-8 rounded-full bg-[var(--foreground)] px-4 text-xs font-bold text-[var(--background)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Follow
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-sm text-[var(--muted-foreground)]">
            {followableCharacterAccountsCount > 0 ? "You're following everyone." : "No accounts to suggest yet."}
          </p>
        )}
      </section>
    </div>
  );

  if (activeNoodleView === "search") return mobileSearchContent;

  if (activeNoodleView === "notifications") {
    return (
      <div className="min-h-full">
        <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
          <div className="flex min-h-14 items-center gap-3 px-2 py-2 lg:px-4">
            <MobileTimelineBackButton label="Back to Noodle" onClick={onBackToHome} />
            <Bell size={22} className="hidden text-[var(--noodle-blue)] lg:block" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold">Notifications</h2>
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                {personaAccount ? `For @${personaAccount.handle}` : "Choose a persona to view notifications"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3">
            {NOTIFICATION_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNotificationTabChange(tab.id)}
                className={cn(
                  "relative flex h-12 items-center justify-center text-sm font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                  notificationTab === tab.id && "text-[var(--foreground)]",
                )}
              >
                {tab.label}
                {notificationTab === tab.id && (
                  <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
                )}
              </button>
            ))}
          </div>
        </div>

        {notificationTab === "likes" ? (
          notificationLikesCount > 0 ? (
            <div>{notificationLikes.map(renderLikeNotification)}</div>
          ) : (
            <div className="px-8 py-14 text-center">
              <Heart size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
              <p className="text-base font-bold">No likes yet.</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                Likes on your Noodle posts will show here.
              </p>
            </div>
          )
        ) : notificationTab === "follows" ? (
          notificationFollowAccountsCount > 0 ? (
            <div>{notificationFollowAccounts.map(renderFollowNotification)}</div>
          ) : (
            <div className="px-8 py-14 text-center">
              <Bell size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
              <p className="text-base font-bold">No follows yet.</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                New followers for this persona will show here.
              </p>
            </div>
          )
        ) : notificationReplyItemsCount > 0 ? (
          <div>{notificationReplyItems.map(renderReplyNotification)}</div>
        ) : (
          <div className="px-8 py-14 text-center">
            <MessageCircle size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
            <p className="text-base font-bold">No replies or mentions yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
              Replies to your posts and mentions of @{personaAccount?.handle ?? "your handle"} will show here.
            </p>
          </div>
        )}
      </div>
    );
  }

  // "home" (default)
  return (
    <>
      <div
        className="sticky top-0 z-30 grid h-14 grid-cols-[3rem_minmax(0,1fr)_3rem] items-center border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 px-3 backdrop-blur lg:hidden"
        data-component="NoodleHome.MobileHeader"
      >
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--accent)]"
          title="Open menu"
          aria-label="Open Noodle menu"
        >
          {isGlobalPersonaSelected ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 ring-1 ring-[var(--noodle-blue)]/25">
              <Globe2 size={18} className="text-[var(--noodle-blue)]" />
            </span>
          ) : personaAccount ? (
            <Avatar account={personaAccount} size="sm" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 ring-1 ring-[var(--noodle-blue)]/25">
              <AtSign size={18} className="text-[var(--noodle-blue)]" />
            </span>
          )}
        </button>
        <NoodleLogo className="mx-auto h-9 w-14" />
        <div aria-hidden="true" />
      </div>

      {isAccountSearch ? (
        <div className="sticky top-14 z-20 flex h-12 items-center gap-3 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 px-4 backdrop-blur lg:top-0">
          <AtSign size={19} className="text-[var(--noodle-blue)]" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold">Accounts</h2>
            <p className="truncate text-[0.68rem] text-[var(--muted-foreground)]">
              {accountSearchTerm ? `@${accountSearchTerm}` : "Type a handle after @"}
            </p>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "sticky top-14 z-20 grid border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur lg:top-0",
            isGlobalPersonaSelected ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {TIMELINE_TABS.filter((tab) => !isGlobalPersonaSelected || tab.id === "main").map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTimelineTabChange(tab.id)}
              className={cn(
                "relative flex h-12 items-center justify-center text-sm font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                timelineTab === tab.id && "text-[var(--foreground)]",
              )}
              aria-pressed={timelineTab === tab.id}
            >
              {tab.label}
              {timelineTab === tab.id && (
                <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
              )}
            </button>
          ))}
        </div>
      )}

      {!isAccountSearch && personaAccount && renderPostComposer(personaAccount, "noodle", true, "noodle-timeline")}

      {!isAccountSearch && (
        <RefreshTimelineButton
          onTriggerRefresh={onTriggerRefresh}
          refreshNoodlePending={refreshNoodlePending}
          disabled={!settings || imagePromptReviewItemsCount > 0}
        />
      )}

      {isLoading ? (
        <div className="space-y-0">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
              <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--muted)]" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="h-3 w-40 rounded bg-[var(--muted)]" />
                <div className="h-3 w-full rounded bg-[var(--muted)]" />
                <div className="h-3 w-2/3 rounded bg-[var(--muted)]" />
              </div>
            </div>
          ))}
        </div>
      ) : isAccountSearch ? (
        accountSearchResults.length > 0 ? (
          <div>{accountSearchResults.map((account) => renderAccountRow(account, { showFollowButton: true }))}</div>
        ) : (
          <div className="px-8 py-14 text-center">
            <AtSign size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
            <p className="text-base font-bold">No accounts found.</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
              Try searching by handle, like @mari.
            </p>
          </div>
        )
      ) : normalizedPostSearch && timelinePosts.length === 0 ? (
        <div className="px-8 py-14 text-center">
          <p className="text-base font-bold">No posts found.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
            Try a different search.
          </p>
        </div>
      ) : timelineTab === "following" && baseTimelinePostsCount === 0 ? (
        <div className="px-8 py-14 text-center">
          <AtSign size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
          <p className="text-base font-bold">Nothing from followed characters yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
            Follow characters from Who to follow, then refresh the timeline.
          </p>
        </div>
      ) : postsCount === 0 ? (
        <div className="px-8 py-14 text-center">
          <NoodleLogo className="mx-auto mb-5 h-16 w-24 opacity-95" />
          <p className="text-base font-bold">Your timeline is ready to fill.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
            Invite characters and choose a generation connection in Settings, then refresh the timeline.
          </p>
        </div>
      ) : settings?.layout === "grid" ? (
        renderPostGrid(timelinePosts)
      ) : (
        timelinePosts.map(renderPostArticle)
      )}
      {!normalizedPostSearch && hasOlderHistory && oldestLoadedPostCreatedAt && (
        <div className="flex justify-center border-t border-[var(--noodle-divider)] p-4">
          <button
            type="button"
            onClick={() => onLoadOlderPosts(oldestLoadedPostCreatedAt)}
            disabled={loadOlderPostsPending}
            className="h-9 rounded-full border border-[var(--noodle-divider)] px-4 text-xs font-bold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadOlderPostsPending ? "Loading…" : "Load older posts"}
          </button>
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────
// Public profile view with shared profile chrome, posting, and tabs.
// ──────────────────────────────────────────────
export interface PublicProfileViewProps {
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

  // Non-edit action: Follow
  canFollowViewedProfile: boolean;
  viewedProfileFollowed: boolean;
  onUpdateFollowedAccount: (account: NoodleAccount, followed: boolean) => void;

  // Extra action: Create/Open NoodleR (public accounts only)
  isNoodlerEnabled: boolean;
  // The "Create NoodleR" CTA is hidden on the viewer's own persona — that
  // flow now lives in NoodleR's own Profile tab sign-up screen instead.
  viewingOwnProfile: boolean;
  linkedNoodlerAccount: NoodleAccount | null;
  onOpenLinkedNoodler: (account: NoodleAccount) => void;
  onCreateNoodler: (account: NoodleAccount) => void;
  createPrivateAccountPending: boolean;

  // Tabs and grid
  profileTab: ProfileTab;
  onProfileTabChange: (tab: ProfileTab) => void;
  profileVisiblePosts: NoodlePost[];
  isGridLayout: boolean;
  renderPostGrid: (posts: NoodlePost[]) => ReactNode;
  renderPostArticle: (post: NoodlePost) => ReactNode;
  postingTools: ReactNode;
}

export function PublicProfileView(props: PublicProfileViewProps) {
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
    canFollowViewedProfile,
    viewedProfileFollowed,
    onUpdateFollowedAccount,
    isNoodlerEnabled,
    viewingOwnProfile,
    linkedNoodlerAccount,
    onOpenLinkedNoodler,
    onCreateNoodler,
    createPrivateAccountPending,
    profileTab,
    onProfileTabChange,
    profileVisiblePosts,
    isGridLayout,
    renderPostGrid,
    renderPostArticle,
    postingTools,
  } = props;

  const canShowNoodlerCta =
    isNoodlerEnabled &&
    Boolean(viewedProfileAccount) &&
    (viewedProfileAccount?.kind === "persona" || viewedProfileAccount?.kind === "character");

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
          canFollowViewedProfile && viewedProfileAccount ? (
            <button
              type="button"
              onClick={() => onUpdateFollowedAccount(viewedProfileAccount, !viewedProfileFollowed)}
              disabled={updateAccountPending}
              className={cn(
                "mb-1 h-9 rounded-full px-5 text-xs font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                viewedProfileFollowed
                  ? "border border-[var(--noodle-divider)] text-[var(--foreground)]"
                  : "bg-[var(--foreground)] text-[var(--background)]",
              )}
            >
              {viewedProfileFollowed ? "Following" : "Follow"}
            </button>
          ) : null
        }
        extraActionButtons={
          canShowNoodlerCta && viewedProfileAccount ? (
            linkedNoodlerAccount ? (
              <button
                type="button"
                onClick={() => onOpenLinkedNoodler(linkedNoodlerAccount)}
                className="mb-1 h-9 rounded-full border border-[var(--noodle-divider)] px-5 text-xs font-bold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
                title="Open this account's NoodleR profile"
              >
                Open NoodleR
              </button>
            ) : viewingOwnProfile && viewedProfileAccount.kind === "persona" ? null : (
              <button
                type="button"
                onClick={() => onCreateNoodler(viewedProfileAccount)}
                disabled={createPrivateAccountPending}
                className="mb-1 h-9 rounded-full border border-[var(--noodle-divider)] px-5 text-xs font-bold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                title="Create a NoodleR profile linked to this account"
              >
                {createPrivateAccountPending ? "Creating…" : "Create NoodleR"}
              </button>
            )
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
        badge={isNoodlerEnabled && Boolean(viewedProfileAccount?.linkedAccountId) ? <NoodlerBadge /> : undefined}
        profileBioPreview={profileBioPreview}
        noodleCustomEmojiMap={noodleCustomEmojiMap}
        emojiKeyPrefix={`noodle-profile-bio-${viewedProfileAccount?.id ?? "preview"}`}
        profileLocationPreview={profileLocationPreview}
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
