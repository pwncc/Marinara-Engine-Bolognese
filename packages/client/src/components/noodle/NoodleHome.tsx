// ──────────────────────────────────────────────
// Noodle: public feed (home timeline, search, notifications).
// Mechanical extraction from NoodleView.tsx (Phase 5 of
// MARI_NOODLER_SEPARATION_TASK.md) — this component is purely
// presentational. All state, data fetching, and mutation handlers
// still live in the NoodleView shell and are passed down as props.
// ──────────────────────────────────────────────
import {
  AtSign,
  Bell,
  Heart,
  ImageIcon,
  ListChecks,
  Loader2,
  Menu,
  MessageCircle,
  RefreshCw,
  Search,
  Smile,
  X,
} from "lucide-react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import type { NoodleAccount, NoodlePost, NoodleSettings } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import type { AvatarCropValue } from "../../lib/utils";
import {
  Avatar,
  MobileTimelineBackButton,
  NoodleLogo,
  NoodlerBadge,
  NoodleToolButton,
  ProfileHeaderChrome,
  ProfileTabsAndGrid,
  type ActiveComposerMention,
  type ComposerTool,
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

  // Inline composer
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
  composerAccess: string;
  onComposerAccessChange: (access: "public" | "subscriber" | "ppv") => void;
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
    composerAccess,
    onComposerAccessChange,
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
            {followableCharacterAccountsCount > 0 ? "You're following everyone!" : "No one's cooking yet…"}
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
                {personaAccount ? `Public social timeline · @${personaAccount.handle}` : "Choose a persona account"}
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
                Accounts following you will show here.
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
              Replies to your posts and @{personaAccount?.handle ?? "mentions"} will show here.
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
          <Menu size={22} />
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
        <div className="sticky top-14 z-20 grid grid-cols-2 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur lg:top-0">
          {TIMELINE_TABS.map((tab) => (
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

      {!isAccountSearch && !composeOpen && (
        <div className="border-b border-[var(--noodle-divider)] px-4 py-3" data-component="NoodleHome.InlineComposer">
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
            {personaAccount ? <Avatar account={personaAccount} /> : <AtSign size={28} className="text-[var(--noodle-blue)]" />}
            <div className="min-w-0">
              <textarea
                ref={inlineComposerRef}
                defaultValue={composer}
                onChange={onComposerChange}
                onBlur={onComposerBlur}
                onKeyDown={onComposerKeyDown}
                disabled={!personaAccount}
                placeholder={composePlaceholder}
                aria-autocomplete="list"
                aria-controls={activeMention && !composeOpen ? "noodle-inline-mention-list" : undefined}
                aria-expanded={Boolean(activeMention && !composeOpen)}
                aria-activedescendant={
                  activeMention && !composeOpen && mentionSuggestionsCount > 0
                    ? `noodle-inline-mention-list-option-${Math.min(activeMentionIndex, mentionSuggestionsCount - 1)}`
                    : undefined
                }
                className="min-h-20 w-full resize-none border-0 bg-transparent py-2 text-[1rem] leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:opacity-60"
              />
              {!composeOpen && renderComposerMentionSuggestions("noodle-inline-mention-list")}
              {renderDraftPoll()}
              {attachedImageUrl && (
                <div className="mb-3 overflow-hidden rounded-xl border border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/10">
                  <img src={attachedImageUrl} alt="" className="max-h-52 w-full object-cover" />
                  <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-[var(--noodle-blue)]">
                    <span className="min-w-0 truncate">Attached image</span>
                    <button
                      type="button"
                      onClick={() => onAttachedImageUrlChange("")}
                      className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--noodle-blue)]/15"
                      title="Remove image"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 border-t border-[var(--noodle-divider)] px-3 py-2">
                    <span className="text-[0.7rem] font-semibold text-[var(--muted-foreground)]">Access</span>
                    <select
                      value={composerAccess}
                      onChange={(event) => onComposerAccessChange(event.target.value as "public" | "subscriber" | "ppv")}
                      className="h-7 rounded-full border border-[var(--noodle-divider)] bg-[var(--background)] px-2 text-xs"
                    >
                      <option value="public">Public</option>
                      <option value="subscriber">Subscribers only</option>
                      <option value="ppv">Pay-per-post</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="mt-1 h-px w-full bg-[var(--noodle-divider)]" />
          <div className="relative mt-3 flex items-center justify-between gap-2 pl-14">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <div ref={imageToolRef} className="relative">
                <NoodleToolButton
                  title="Attach image"
                  active={activeComposerTool === "image"}
                  onClick={() => onActiveComposerToolChange(activeComposerTool === "image" ? null : "image")}
                >
                  <ImageIcon size={18} />
                </NoodleToolButton>
              </div>
              <div ref={pollToolRef} className="relative">
                <NoodleToolButton
                  title={draftPollActive ? "Edit poll" : "Create poll"}
                  active={activeComposerTool === "poll" || draftPollActive}
                  onClick={onTogglePollComposer}
                >
                  <ListChecks size={18} />
                </NoodleToolButton>
              </div>
              <div ref={mediaToolRef} className="relative">
                <NoodleToolButton
                  title="Emoji, GIFs and stickers"
                  active={activeComposerTool === "media"}
                  onClick={() => onActiveComposerToolChange(activeComposerTool === "media" ? null : "media")}
                >
                  <Smile size={18} />
                </NoodleToolButton>
              </div>
            </div>
            <button
              type="button"
              onClick={onSubmitPost}
              disabled={!canSubmitPost || createPostPending}
              className="h-8 rounded-full bg-[var(--noodle-blue)] px-5 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {composeActionLabel}
            </button>
            {!composeOpen && renderComposerToolPopovers({ imageRef: imageToolRef, pollRef: pollToolRef, mediaRef: mediaToolRef })}
          </div>
        </div>
      )}

      {!isAccountSearch && (
        <div className="border-b border-[var(--noodle-divider)] px-4 py-2">
          <button
            type="button"
            onClick={onTriggerRefresh}
            disabled={refreshNoodlePending || !settings || imagePromptReviewItemsCount > 0}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-full text-sm font-bold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            title="Refresh timeline"
            aria-label="Refresh timeline"
          >
            {refreshNoodlePending ? (
              <Loader2 size={17} className="!text-[var(--noodle-blue)] animate-spin" />
            ) : (
              <RefreshCw size={17} className="!text-[var(--noodle-blue)]" />
            )}
            {refreshNoodlePending ? "Refreshing" : "Refresh timeline"}
          </button>
        </div>
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
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">Try a different search.</p>
        </div>
      ) : timelineTab === "following" && baseTimelinePostsCount === 0 ? (
        <div className="px-8 py-14 text-center">
          <AtSign size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
          <p className="text-base font-bold">Nothing from followed characters yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
            Follow characters from the suggestions panel, then refresh Noodle.
          </p>
        </div>
      ) : postsCount === 0 ? (
        <div className="px-8 py-14 text-center">
          <NoodleLogo className="mx-auto mb-5 h-16 w-24 opacity-95" />
          <p className="text-base font-bold">The plate is empty.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
            Go to the Settings on the left first, invite characters, pick a generation connection, then refresh.
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
// Public profile view (activeNoodleMode === "noodle"). Renders the
// shared ProfileHeaderChrome with the public-mode action row (Edit
// Profile / Follow, plus Create/Open NoodleR when applicable) and
// the public post grid. Private-only panels (creator tools,
// subscribe, fan activity) live in NoodlerHome's PrivateProfileView
// instead — see MARI_NOODLER_SEPARATION_TASK.md Phase 5/6.
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
                title="View private NoodleR account"
              >
                Open NoodleR
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onCreateNoodler(viewedProfileAccount)}
                disabled={createPrivateAccountPending}
                className="mb-1 h-9 rounded-full border border-[var(--noodle-divider)] px-5 text-xs font-bold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                title="Create a private NoodleR account linked to this profile"
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
