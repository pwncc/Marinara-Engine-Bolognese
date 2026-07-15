// ──────────────────────────────────────────────
// Noodle: fake social media timeline
// ──────────────────────────────────────────────
import {
  AtSign,
  AlertTriangle,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Dices,
  FolderOpen,
  Globe2,
  Heart,
  Home,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Repeat2,
  Search,
  Settings2,
  Smile,
  Trash2,
  X,
  User,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type RefObject,
} from "react";
import { toast } from "sonner";
import {
  canManageNoodleReply,
  findNoodleTextMentions,
  noodleTextMentionsHandle as textMentionsHandle,
  PROFESSOR_MARI_ID,
  readNoodlePollFromMetadata,
  type APIConnection,
  type NoodleAccount,
  type NoodleCarryoverTarget,
  type NoodleInteraction,
  type NoodleInteractionType,
  type NoodlePost,
  type NoodlePostAccess,
  type NoodlePoll,
  type NoodlePollInput,
  type NoodlePostingMode,
  type NoodlePrivateIdentityDisclosure,
  type NoodlePrivateStageProfileInput,
  type NoodleRefreshSchedulerStatus,
  type NoodleSettingsUpdateInput,
} from "@marinara-engine/shared";
import { cn, parseAvatarCropJson, type AvatarCropValue } from "../../lib/utils";
import { useActivePersona, useCharacterGroups, useCharacters, usePersonas } from "../../hooks/use-characters";
import { useConnections } from "../../hooks/use-connections";
import { useNoodleCustomEmojiMap } from "../../hooks/use-noodle-custom-emojis";
import { useUploadGlobalGalleryImages } from "../../hooks/use-global-gallery";
import type { ChatImage } from "../../hooks/use-gallery";
import { HelpTooltip } from "../ui/HelpTooltip";
import {
  ConversationMediaPickerPanel,
  type ConversationMediaPickerTab,
  type ConversationMediaPickerTabId,
} from "../chat/ConversationMediaPickerPanel";
import { ChatImageLightbox } from "../chat/ChatImageLightbox";
import { Modal } from "../ui/Modal";
import {
  ImagePromptReviewModal,
  type ImagePromptOverride,
  type ImagePromptReviewItem,
} from "../ui/ImagePromptReviewModal";
import {
  useConfirmNoodleImagePrompts,
  useClearNoodleInvites,
  useCreateNoodleInteraction,
  useCreateNoodlePost,
  useDeleteNoodleInteraction,
  useDeleteNoodlePost,
  useInviteNoodleCharacter,
  useInviteNoodleCharacters,
  useLoadOlderNoodlePosts,
  useNoodle,
  useRefreshNoodle,
  useRemoveNoodleCharacter,
  useRemoveNoodleInteraction,
  useCreateNoodleFillerProfile,
  useDeleteNoodleFillerProfile,
  useNoodleFillerProfiles,
  useUpdateNoodleFillerProfile,
  useRescheduleNoodleRefresh,
  useResetNoodleTimeline,
  useUpdateNoodleAccount,
  useUpdateNoodleInteraction,
  useUpdateNoodlePost,
  useUpdateNoodleSettings,
} from "../../hooks/use-noodle";
import {
  useCreatePrivateNoodleAccount,
  useDeletePrivateNoodleAccount,
  useNoodlerHub,
  useRetryPrivateIdentityGeneration,
  useSimulateNoodlerFanActivity,
  useSubscribeNoodleAccount,
  useUnlockNoodlePost,
  useUnsubscribeNoodleAccount,
} from "../../hooks/use-noodler";
import { useUIStore } from "../../stores/ui.store";
import { useTrackAchievement } from "../../hooks/use-achievements";
import { NoodleHome, type NoodleHomeProps } from "./NoodleHome";
import type { NoodlerHomeProps } from "./NoodlerHome";
import {
  Avatar,
  BrowserChrome,
  MobileTimelineBackButton,
  NoodleAnchoredPopover,
  NoodleLogo,
  NoodleModeSwitcher,
  NoodleToolButton,
  NoodleToolPopover,
  NoodlerBadge,
  NoodlerLogo,
  NoodlerPrivateBadge,
  fieldClass,
  iconButtonClass,
  labelClass,
  textareaClass,
  NOODLE_BLUE,
  NOODLE_GLOBAL_PERSONA_ID,
  NOODLER_BLUE,
  NOODLE_ICON_SCOPE_CLASS,
  NOODLE_MODE_META,
  countInteractions,
  createNoodleLightboxImage,
  formatTime,
  subscribeLabel,
  unlockLabel,
  parseRecord,
  readString,
  readPrivateStageSetting,
  readPrivateIdentityDisclosure,
  readPrivatePostingMode,
  readFanActivityEnabled,
  type PrivateStageDraft,
  readFanActivityIntensity,
  readFanActivityAutoSchedule,
  fanActivitySettingsFromAccount,
  type ActiveComposerMention,
  type ComposerTool,
  type NoodleMode,
  type NoodleNotificationFocusTarget,
  type NoodlerHubTab,
  type NoodlerTimelineItem,
  type NoodleViewId,
  type NotificationTab,
  type ProfileConnectionTab,
  type ProfileTab,
  type ReplyComposerTool,
  type TimelineTab,
} from "./noodle-shared";
import { PublicProfileView, type PublicProfileViewProps } from "./NoodleHome";
import type { PrivateProfileViewProps } from "./NoodlerHome";

const NoodlerHome = lazy(() => import("./NoodlerHome").then((module) => ({ default: module.NoodlerHome })));

type RawCharacter = { id?: unknown; data?: unknown; avatarPath?: unknown };
type RawCharacterGroup = { id?: unknown; name?: unknown; description?: unknown; characterIds?: unknown };
type RawPersona = { id?: unknown; createdAt?: unknown; updatedAt?: unknown };

const NOODLE_NOTIFICATIONS_READ_AT_KEY = "notificationsReadAt";
const NOODLER_NOTIFICATIONS_READ_AT_KEY = "noodlerNotificationsReadAt";
const NOODLE_FOLLOWED_AT_BY_ACCOUNT_KEY = "followingAccountTimestamps";
const NOODLER_LAST_VIEWED_AT_KEY = "noodlerLastViewedAt";
const NOODLE_INVITE_PAGE_SIZE = 50;
const NOODLE_PERSONA_SWITCHER_PAGE_SIZE = 5;
const NOODLE_MENTION_SUGGESTION_LIMIT = 8;
const NOODLE_CARRYOVER_TARGETS: NoodleCarryoverTarget[] = ["conversation", "roleplay", "game"];
const NOODLE_MEDIA_PICKER_TABS: ConversationMediaPickerTab[] = [
  { id: "emoji", label: "Emoji" },
  { id: "gifs", label: "GIFs" },
  { id: "stickers", label: "Stickers" },
];

type NoodlePrivatePostAccess = NoodlePostAccess;
type NoodleConfirmAction =
  | {
      kind: "delete-post";
      postId: string;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "reset-timeline";
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "uninvite-everybody";
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "delete-reply";
      postId: string;
      interactionId: string;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "delete-noodler-profile";
      accountId: string;
      title: string;
      message: string;
      confirmLabel: string;
    };

const PROFILE_CONNECTION_TABS: Array<{ id: ProfileConnectionTab; label: string }> = [
  { id: "followers", label: "Followers" },
  { id: "following", label: "Following" },
];

function readStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

function carryoverTargetsFromLegacy(mode: string | undefined): NoodleCarryoverTarget[] {
  if (mode === "all") return [...NOODLE_CARRYOVER_TARGETS];
  if (mode === "conversation" || mode === "roleplay" || mode === "game") return [mode];
  return [];
}

function legacyCarryoverModeFromTargets(targets: NoodleCarryoverTarget[]): NoodleSettingsUpdateInput["carryoverMode"] {
  const selected = new Set(targets);
  if (NOODLE_CARRYOVER_TARGETS.every((target) => selected.has(target))) return "all";
  if (targets.length === 1) return targets[0]!;
  return "off";
}

function readAccountSetting(account: NoodleAccount | null, key: string) {
  return readString(account?.settings?.[key]).trim();
}

function readAccountSettingBoolean(account: NoodleAccount | null, key: string) {
  const value = account?.settings?.[key];
  return value === true || value === "true";
}

function readNoodlerLastViewedAt(account: NoodleAccount | null | undefined) {
  return readString(account?.settings?.[NOODLER_LAST_VIEWED_AT_KEY]);
}

function hasGeneratedProfile(account: NoodleAccount | null) {
  return readAccountSettingBoolean(account, "profileGenerated");
}

function sortAccountsByDisplayName(left: NoodleAccount, right: NoodleAccount) {
  return left.displayName.localeCompare(right.displayName) || left.handle.localeCompare(right.handle);
}

function accountTimestamp(account: NoodleAccount) {
  return Date.parse(account.updatedAt || account.createdAt) || 0;
}

function uniqueAccountsById(accounts: Array<NoodleAccount | null | undefined>) {
  const seen = new Set<string>();
  const result: NoodleAccount[] = [];
  for (const account of accounts) {
    if (!account || seen.has(account.id)) continue;
    seen.add(account.id);
    result.push(account);
  }
  return result;
}

function extractAccountSearchTerm(query: string) {
  const match = query.match(/@([a-zA-Z0-9_.-]*)/);
  return match ? match[1]!.toLowerCase() : "";
}

function accountMatchesSearch(account: NoodleAccount, term: string) {
  if (!term) return true;
  return [account.handle, account.displayName, account.bio].some((value) => value.toLowerCase().includes(term));
}

function activeComposerMention(value: string, caret: number): ActiveComposerMention | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]*)$/u.exec(beforeCaret);
  if (!match) return null;
  const query = match[2] ?? "";
  const start = caret - query.length - 1;
  return { handle: query.toLowerCase(), query: query.toLowerCase(), start, end: caret };
}

function matchingMentionAccounts(accounts: NoodleAccount[], activeMention: ActiveComposerMention | null) {
  if (!activeMention) return [];
  return accounts
    .filter((account) => account.handle.toLowerCase().startsWith(activeMention.query))
    .sort((left, right) => left.handle.localeCompare(right.handle))
    .slice(0, NOODLE_MENTION_SUGGESTION_LIMIT);
}

function characterName(character: RawCharacter) {
  const data = parseRecord(character.data);
  return readString(data.name).trim() || "Character";
}

function rawCharacterAvatarCrop(character: RawCharacter): AvatarCropValue | null {
  const raw = parseRecord(parseRecord(character.data).extensions).avatarCrop;
  if (typeof raw === "string") return parseAvatarCropJson(raw);
  try {
    return raw ? parseAvatarCropJson(JSON.stringify(raw)) : null;
  } catch {
    return null;
  }
}

function characterGroupName(group: RawCharacterGroup) {
  return readString(group.name).trim() || "Character folder";
}

function formatNoodleRefreshTime(value: string | null, timezone?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      ...(timezone && timezone !== "local" ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
}

function formatNoodleRefreshTimeInput(value: string, timezone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(timezone && timezone !== "local" ? { timeZone: timezone } : {}),
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    return hour && minute ? `${hour}:${minute}` : "";
  } catch {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
}

function noodleSchedulerSummary(scheduler: NoodleRefreshSchedulerStatus) {
  if (scheduler.state === "disabled") return "Automatic refreshes are off.";
  if (scheduler.state === "completed") return "Today's automatic refreshes are complete.";
  if (scheduler.state === "retrying") {
    const retryTime = formatNoodleRefreshTime(scheduler.nextAttemptAt, scheduler.timezone);
    return retryTime ? `Waiting to retry at ${retryTime}.` : "Waiting to retry.";
  }
  if (scheduler.state === "due") return "An automatic refresh is due now.";
  const nextTime = formatNoodleRefreshTime(scheduler.nextRefreshAt, scheduler.timezone);
  return nextTime ? `Next automatic refresh at ${nextTime}.` : "Automatic refresh is scheduled.";
}

function insertAtSelection(value: string, insertion: string, start: number, end: number) {
  const boundedStart = Math.max(0, Math.min(start, value.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, value.length));
  return {
    value: value.slice(0, boundedStart) + insertion + value.slice(boundedEnd),
    caret: boundedStart + insertion.length,
  };
}

function NoodleMentionSuggestions({
  activeMention,
  activeIndex,
  accounts,
  listboxId,
  onSelect,
}: {
  activeMention: ActiveComposerMention | null;
  activeIndex: number;
  accounts: NoodleAccount[];
  listboxId: string;
  onSelect: (account: NoodleAccount) => void;
}) {
  if (!activeMention) return null;
  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label="Tag a character"
      className="relative z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-[var(--noodle-divider)] bg-[var(--background)] p-1 shadow-xl shadow-black/25"
    >
      {accounts.length > 0 ? (
        accounts.map((account, index) => (
          <button
            key={account.id}
            id={`${listboxId}-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onSelect(account)}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors",
              index === activeIndex ? "bg-[var(--noodle-blue)]/15" : "hover:bg-[var(--noodle-blue)]/10",
            )}
          >
            <Avatar account={account} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{account.displayName}</span>
              <span className="block truncate text-[0.68rem] text-[var(--noodle-blue)]">@{account.handle}</span>
            </span>
          </button>
        ))
      ) : (
        <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
          No invited character matches @{activeMention.query}.
        </p>
      )}
    </div>
  );
}

function NoodlePostContent({
  content,
  accountByHandle,
  onOpenProfile,
}: {
  content: string;
  accountByHandle: Map<string, NoodleAccount>;
  onOpenProfile: (account: NoodleAccount) => void;
}) {
  const mentions = findNoodleTextMentions(content);
  if (mentions.length === 0) {
    return <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{content}</p>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start > cursor) parts.push(content.slice(cursor, mention.start));
    const label = content.slice(mention.start, mention.end);
    const account = accountByHandle.get(mention.handle);
    parts.push(
      account ? (
        <button
          key={`${mention.start}:${mention.handle}`}
          type="button"
          onClick={() => onOpenProfile(account)}
          className="inline font-semibold text-[var(--noodle-blue)] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--noodle-blue)]/70"
          aria-label={`View @${account.handle} profile`}
        >
          {label}
        </button>
      ) : (
        label
      ),
    );
    cursor = mention.end;
  }
  if (cursor < content.length) parts.push(content.slice(cursor));
  return <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{parts}</p>;
}

function NoodlePollCard({
  poll,
  votes,
  accountById,
  selectedOptionId,
  disabled,
  pending,
  onVote,
  onOpenProfile,
}: {
  poll: NoodlePoll;
  votes: NoodleInteraction[];
  accountById: Map<string, NoodleAccount>;
  selectedOptionId: string | null;
  disabled: boolean;
  pending: boolean;
  onVote: (optionId: string) => void;
  onOpenProfile: (account: NoodleAccount) => void;
}) {
  const totalVotes = votes.length;
  const [showVoters, setShowVoters] = useState(false);
  return (
    <section className="mt-3" aria-label={`Poll: ${poll.question}`} data-noodle-poll>
      <h3 className="text-sm font-bold leading-5">{poll.question}</h3>
      <div className="mt-2 space-y-2">
        {poll.options.map((option) => {
          const matchingVotes = votes.filter((vote) => vote.content === option.id);
          const optionVotes = matchingVotes.length;
          const percentage = totalVotes > 0 ? Math.round((optionVotes / totalVotes) * 100) : 0;
          const selected = selectedOptionId === option.id;
          return (
            <Fragment key={option.id}>
              <button
              type="button"
              onClick={() => onVote(option.id)}
              disabled={disabled || pending}
              aria-pressed={selected}
              aria-label={`${option.label}, ${optionVotes} ${optionVotes === 1 ? "vote" : "votes"}, ${percentage}%`}
              className={cn(
                "relative flex min-h-10 w-full items-center overflow-hidden rounded-lg border px-3 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--noodle-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed",
                selected
                  ? "border-[var(--noodle-blue)] bg-[var(--noodle-blue)]/10"
                  : "border-[var(--noodle-divider)] hover:border-[var(--noodle-blue)]/55 hover:bg-[var(--noodle-blue)]/5",
              )}
              data-noodle-poll-option={option.id}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 origin-left bg-[var(--noodle-blue)]/15 transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${percentage / 100})` }}
              />
              <span className="relative flex min-w-0 flex-1 items-center gap-2">
                {selected && <Check size={14} className="shrink-0 text-[var(--noodle-blue)]" />}
                <span className="min-w-0 flex-1 break-words">{option.label}</span>
                <span className="shrink-0 text-[var(--muted-foreground)]">{percentage}%</span>
              </span>
              </button>
              {showVoters && optionVotes > 0 && (
                <div className="flex flex-wrap gap-1 px-1" aria-label={`Voters for ${option.label}`}>
                  {matchingVotes.map((vote) => {
                    const voterAccount = accountById.get(vote.actorAccountId) ?? null;
                    const voter = voterAccount ?? vote.actorSnapshot;
                    return voter ? (
                      <button
                        key={vote.id}
                        type="button"
                        onClick={() => {
                          if (voterAccount) onOpenProfile(voterAccount);
                        }}
                        disabled={!voterAccount}
                        className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-[var(--noodle-blue)]/8 pr-2 text-[0.6875rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--noodle-blue)]/15 hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--noodle-blue)]/70 disabled:cursor-default"
                      >
                        <Avatar account={voter} size="sm" />
                        <span className="max-w-32 truncate">@{voter.handle}</span>
                      </button>
                    ) : null;
                  })}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setShowVoters((visible) => !visible)}
        aria-expanded={showVoters}
        className="mt-2 rounded-sm text-[0.68rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--noodle-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--noodle-blue)]/70"
      >
        {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
        {selectedOptionId ? " · You voted" : ""}
        {pending ? " · Saving…" : ""}
        {totalVotes > 0 ? (showVoters ? " · Hide voters" : " · View voters") : ""}
      </button>
    </section>
  );
}

function FieldLabel({ children, help }: { children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <span className={cn(labelClass, "inline-flex items-center gap-1")}>
      {children}
      {help && <HelpTooltip text={help} side="top" wide />}
    </span>
  );
}

function Section({ title, help, children }: { title: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--noodle-divider)] p-4 last:border-b-0">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
        <Settings2 size={13} className="text-[var(--noodle-blue)]" />
        {title}
        {help && <HelpTooltip text={help} side="bottom" wide />}
      </h3>
      {children}
    </section>
  );
}

function ToggleSetting({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-3 py-2 text-xs">
      <span className="inline-flex min-w-0 items-center gap-1 font-semibold">
        {label}
        {help && <HelpTooltip text={help} side="top" wide />}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function NoodleView() {
  const selectedPersonaId = useUIStore((state) => state.noodleSelectedPersonaId) ?? "";
  const setSelectedPersonaId = useUIStore((state) => state.setNoodleSelectedPersonaId);
  const { data, isLoading } = useNoodle();
  const { data: activePersona } = useActivePersona();
  const { data: personasRaw } = usePersonas();
  const { data: charactersRaw } = useCharacters();
  const { data: characterGroupsRaw } = useCharacterGroups();
  const { data: connectionsRaw } = useConnections();
  const updateSettings = useUpdateNoodleSettings();
  const updateAccount = useUpdateNoodleAccount();
  const inviteCharacter = useInviteNoodleCharacter();
  const inviteCharacters = useInviteNoodleCharacters();
  const clearInvites = useClearNoodleInvites();
  const removeCharacter = useRemoveNoodleCharacter();
  const createPost = useCreateNoodlePost();
  const updatePost = useUpdateNoodlePost();
  const deletePost = useDeleteNoodlePost();
  const createInteraction = useCreateNoodleInteraction();
  const removeInteraction = useRemoveNoodleInteraction();
  const updateInteraction = useUpdateNoodleInteraction();
  const deleteInteraction = useDeleteNoodleInteraction();
  const rescheduleRefresh = useRescheduleNoodleRefresh();
  const refreshNoodle = useRefreshNoodle();
  const confirmNoodleImagePrompts = useConfirmNoodleImagePrompts();
  const resetNoodleTimeline = useResetNoodleTimeline();
  const createPrivateAccount = useCreatePrivateNoodleAccount();
  const deletePrivateAccount = useDeletePrivateNoodleAccount();
  const retryPrivateIdentity = useRetryPrivateIdentityGeneration();
  const simulateFanActivity = useSimulateNoodlerFanActivity();
  const loadOlderPosts = useLoadOlderNoodlePosts();
  const [fillerAccountsExpanded, setFillerAccountsExpanded] = useState(false);
  const [newFillerAccountName, setNewFillerAccountName] = useState("");
  const fillerProfilesQuery = useNoodleFillerProfiles(fillerAccountsExpanded);
  const fillerProfiles = fillerProfilesQuery.data ?? [];
  const createFillerProfile = useCreateNoodleFillerProfile();
  const updateFillerProfile = useUpdateNoodleFillerProfile();
  const deleteFillerProfile = useDeleteNoodleFillerProfile();
  const subscribeAccount = useSubscribeNoodleAccount();
  const unsubscribeAccount = useUnsubscribeNoodleAccount();
  const unlockPost = useUnlockNoodlePost();
  const uploadGlobalImages = useUploadGlobalGalleryImages();
  const trackAchievement = useTrackAchievement();
  const prefersReducedMotion = useReducedMotion();
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const inlineComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const modalComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const replyComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerValueRef = useRef("");
  const composerHasTextRef = useRef(false);
  const replyValueRef = useRef("");
  const replyHasTextRef = useRef(false);
  const replyImageFileRef = useRef<HTMLInputElement | null>(null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const bannerFileRef = useRef<HTMLInputElement | null>(null);
  const imageToolRef = useRef<HTMLDivElement | null>(null);
  const pollToolRef = useRef<HTMLDivElement | null>(null);
  const mediaToolRef = useRef<HTMLDivElement | null>(null);
  const modalImageToolRef = useRef<HTMLDivElement | null>(null);
  const modalPollToolRef = useRef<HTMLDivElement | null>(null);
  const modalMediaToolRef = useRef<HTMLDivElement | null>(null);
  const replyImageToolRef = useRef<HTMLDivElement | null>(null);
  const replyMediaToolRef = useRef<HTMLDivElement | null>(null);
  const accountSwitcherRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLElement | null>(null);

  const characters = useMemo(
    () => (Array.isArray(charactersRaw) ? (charactersRaw as RawCharacter[]) : []),
    [charactersRaw],
  );
  const personas = useMemo(() => (Array.isArray(personasRaw) ? (personasRaw as RawPersona[]) : null), [personasRaw]);
  const characterGroups = useMemo(
    () => (Array.isArray(characterGroupsRaw) ? (characterGroupsRaw as RawCharacterGroup[]) : []),
    [characterGroupsRaw],
  );
  const allConnections = useMemo(
    () => (Array.isArray(connectionsRaw) ? (connectionsRaw as Partial<APIConnection>[]) : []),
    [connectionsRaw],
  );
  const connections = useMemo(
    () =>
      allConnections.filter(
        (connection) => connection.provider !== "image_generation" && connection.provider !== "video_generation",
      ),
    [allConnections],
  );
  const imageConnections = useMemo(
    () => allConnections.filter((connection) => connection.provider === "image_generation"),
    [allConnections],
  );

  const [composer, setComposer] = useState("");
  const [composerHasText, setComposerHasText] = useState(false);
  const [activeMention, setActiveMention] = useState<ActiveComposerMention | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [postSearch, setPostSearch] = useState("");
  const [profileHandle, setProfileHandle] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileBannerUrl, setProfileBannerUrl] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileUploadTarget, setProfileUploadTarget] = useState<"avatar" | "banner" | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileTab>("posts");
  const [profileConnectionTab, setProfileConnectionTab] = useState<ProfileConnectionTab | null>(null);
  const [notificationTab, setNotificationTab] = useState<NotificationTab>("likes");
  const [noodlerNotificationTab, setNoodlerNotificationTab] = useState<"subscribers" | "unlocks" | "activity">(
    "subscribers",
  );
  const [activeNoodleView, setActiveNoodleView] = useState<NoodleViewId>("home");
  // Explicit source of truth for chrome selection — set only by
  // transitionNoodleMode/openProfile/openOwnProfile, never derived from
  // account data, so no render path can accidentally infer NoodleR chrome.
  const [activeNoodleMode, setActiveNoodleMode] = useState<NoodleMode>("noodle");
  const [viewedProfileAccountId, setViewedProfileAccountId] = useState<string | null>(null);
  const [timelineTab, setTimelineTab] = useState<TimelineTab>("main");
  const [noodlerHubTab, setNoodlerHubTab] = useState<NoodlerHubTab>("timeline");
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteFoldersOpen, setInviteFoldersOpen] = useState(false);
  const [inviteCharacterLimit, setInviteCharacterLimit] = useState(NOODLE_INVITE_PAGE_SIZE);
  const [replyPostId, setReplyPostId] = useState<string | null>(null);
  const [replyParentInteractionId, setReplyParentInteractionId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyHasText, setReplyHasText] = useState(false);
  const [activeReplyMention, setActiveReplyMention] = useState<ActiveComposerMention | null>(null);
  const [activeReplyMentionIndex, setActiveReplyMentionIndex] = useState(0);
  const [replyImageUrl, setReplyImageUrl] = useState("");
  const [replyImageUrlDraft, setReplyImageUrlDraft] = useState("");
  const [activeReplyComposerTool, setActiveReplyComposerTool] = useState<ReplyComposerTool | null>(null);
  const [imageLightbox, setImageLightbox] = useState<ChatImage | null>(null);
  const [notificationFocusTarget, setNotificationFocusTarget] = useState<NoodleNotificationFocusTarget | null>(null);
  const [highlightedInteractionId, setHighlightedInteractionId] = useState<string | null>(null);
  const [notificationReadOverrides, setNotificationReadOverrides] = useState<Record<string, string>>({});
  const [editingRefreshTime, setEditingRefreshTime] = useState<string | null>(null);
  const [refreshTimeDraft, setRefreshTimeDraft] = useState("");
  const [imagePromptReviewItems, setImagePromptReviewItems] = useState<ImagePromptReviewItem[]>([]);
  const [postMenuId, setPostMenuId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState("");
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editingReplyContent, setEditingReplyContent] = useState("");
  const [confirmAction, setConfirmAction] = useState<NoodleConfirmAction | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileAccountSwitcherOpen, setMobileAccountSwitcherOpen] = useState(false);
  const [personaAccountLimit, setPersonaAccountLimit] = useState(NOODLE_PERSONA_SWITCHER_PAGE_SIZE);
  const [activeComposerTool, setActiveComposerTool] = useState<ComposerTool | null>(null);
  const [mediaPickerTab, setMediaPickerTab] = useState<ConversationMediaPickerTabId>("emoji");
  const [attachedImageUrl, setAttachedImageUrl] = useState("");
  const [composerAccess, setComposerAccess] = useState<NoodlePostAccess>("public");
  const [privateComposerText, setPrivateComposerText] = useState("");
  const [privateComposerImageUrl, setPrivateComposerImageUrl] = useState("");
  const [privateComposerAccess, setPrivateComposerAccess] = useState<NoodlePostAccess>("public");
  const [privateComposerPpvPrice, setPrivateComposerPpvPrice] = useState("");
  const [privateGuideAccess, setPrivateGuideAccess] = useState<NoodlePrivatePostAccess>("subscriber");
  const [privateGuideIncludeText, setPrivateGuideIncludeText] = useState(true);
  const [privateGuideIncludeImage, setPrivateGuideIncludeImage] = useState(true);
  const [privateGuideTheme, setPrivateGuideTheme] = useState("");
  const [privateGuidePrompt, setPrivateGuidePrompt] = useState("");
  const [privateGuideAccountId, setPrivateGuideAccountId] = useState<string | null>(null);
  const [privateStageDraft, setPrivateStageDraft] = useState<PrivateStageDraft | null>(null);
  const [stageProfileDisclosure, setStageProfileDisclosure] = useState<NoodlePrivateIdentityDisclosure>("hinted");
  const [stageProfileName, setStageProfileName] = useState("");
  const [stageProfileBio, setStageProfileBio] = useState("");
  const [stageProfilePersonality, setStageProfilePersonality] = useState("");
  const [stageProfileDynamic, setStageProfileDynamic] = useState("");
  const [stageProfileAppearanceOverride, setStageProfileAppearanceOverride] = useState("");
  const [stageProfilePostingMode, setStageProfilePostingMode] = useState<NoodlePostingMode>("active");
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [imageGenerationPromptDraft, setImageGenerationPromptDraft] = useState("");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [draftPoll, setDraftPoll] = useState<NoodlePollInput | null>(null);

  const settings = data?.settings;
  const accounts = useMemo(
    () =>
      (data?.accounts ?? []).filter(
        (account) =>
          (settings?.allowProfessorMari ?? true) ||
          account.kind !== "character" ||
          account.entityId !== PROFESSOR_MARI_ID,
      ),
    [data?.accounts, settings?.allowProfessorMari],
  );
  const livePersonaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const persona of personas ?? []) {
      const id = readString(persona.id);
      if (id) ids.add(id);
    }
    return ids;
  }, [personas]);
  const personaRecencyById = useMemo(() => {
    const recency = new Map<string, number>();
    for (const persona of personas ?? []) {
      const id = readString(persona.id);
      if (!id) continue;
      recency.set(id, Date.parse(readString(persona.updatedAt) || readString(persona.createdAt)) || 0);
    }
    return recency;
  }, [personas]);
  const personaAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.kind === "persona" &&
          account.visibility !== "private" &&
          (personas === null || livePersonaIds.has(account.entityId)),
      ),
    [accounts, livePersonaIds, personas],
  );
  const sortedPersonaAccounts = useMemo(
    () =>
      personaAccounts.slice().sort((left, right) => {
        const leftRecency = personaRecencyById.get(left.entityId) ?? accountTimestamp(left);
        const rightRecency = personaRecencyById.get(right.entityId) ?? accountTimestamp(right);
        return rightRecency - leftRecency || sortAccountsByDisplayName(left, right);
      }),
    [personaAccounts, personaRecencyById],
  );
  const visiblePersonaAccounts = useMemo(
    () => sortedPersonaAccounts.slice(0, personaAccountLimit),
    [personaAccountLimit, sortedPersonaAccounts],
  );
  const hasMorePersonaAccounts = visiblePersonaAccounts.length < sortedPersonaAccounts.length;
  const posts = useMemo(() => data?.posts ?? [], [data?.posts]);
  const oldestLoadedPostCreatedAt = useMemo(() => {
    let oldest: string | null = null;
    for (const post of posts) {
      if (!oldest || post.createdAt < oldest) oldest = post.createdAt;
    }
    return oldest;
  }, [posts]);
  const interactions = useMemo(() => data?.interactions ?? [], [data?.interactions]);
  const subscriptions = useMemo(() => data?.subscriptions ?? [], [data?.subscriptions]);
  const postUnlocks = useMemo(() => data?.postUnlocks ?? [], [data?.postUnlocks]);
  const scheduler = data?.scheduler;
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const accountByHandle = useMemo(
    () => new Map(accounts.map((account) => [account.handle.toLowerCase(), account])),
    [accounts],
  );
  // NoodleR private accounts never appear in the main feed, switcher, or search —
  // they're only reachable via a direct link from their linked public profile.
  const feedVisibleAccounts = useMemo(() => accounts.filter((account) => account.visibility !== "private"), [accounts]);
  const feedVisiblePosts = useMemo(
    () => posts.filter((post) => accountById.get(post.authorAccountId)?.visibility !== "private"),
    [accountById, posts],
  );
  const postById = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts]);
  const interactionById = useMemo(
    () => new Map(interactions.map((interaction) => [interaction.id, interaction])),
    [interactions],
  );
  const characterAccountByEntity = useMemo(
    () =>
      new Map(accounts.filter((account) => account.kind === "character").map((account) => [account.entityId, account])),
    [accounts],
  );
  const directlyInvitedCharacterIds = useMemo(
    () =>
      (data?.accounts ?? [])
        .filter((account) => account.kind === "character" && account.invited)
        .map((account) => account.entityId),
    [data?.accounts],
  );
  const allowGlobalPersona = settings?.allowGlobalPersona === true;
  const isGlobalPersonaSelected = selectedPersonaId === NOODLE_GLOBAL_PERSONA_ID && allowGlobalPersona;
  const personaAccount = useMemo(() => {
    if (isGlobalPersonaSelected) return null;
    return personaAccounts.find((account) => account.entityId === selectedPersonaId) ?? sortedPersonaAccounts[0] ?? null;
  }, [isGlobalPersonaSelected, personaAccounts, selectedPersonaId, sortedPersonaAccounts]);
  const viewedProfileAccount = useMemo(
    () => (viewedProfileAccountId ? (accountById.get(viewedProfileAccountId) ?? personaAccount) : personaAccount),
    [accountById, personaAccount, viewedProfileAccountId],
  );
  const privateGuideAccount = privateGuideAccountId ? (accountById.get(privateGuideAccountId) ?? null) : null;
  const noodleCustomEmojiMap = useNoodleCustomEmojiMap(viewedProfileAccount);
  const viewingOwnProfile = Boolean(personaAccount && viewedProfileAccount?.id === personaAccount.id);
  const viewingOwnPrivateAccount = Boolean(
    personaAccount &&
      viewedProfileAccount?.visibility === "private" &&
      personaAccount.linkedAccountId === viewedProfileAccount.id,
  );
  const canEditViewedProfile = Boolean(
    viewingOwnProfile || (viewedProfileAccount?.kind === "character" && viewedProfileAccount.invited),
  );
  const personaLinkedNoodlerAccount = personaAccount?.linkedAccountId
    ? (accountById.get(personaAccount.linkedAccountId) ?? null)
    : null;
  const subscribedCreatorIds = useMemo(() => {
    if (!personaAccount) return new Set<string>();
    return new Set(
      subscriptions
        .filter((subscription) => subscription.subscriberAccountId === personaAccount.id)
        .map((subscription) => subscription.creatorAccountId),
    );
  }, [personaAccount, subscriptions]);
  const unlockedPostIds = useMemo(() => {
    if (!personaAccount) return new Set<string>();
    return new Set(
      postUnlocks.filter((unlock) => unlock.accountId === personaAccount.id).map((unlock) => unlock.postId),
    );
  }, [personaAccount, postUnlocks]);
  const isNoodlerEnabled = settings?.enableNoodler === true;
  const noodlerHubQuery = useNoodlerHub(
    personaAccount?.kind,
    personaAccount?.entityId,
    activeNoodleView === "noodler" && isNoodlerEnabled && Boolean(personaAccount),
  );
  const noodlerHub = noodlerHubQuery.data;
  const privateAccounts = useMemo(
    () => accounts.filter((account) => account.visibility === "private"),
    [accounts],
  );
  const privateAccountIds = useMemo(() => new Set(privateAccounts.map((account) => account.id)), [privateAccounts]);
  const privatePosts = useMemo(
    () => posts.filter((post) => privateAccountIds.has(post.authorAccountId)),
    [posts, privateAccountIds],
  );
  const privatePostById = useMemo(() => new Map(privatePosts.map((post) => [post.id, post])), [privatePosts]);
  const subscriberCountByCreatorId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const subscription of subscriptions) {
      if (!privateAccountIds.has(subscription.creatorAccountId)) continue;
      counts.set(subscription.creatorAccountId, (counts.get(subscription.creatorAccountId) ?? 0) + 1);
    }
    return counts;
  }, [privateAccountIds, subscriptions]);
  const latestPrivatePostByCreatorId = useMemo(() => {
    const latest = new Map<string, NoodlePost>();
    for (const post of privatePosts) {
      const current = latest.get(post.authorAccountId);
      if (!current || post.createdAt > current.createdAt) latest.set(post.authorAccountId, post);
    }
    return latest;
  }, [privatePosts]);
  const noodlerTimelineItems = useMemo<NoodlerTimelineItem[]>(() => {
    const items: NoodlerTimelineItem[] = privatePosts.map((post) => ({
      id: `post:${post.id}`,
      kind: "post",
      createdAt: post.createdAt,
      post,
    }));

    for (const subscription of subscriptions) {
      if (!privateAccountIds.has(subscription.creatorAccountId)) continue;
      items.push({
        id: `subscription:${subscription.id}`,
        kind: "subscription",
        createdAt: subscription.createdAt,
        creatorAccount: accountById.get(subscription.creatorAccountId) ?? null,
        actorAccount: accountById.get(subscription.subscriberAccountId) ?? null,
        post: null,
      });
    }

    for (const unlock of postUnlocks) {
      const post = privatePostById.get(unlock.postId) ?? null;
      if (!post) continue;
      items.push({
        id: `unlock:${unlock.id}`,
        kind: "unlock",
        createdAt: unlock.createdAt,
        creatorAccount: accountById.get(post.authorAccountId) ?? null,
        actorAccount: accountById.get(unlock.accountId) ?? null,
        post,
      });
    }

    for (const interaction of interactions) {
      if (interaction.type !== "reply") continue;
      const post = privatePostById.get(interaction.postId) ?? null;
      if (!post || interaction.actorAccountId === post.authorAccountId) continue;
      items.push({
        id: `reply:${interaction.id}`,
        kind: "reply",
        createdAt: interaction.createdAt,
        creatorAccount: accountById.get(post.authorAccountId) ?? null,
        actorAccount: accountById.get(interaction.actorAccountId) ?? null,
        post,
        interaction,
      });
    }

    return items
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, 160);
  }, [accountById, interactions, postUnlocks, privateAccountIds, privatePostById, privatePosts, subscriptions]);
  const noodlerUnseenCountByAccountId = useMemo(() => {
    const counts = new Map<string, number>();
    const incrementIfUnseen = (account: NoodleAccount | null | undefined, createdAt: string) => {
      if (!account) return;
      const lastViewedAt = readNoodlerLastViewedAt(account);
      if (lastViewedAt && createdAt <= lastViewedAt) return;
      counts.set(account.id, (counts.get(account.id) ?? 0) + 1);
    };
    for (const post of privatePosts) incrementIfUnseen(accountById.get(post.authorAccountId), post.createdAt);
    for (const subscription of subscriptions) {
      incrementIfUnseen(accountById.get(subscription.creatorAccountId), subscription.createdAt);
    }
    for (const unlock of postUnlocks) {
      const post = privatePostById.get(unlock.postId);
      incrementIfUnseen(post ? accountById.get(post.authorAccountId) : null, unlock.createdAt);
    }
    for (const interaction of interactions) {
      if (interaction.type !== "reply") continue;
      const post = privatePostById.get(interaction.postId);
      if (!post || interaction.actorAccountId === post.authorAccountId) continue;
      incrementIfUnseen(accountById.get(post.authorAccountId), interaction.createdAt);
    }
    return counts;
  }, [accountById, interactions, postUnlocks, privatePostById, privatePosts, subscriptions]);
  const sortedNoodlerDiscoverAccounts = useMemo(() => {
    const hubAccounts = noodlerHub ? [...noodlerHub.subscribed, ...noodlerHub.discover] : [];
    return uniqueAccountsById(hubAccounts).sort((left, right) => {
      const leftUnseen = noodlerUnseenCountByAccountId.get(left.id) ?? 0;
      const rightUnseen = noodlerUnseenCountByAccountId.get(right.id) ?? 0;
      if (leftUnseen !== rightUnseen) return rightUnseen - leftUnseen;
      const leftPost = latestPrivatePostByCreatorId.get(left.id)?.createdAt ?? "";
      const rightPost = latestPrivatePostByCreatorId.get(right.id)?.createdAt ?? "";
      return rightPost.localeCompare(leftPost) || sortAccountsByDisplayName(left, right);
    });
  }, [latestPrivatePostByCreatorId, noodlerHub, noodlerUnseenCountByAccountId]);
  // Distinct from "Who to follow" on the Noodle side: these are paid creator
  // pages, not follow-only accounts, so the suggestion surface leads with
  // subscriber count / price instead of a plain follow button. Capped at 4,
  // ranked by subscriber count then recency — not the same list or ranking
  // as the "Discover" tab's full sortedNoodlerDiscoverAccounts (which also
  // includes already-subscribed creators and ranks by unseen activity).
  const suggestedNoodlerCreators = useMemo(() => {
    const discoverOnly = noodlerHub?.discover ?? [];
    return uniqueAccountsById(discoverOnly)
      .sort((left, right) => {
        const leftSubs = subscriberCountByCreatorId.get(left.id) ?? 0;
        const rightSubs = subscriberCountByCreatorId.get(right.id) ?? 0;
        if (leftSubs !== rightSubs) return rightSubs - leftSubs;
        const leftPost = latestPrivatePostByCreatorId.get(left.id)?.createdAt ?? "";
        const rightPost = latestPrivatePostByCreatorId.get(right.id)?.createdAt ?? "";
        return rightPost.localeCompare(leftPost) || sortAccountsByDisplayName(left, right);
      })
      .slice(0, 4);
  }, [latestPrivatePostByCreatorId, noodlerHub, subscriberCountByCreatorId]);
  const activeNoodleModeMeta = NOODLE_MODE_META[activeNoodleMode];
  const composeActionLabel = isGlobalPersonaSelected
    ? "Pick a persona to post"
    : activeNoodleMode === "noodler"
      ? "NoodleR Post"
      : "Post";
  const composePlaceholder = isGlobalPersonaSelected
    ? "Switch to a persona account to post."
    : activeNoodleMode === "noodler"
      ? "Post to NoodleR..."
      : "What's simmering?";
  const browserPath =
    activeNoodleView === "noodler-verification"
      ? "/verify"
      : activeNoodleView === "noodler"
        ? "/hub"
        : activeNoodleView === "notifications"
          ? "/notifications"
          : activeNoodleView === "settings"
            ? "/settings"
            : activeNoodleView === "profile"
              ? "/profile"
              : activeNoodleView === "search"
                ? "/search"
                : "/home";
  const canRevealPostAccess = (post: NoodlePost) => {
    if (post.access === "public") return true;
    if (post.authorAccountId === personaAccount?.id) return true;
    const subscribed = subscribedCreatorIds.has(post.authorAccountId);
    if (post.access === "subscriber") return subscribed;
    if (post.access === "ppv") {
      if (unlockedPostIds.has(post.id)) return true;
      if (!subscribed) return false;
      // Legacy accounts (created before this flag existed) keep the old
      // "subscription unlocks everything" behavior; new accounts default to
      // requiring a separate unlock per PPV post unless the creator opts in.
      const author = accountById.get(post.authorAccountId);
      return author?.settings?.subscriptionIncludesPpv !== false;
    }
    return false;
  };
  const toggleSubscription = (creatorAccountId: string) => {
    if (!personaAccount) return;
    if (subscribedCreatorIds.has(creatorAccountId)) {
      unsubscribeAccount.mutate({
        creatorAccountId,
        subscriberKind: "persona",
        subscriberEntityId: personaAccount.entityId,
      });
    } else {
      subscribeAccount.mutate(
        {
          creatorAccountId,
          subscriberKind: "persona",
          subscriberEntityId: personaAccount.entityId,
        },
        {
          onSuccess: (subscription) => {
            if (!subscription.reaction) return;
            const creatorName = accountById.get(creatorAccountId)?.displayName ?? "They";
            toast.success(`${creatorName} replied: "${subscription.reaction.content}"`);
          },
        },
      );
    }
  };
  const unlockAccessPost = (post: NoodlePost) => {
    if (!personaAccount) return;
    unlockPost.mutate(
      { postId: post.id, actorKind: "persona", actorEntityId: personaAccount.entityId },
      {
        onSuccess: (unlock) => {
          if (!unlock.reaction) return;
          const creatorName = accountById.get(post.authorAccountId)?.displayName ?? "They";
          toast.success(`${creatorName} replied: "${unlock.reaction.content}"`);
        },
      },
    );
  };

  useEffect(() => {
    // Do not erase the persisted choice while the account/persona queries are
    // still empty during initial hydration.
    if (!data || personas === null) return;
    if (isGlobalPersonaSelected) return;
    if (selectedPersonaId && personaAccounts.some((account) => account.entityId === selectedPersonaId)) return;
    const activeId = readString((activePersona as RawPersona | null)?.id);
    const activeAccount = personaAccounts.find((account) => account.entityId === activeId);
    const nextPersonaId = activeAccount?.entityId ?? sortedPersonaAccounts[0]?.entityId ?? "";
    if (selectedPersonaId !== nextPersonaId) setSelectedPersonaId(nextPersonaId);
  }, [activePersona, data, isGlobalPersonaSelected, personaAccounts, personas, selectedPersonaId, setSelectedPersonaId, sortedPersonaAccounts]);

  useEffect(() => {
    if (accountSwitcherOpen) setPersonaAccountLimit(NOODLE_PERSONA_SWITCHER_PAGE_SIZE);
  }, [accountSwitcherOpen]);

  useEffect(() => {
    if (!mobileDrawerOpen) {
      setMobileAccountSwitcherOpen(false);
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileDrawerOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileDrawerOpen]);

  useEffect(() => {
    setImageGenerationPromptDraft(settings?.imageGenerationPrompt ?? "");
  }, [settings?.imageGenerationPrompt]);

  useEffect(() => {
    if (!viewedProfileAccount) return;
    setProfileHandle(viewedProfileAccount.handle);
    setProfileName(viewedProfileAccount.displayName);
    setProfileBio(viewedProfileAccount.bio);
    setProfileAvatarUrl(viewedProfileAccount.avatarUrl ?? "");
    setProfileBannerUrl(readAccountSetting(viewedProfileAccount, "bannerUrl"));
    setProfileLocation(readAccountSetting(viewedProfileAccount, "location"));
    setProfileEditing(false);
    setStageProfileDisclosure(readPrivateIdentityDisclosure(viewedProfileAccount));
    setStageProfileName(readPrivateStageSetting(viewedProfileAccount, "stageName") || viewedProfileAccount.displayName);
    setStageProfileBio(readPrivateStageSetting(viewedProfileAccount, "stageBio") || viewedProfileAccount.bio);
    setStageProfilePersonality(readPrivateStageSetting(viewedProfileAccount, "stagePersonality"));
    setStageProfileDynamic(readPrivateStageSetting(viewedProfileAccount, "stageDynamic"));
    setStageProfileAppearanceOverride(readPrivateStageSetting(viewedProfileAccount, "stageAppearanceOverride"));
    setStageProfilePostingMode(readPrivatePostingMode(viewedProfileAccount));
  }, [viewedProfileAccount]);

  useEffect(() => {
    setInviteCharacterLimit(NOODLE_INVITE_PAGE_SIZE);
  }, [inviteSearch]);

  useEffect(() => {
    if (!editingRefreshTime || scheduler?.scheduledTimes.includes(editingRefreshTime)) return;
    setEditingRefreshTime(null);
    setRefreshTimeDraft("");
  }, [editingRefreshTime, scheduler?.scheduledTimes]);

  const saveSettings = (patch: NoodleSettingsUpdateInput) => {
    updateSettings.mutate(patch, {
      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update Noodle settings."),
    });
  };

  const enableNoodlerFromVerification = () => {
    updateSettings.mutate(
      { enableNoodler: true },
      {
        onSuccess: () => {
          toast.success("Verification complete. Welcome to NoodleR — start by creating a NoodlerID.");
          trackAchievement.mutate("noodler_discovered");
          transitionNoodleMode("noodler");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not enable NoodleR."),
      },
    );
  };

  const beginRefreshTimeEdit = (scheduledTime: string) => {
    setEditingRefreshTime(scheduledTime);
    setRefreshTimeDraft(formatNoodleRefreshTimeInput(scheduledTime, scheduler?.timezone));
  };

  const cancelRefreshTimeEdit = () => {
    setEditingRefreshTime(null);
    setRefreshTimeDraft("");
  };

  const saveRefreshTimeEdit = () => {
    if (!editingRefreshTime || !refreshTimeDraft) return;
    rescheduleRefresh.mutate(
      { scheduledTime: editingRefreshTime, time: refreshTimeDraft },
      {
        onSuccess: () => {
          cancelRefreshTimeEdit();
          toast.success("Automatic refresh rescheduled.");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not reschedule refresh."),
      },
    );
  };

  const saveProfile = () => {
    if (!viewedProfileAccount || !canEditViewedProfile) return;
    const normalizedHandle = profileHandle.trim().replace(/^@+/, "");
    const nextAvatarUrl = profileAvatarUrl.trim() || null;
    const nextSettings = {
      ...viewedProfileAccount.settings,
      bannerUrl: profileBannerUrl.trim(),
      location: profileLocation.trim(),
    };
    updateAccount.mutate(
      {
        id: viewedProfileAccount.id,
        handle: normalizedHandle,
        displayName: profileName.trim(),
        bio: profileBio,
        ...(nextAvatarUrl !== viewedProfileAccount.avatarUrl ? { avatarUrl: nextAvatarUrl } : {}),
        settings: nextSettings,
      },
      {
        onSuccess: () => {
          setProfileEditing(false);
          toast.success("Noodle profile updated.");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update Noodle profile."),
      },
    );
  };

  const openPrivateStageSetup = (account: NoodleAccount) => {
    setPrivateStageDraft({
      publicAccountId: account.id,
      identityDisclosure: "hinted",
      stageName: "",
      stageBio: account.bio ?? "",
      stagePersonality: "",
      stageDynamic: "",
      postingMode: "active",
      ageAcknowledged: false,
    });
  };

  const createPrivateStageAccount = () => {
    if (!privateStageDraft) return;
    const publicAccount = accountById.get(privateStageDraft.publicAccountId);
    const stageProfile: NoodlePrivateStageProfileInput = {
      identityDisclosure: privateStageDraft.identityDisclosure,
      stageName: privateStageDraft.stageName.trim() || `${publicAccount?.displayName ?? "Private"} After Dark`,
      stageBio: privateStageDraft.stageBio.trim(),
      stagePersonality: privateStageDraft.stagePersonality.trim(),
      stageDynamic: privateStageDraft.stageDynamic.trim(),
      preserveLinkedAppearance: true,
      postingMode: privateStageDraft.postingMode,
    };
    createPrivateAccount.mutate(
      { publicAccountId: privateStageDraft.publicAccountId, input: { stageProfile } },
      {
        onSuccess: (account) => {
          setPrivateStageDraft(null);
          setViewedProfileAccountId(account.id);
          toast.success("NoodleR profile created.");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create NoodleR profile."),
      },
    );
  };

  const saveStageProfile = () => {
    if (!viewedProfileAccount || viewedProfileAccount.visibility !== "private") return;
    const stageProfile: NoodlePrivateStageProfileInput = {
      identityDisclosure: stageProfileDisclosure,
      stageName: stageProfileName.trim() || viewedProfileAccount.displayName,
      stageBio: stageProfileBio.trim(),
      stagePersonality: stageProfilePersonality.trim(),
      stageDynamic: stageProfileDynamic.trim(),
      stageAppearanceOverride: stageProfileAppearanceOverride.trim(),
      preserveLinkedAppearance: true,
      postingMode: stageProfilePostingMode,
    };
    updateAccount.mutate(
      {
        id: viewedProfileAccount.id,
        displayName: stageProfile.stageName,
        bio: stageProfile.stageBio ?? "",
        settings: {
          ...viewedProfileAccount.settings,
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

  const handleProfileImageFile = (target: "avatar" | "banner", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProfileUploadTarget(target);
    uploadGlobalImages.mutate(
      { files: [file] },
      {
        onSuccess: (images) => {
          const image = images[0];
          if (!image?.url) {
            toast.error("Image uploaded, but no URL was returned.");
            return;
          }
          if (target === "avatar") setProfileAvatarUrl(image.url);
          else setProfileBannerUrl(image.url);

          if (!viewedProfileAccount || !canEditViewedProfile) return;
          updateAccount.mutate(
            target === "avatar"
              ? { id: viewedProfileAccount.id, avatarUrl: image.url }
              : {
                  id: viewedProfileAccount.id,
                  settings: {
                    ...viewedProfileAccount.settings,
                    bannerUrl: image.url,
                  },
                },
            {
              onSuccess: () => toast.success(target === "avatar" ? "Noodle avatar updated." : "Noodle banner updated."),
              onError: (error) =>
                toast.error(error instanceof Error ? error.message : "Could not update Noodle profile image."),
            },
          );
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not upload profile image."),
        onSettled: () => setProfileUploadTarget(null),
      },
    );
  };

  const appendToComposer = (text: string) => {
    const textarea = composeOpen ? modalComposerRef.current : inlineComposerRef.current;
    const source = textarea?.value ?? composerValueRef.current;
    const inserted = insertAtSelection(
      source,
      text,
      textarea?.selectionStart ?? source.length,
      textarea?.selectionEnd ?? textarea?.selectionStart ?? source.length,
    );
    composerValueRef.current = inserted.value;
    const hasText = Boolean(inserted.value.trim());
    composerHasTextRef.current = hasText;
    setComposerHasText(hasText);
    setComposer(inserted.value);
    if (textarea) textarea.value = inserted.value;
    setActiveMention(null);
    setActiveMentionIndex(0);
    window.requestAnimationFrame(() => {
      const activeTextarea = composeOpen ? modalComposerRef.current : inlineComposerRef.current;
      activeTextarea?.focus();
      activeTextarea?.setSelectionRange(inserted.caret, inserted.caret);
    });
  };

  const applyImageUrl = () => {
    const url = imageUrlDraft.trim();
    if (!url) {
      toast.error("Paste an image URL first.");
      return;
    }
    setAttachedImageUrl(url);
    setImageUrlDraft("");
    setActiveComposerTool(null);
  };

  const handleImageFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    uploadGlobalImages.mutate(
      { files: [file] },
      {
        onSuccess: (images) => {
          const image = images[0];
          if (!image?.url) {
            toast.error("Image uploaded, but no URL was returned.");
            return;
          }
          setAttachedImageUrl(image.url);
          setActiveComposerTool(null);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not attach image."),
      },
    );
  };

  const appendToReply = (text: string) => {
    const textarea = replyComposerRef.current;
    const source = textarea?.value ?? replyValueRef.current;
    const inserted = insertAtSelection(
      source,
      text,
      textarea?.selectionStart ?? source.length,
      textarea?.selectionEnd ?? textarea?.selectionStart ?? source.length,
    );
    replyValueRef.current = inserted.value;
    const hasText = Boolean(inserted.value.trim());
    replyHasTextRef.current = hasText;
    setReplyHasText(hasText);
    setReplyText(inserted.value);
    if (textarea) textarea.value = inserted.value;
    setActiveReplyMention(null);
    setActiveReplyMentionIndex(0);
    window.requestAnimationFrame(() => {
      replyComposerRef.current?.focus();
      replyComposerRef.current?.setSelectionRange(inserted.caret, inserted.caret);
    });
  };

  const applyReplyImageUrl = () => {
    const url = replyImageUrlDraft.trim();
    if (!url) {
      toast.error("Paste an image URL first.");
      return;
    }
    setReplyImageUrl(url);
    setReplyImageUrlDraft("");
    setActiveReplyComposerTool(null);
  };

  const handleReplyImageFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    uploadGlobalImages.mutate(
      { files: [file] },
      {
        onSuccess: (images) => {
          const image = images[0];
          if (!image?.url) {
            toast.error("Image uploaded, but no URL was returned.");
            return;
          }
          setReplyImageUrl(image.url);
          setActiveReplyComposerTool(null);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not attach image."),
      },
    );
  };

  const clearReplyComposer = () => {
    setReplyPostId(null);
    setReplyParentInteractionId(null);
    setReplyText("");
    replyValueRef.current = "";
    replyHasTextRef.current = false;
    setReplyHasText(false);
    if (replyComposerRef.current) replyComposerRef.current.value = "";
    setActiveReplyMention(null);
    setActiveReplyMentionIndex(0);
    setReplyImageUrl("");
    setReplyImageUrlDraft("");
    setActiveReplyComposerTool(null);
  };

  const openReplyComposer = (postId: string, parentInteractionId: string | null = null) => {
    if (replyPostId === postId && replyParentInteractionId === parentInteractionId) {
      clearReplyComposer();
      return;
    }
    setReplyPostId(postId);
    setReplyParentInteractionId(parentInteractionId);
    setReplyText("");
    replyValueRef.current = "";
    replyHasTextRef.current = false;
    setReplyHasText(false);
    setActiveReplyMention(null);
    setActiveReplyMentionIndex(0);
    setReplyImageUrl("");
    setReplyImageUrlDraft("");
    setActiveReplyComposerTool(null);
    setActiveComposerTool(null);
  };

  const applyPoll = () => {
    const question = pollQuestion.trim();
    const options = pollOptions.map((option) => option.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      toast.error("Polls need a question and at least two options.");
      return;
    }
    if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
      toast.error("Poll options need to be different from each other.");
      return;
    }
    setDraftPoll({ question, options });
    setPollQuestion("");
    setPollOptions(["", ""]);
    setActiveComposerTool(null);
  };

  const togglePollComposer = () => {
    if (activeComposerTool === "poll") {
      setActiveComposerTool(null);
      return;
    }
    setPollQuestion(draftPoll?.question ?? "");
    setPollOptions(draftPoll?.options ?? ["", ""]);
    setActiveComposerTool("poll");
  };

  const renderDraftPoll = () =>
    draftPoll ? (
      <section
        className="mb-3 rounded-xl border border-[var(--noodle-blue)]/35 bg-[var(--noodle-blue)]/5 p-3"
        aria-label={`Draft poll: ${draftPoll.question}`}
        data-component="NoodleView.DraftPoll"
      >
        <div className="flex items-start gap-2">
          <ListChecks size={16} className="mt-0.5 shrink-0 text-[var(--noodle-blue)]" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-5">{draftPoll.question}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-[var(--muted-foreground)]">
              {draftPoll.options.map((option) => (
                <li key={option} className="truncate">
                  {option}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={togglePollComposer}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
            title="Edit poll"
            aria-label="Edit draft poll"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => setDraftPoll(null)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
            title="Remove poll"
            aria-label="Remove draft poll"
          >
            <X size={14} />
          </button>
        </div>
      </section>
    ) : null;

  const canSubmitPost = Boolean(
    personaAccount &&
      (activeNoodleMode !== "noodler" || personaLinkedNoodlerAccount) &&
      (composerHasText || attachedImageUrl.trim() || draftPoll),
  );
  const confirmActionPending =
    confirmAction?.kind === "delete-post"
      ? deletePost.isPending
      : confirmAction?.kind === "delete-reply"
        ? deleteInteraction.isPending
        : confirmAction?.kind === "reset-timeline"
          ? resetNoodleTimeline.isPending
          : confirmAction?.kind === "delete-noodler-profile"
            ? deletePrivateAccount.isPending
            : confirmAction?.kind === "uninvite-everybody"
              ? clearInvites.isPending
              : false;
  const normalizedProfileHandle = profileHandle.trim().replace(/^@+/, "");
  const isEditingProfile = canEditViewedProfile && profileEditing;
  const profileDisplayName = canEditViewedProfile
    ? profileName.trim() || viewedProfileAccount?.displayName || "Noodle Account"
    : viewedProfileAccount?.displayName || "Noodle Account";
  const profileDisplayHandle = canEditViewedProfile
    ? normalizedProfileHandle
    : (viewedProfileAccount?.handle ?? "noodle");
  const profileBioPreview = canEditViewedProfile ? profileBio.trim() : (viewedProfileAccount?.bio.trim() ?? "");
  const profileAvatarPreview = canEditViewedProfile
    ? profileAvatarUrl.trim() || null
    : (viewedProfileAccount?.avatarUrl ?? null);
  const profileAvatarCropPreview =
    viewedProfileAccount && profileAvatarPreview === viewedProfileAccount.avatarUrl
      ? viewedProfileAccount.avatarCrop
      : null;
  const profilePreviewAccount = {
    displayName: profileDisplayName,
    avatarUrl: profileAvatarPreview,
    avatarCrop: profileAvatarCropPreview,
  };
  const profileBannerPreview = canEditViewedProfile
    ? profileBannerUrl.trim()
    : readAccountSetting(viewedProfileAccount, "bannerUrl");
  const profileLocationPreview = canEditViewedProfile
    ? profileLocation.trim()
    : readAccountSetting(viewedProfileAccount, "location");
  const canSaveProfile = Boolean(canEditViewedProfile && profileName.trim() && normalizedProfileHandle);
  const rawPostSearch = postSearch.trim();
  const normalizedPostSearch = rawPostSearch.toLowerCase();
  const isAccountSearch = rawPostSearch.includes("@");
  const accountSearchTerm = extractAccountSearchTerm(rawPostSearch);
  const selectedCharacterGroupIds = useMemo(
    () => new Set(settings?.invitedCharacterGroupIds ?? []),
    [settings?.invitedCharacterGroupIds],
  );
  const folderInvitedCharacterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of characterGroups) {
      const groupId = readString(group.id);
      if (!groupId || !selectedCharacterGroupIds.has(groupId)) continue;
      for (const characterId of readStringArray(group.characterIds)) ids.add(characterId);
    }
    return ids;
  }, [characterGroups, selectedCharacterGroupIds]);
  const mentionableCharacterAccounts = useMemo(
    () =>
      accounts
        .filter(
          (account) =>
            account.kind === "character" &&
            account.visibility !== "private" &&
            (account.invited || folderInvitedCharacterIds.has(account.entityId)),
        )
        .sort(sortAccountsByDisplayName),
    [accounts, folderInvitedCharacterIds],
  );
  const mentionSuggestions = useMemo(() => {
    return matchingMentionAccounts(mentionableCharacterAccounts, activeMention);
  }, [activeMention, mentionableCharacterAccounts]);
  const replyMentionSuggestions = useMemo(
    () => matchingMentionAccounts(mentionableCharacterAccounts, activeReplyMention),
    [activeReplyMention, mentionableCharacterAccounts],
  );
  const selectedFolderCharacterIds = useMemo(() => Array.from(folderInvitedCharacterIds), [folderInvitedCharacterIds]);
  const uninvitedSelectedFolderCharacterIds = useMemo(
    () => selectedFolderCharacterIds.filter((id) => characterAccountByEntity.get(id)?.invited !== true),
    [characterAccountByEntity, selectedFolderCharacterIds],
  );
  const folderInviteButtonLabel =
    selectedCharacterGroupIds.size === 0
      ? "Select folders to invite"
      : uninvitedSelectedFolderCharacterIds.length === 0
        ? "Selected folder characters are invited"
        : `Invite ${uninvitedSelectedFolderCharacterIds.length} ${
            uninvitedSelectedFolderCharacterIds.length === 1 ? "character" : "characters"
          }`;
  const hasActiveInvites = Boolean(
    directlyInvitedCharacterIds.length > 0 || selectedCharacterGroupIds.size > 0 || settings?.allowRandomUsers,
  );
  const followedAccountIds = useMemo(
    () => new Set(readStringArray(personaAccount?.settings?.followingAccountIds)),
    [personaAccount?.settings],
  );
  const canFollowViewedProfile = Boolean(
    viewedProfileAccount &&
    viewedProfileAccount.kind === "character" &&
    hasGeneratedProfile(viewedProfileAccount) &&
    (viewedProfileAccount.invited || folderInvitedCharacterIds.has(viewedProfileAccount.entityId)),
  );
  const canFollowAccount = useCallback(
    (account: NoodleAccount | null) =>
      Boolean(
        account &&
        account.kind === "character" &&
        hasGeneratedProfile(account) &&
        (account.invited || folderInvitedCharacterIds.has(account.entityId)),
      ),
    [folderInvitedCharacterIds],
  );
  const viewedProfileFollowed = Boolean(viewedProfileAccount && followedAccountIds.has(viewedProfileAccount.id));
  const followedCharacterAccountIds = useMemo(
    () =>
      new Set(
        accounts
          .filter(
            (account) =>
              account.kind === "character" &&
              followedAccountIds.has(account.id) &&
              (account.invited || folderInvitedCharacterIds.has(account.entityId)),
          )
          .map((account) => account.id),
      ),
    [accounts, folderInvitedCharacterIds, followedAccountIds],
  );
  const latestExternalReplyToPersonaCommentAtByPostId = useMemo(() => {
    const latest = new Map<string, number>();
    if (!personaAccount) return latest;
    for (const interaction of interactions) {
      if (
        interaction.type !== "reply" ||
        interaction.actorAccountId === personaAccount.id ||
        !interaction.parentInteractionId
      ) {
        continue;
      }
      const parentComment = interactionById.get(interaction.parentInteractionId);
      if (parentComment?.type !== "reply" || parentComment.actorAccountId !== personaAccount.id) continue;
      const createdAt = new Date(interaction.createdAt).getTime();
      if (!Number.isFinite(createdAt)) continue;
      latest.set(interaction.postId, Math.max(latest.get(interaction.postId) ?? 0, createdAt));
    }
    return latest;
  }, [interactionById, interactions, personaAccount]);
  const baseTimelinePosts = useMemo(() => {
    const visiblePosts =
      timelineTab === "following" && !isGlobalPersonaSelected
        ? feedVisiblePosts.filter((post) => followedCharacterAccountIds.has(post.authorAccountId))
        : feedVisiblePosts;
    return visiblePosts.slice().sort((left, right) => {
      const leftActivityAt = Math.max(
        new Date(left.createdAt).getTime() || 0,
        latestExternalReplyToPersonaCommentAtByPostId.get(left.id) ?? 0,
      );
      const rightActivityAt = Math.max(
        new Date(right.createdAt).getTime() || 0,
        latestExternalReplyToPersonaCommentAtByPostId.get(right.id) ?? 0,
      );
      return rightActivityAt - leftActivityAt;
    });
  }, [feedVisiblePosts, followedCharacterAccountIds, isGlobalPersonaSelected, latestExternalReplyToPersonaCommentAtByPostId, timelineTab]);
  const timelinePosts = useMemo(() => {
    if (!normalizedPostSearch || isAccountSearch) return baseTimelinePosts;
    return baseTimelinePosts.filter((post) => {
      const author = accountById.get(post.authorAccountId) ?? post.authorSnapshot;
      return [post.content, post.imagePrompt, author?.displayName, author?.handle].some((value) =>
        readString(value).toLowerCase().includes(normalizedPostSearch),
      );
    });
  }, [accountById, baseTimelinePosts, isAccountSearch, normalizedPostSearch]);
  const accountSearchResults = useMemo(() => {
    if (!isAccountSearch) return [];
    const exactHandle = accountSearchTerm;
    return feedVisibleAccounts
      .filter((account) => accountMatchesSearch(account, exactHandle))
      .sort((left, right) => {
        const leftExact = left.handle.toLowerCase() === exactHandle;
        const rightExact = right.handle.toLowerCase() === exactHandle;
        if (leftExact !== rightExact) return leftExact ? -1 : 1;
        const leftStarts = left.handle.toLowerCase().startsWith(exactHandle);
        const rightStarts = right.handle.toLowerCase().startsWith(exactHandle);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        return sortAccountsByDisplayName(left, right);
      })
      .slice(0, 50);
  }, [accountSearchTerm, feedVisibleAccounts, isAccountSearch]);
  const profilePosts = useMemo(
    () => (viewedProfileAccount ? posts.filter((post) => post.authorAccountId === viewedProfileAccount.id) : []),
    [posts, viewedProfileAccount],
  );
  const profileLikedPosts = useMemo(() => {
    if (!viewedProfileAccount) return [];
    const likedAtByPostId = new Map<string, string>();
    for (const interaction of interactions) {
      if (
        interaction.actorAccountId === viewedProfileAccount.id &&
        interaction.type === "like" &&
        !interaction.parentInteractionId
      ) {
        likedAtByPostId.set(interaction.postId, interaction.createdAt);
      }
    }
    return posts
      .filter((post) => likedAtByPostId.has(post.id))
      .sort((a, b) => {
        const aTime = new Date(likedAtByPostId.get(a.id) ?? a.createdAt).getTime();
        const bTime = new Date(likedAtByPostId.get(b.id) ?? b.createdAt).getTime();
        return bTime - aTime;
      });
  }, [interactions, posts, viewedProfileAccount]);
  const profileMediaPosts = useMemo(() => profilePosts.filter((post) => Boolean(post.imageUrl)), [profilePosts]);
  const profileVisiblePosts =
    profileTab === "likes" ? profileLikedPosts : profileTab === "media" ? profileMediaPosts : profilePosts;
  const profileFollowerAccounts = useMemo(() => {
    if (!viewedProfileAccount) return [];
    const explicitFollowers = accounts.filter((account) => {
      if (account.id === viewedProfileAccount.id) return false;
      const followingAccountIds = readStringArray(account.settings?.followingAccountIds);
      return followingAccountIds.includes(viewedProfileAccount.id);
    });
    const personaFollowsViewedProfile =
      !viewingOwnProfile &&
      personaAccount &&
      viewedProfileAccount.kind === "character" &&
      followedAccountIds.has(viewedProfileAccount.id)
        ? [personaAccount]
        : [];
    return uniqueAccountsById([...explicitFollowers, ...personaFollowsViewedProfile]).sort(sortAccountsByDisplayName);
  }, [accounts, followedAccountIds, personaAccount, viewedProfileAccount, viewingOwnProfile]);
  const profileFollowingAccounts = useMemo(() => {
    if (viewingOwnProfile) {
      const explicitFollowing = readStringArray(personaAccount?.settings?.followingAccountIds).map((id) =>
        accountById.get(id),
      );
      return uniqueAccountsById(explicitFollowing).sort(sortAccountsByDisplayName);
    }
    if (!viewedProfileAccount) return [];
    const followingIds = new Set(readStringArray(viewedProfileAccount.settings?.followingAccountIds));
    return uniqueAccountsById([...followingIds].map((id) => accountById.get(id))).sort(sortAccountsByDisplayName);
  }, [accountById, personaAccount, viewedProfileAccount, viewingOwnProfile]);
  const profileFollowerCount = profileFollowerAccounts.length;
  const profileFollowingCount = profileFollowingAccounts.length;
  const profileConnectionAccounts =
    profileConnectionTab === "following" ? profileFollowingAccounts : profileFollowerAccounts;
  const notificationLikes = useMemo(() => {
    if (!personaAccount) return [];
    const personaPostIds = new Set(
      posts.filter((post) => post.authorAccountId === personaAccount.id).map((post) => post.id),
    );
    return interactions
      .filter((interaction) => interaction.type === "like" && interaction.actorAccountId !== personaAccount.id)
      .map((interaction) => {
        const targetReply = interaction.parentInteractionId
          ? (interactionById.get(interaction.parentInteractionId) ?? null)
          : null;
        const targetsPersona = targetReply
          ? targetReply.actorAccountId === personaAccount.id
          : personaPostIds.has(interaction.postId);
        return {
          interaction,
          targetReply,
          targetsPersona,
          post: postById.get(interaction.postId) ?? null,
          actorAccount: accountById.get(interaction.actorAccountId) ?? null,
          actorSnapshot: interaction.actorSnapshot,
        };
      })
      .filter((item) => item.targetsPersona)
      .filter((item): item is typeof item & { post: NoodlePost } => Boolean(item.post))
      .sort(
        (left, right) =>
          new Date(right.interaction.createdAt).getTime() - new Date(left.interaction.createdAt).getTime(),
      );
  }, [accountById, interactionById, interactions, personaAccount, postById, posts]);
  const notificationFollowAccounts = useMemo(() => {
    if (!personaAccount) return [];
    return accounts
      .flatMap((account) => {
        if (account.id === personaAccount.id) return [];
        const followingAccountIds = readStringArray(account.settings?.followingAccountIds);
        if (!followingAccountIds.includes(personaAccount.id)) return [];
        const followedAtByAccount = parseRecord(account.settings?.[NOODLE_FOLLOWED_AT_BY_ACCOUNT_KEY]);
        return [{ account, followedAt: readString(followedAtByAccount[personaAccount.id]) }];
      })
      .sort((left, right) => (Date.parse(right.followedAt) || 0) - (Date.parse(left.followedAt) || 0));
  }, [accounts, personaAccount]);
  const notificationReplyItems = useMemo(() => {
    if (!personaAccount) return [];
    const items: Array<{
      id: string;
      kind: "reply" | "mention";
      createdAt: string;
      actorAccount: NoodleAccount | null;
      actorSnapshot: NoodlePost["authorSnapshot"];
      post: NoodlePost;
      content: string;
      replyTarget: "post" | "comment" | null;
      interactionId: string | null;
    }> = [];
    const seen = new Set<string>();
    for (const interaction of interactions) {
      if (interaction.type !== "reply" || interaction.actorAccountId === personaAccount.id) continue;
      const post = postById.get(interaction.postId);
      if (!post) continue;
      const parentReply = interaction.parentInteractionId
        ? (interactionById.get(interaction.parentInteractionId) ?? null)
        : null;
      const repliesToPersonaComment = parentReply?.actorAccountId === personaAccount.id;
      const repliesToPersona = repliesToPersonaComment || post.authorAccountId === personaAccount.id;
      const mentionsPersona = textMentionsHandle(interaction.content, personaAccount.handle);
      if (!repliesToPersona && !mentionsPersona) continue;
      const id = `reply:${interaction.id}`;
      seen.add(id);
      items.push({
        id,
        kind: repliesToPersona ? "reply" : "mention",
        createdAt: interaction.createdAt,
        actorAccount: accountById.get(interaction.actorAccountId) ?? null,
        actorSnapshot: interaction.actorSnapshot,
        post,
        content: interaction.content ?? "",
        replyTarget: repliesToPersonaComment ? "comment" : repliesToPersona ? "post" : null,
        interactionId: interaction.id,
      });
    }
    for (const post of posts) {
      if (post.authorAccountId === personaAccount.id || !textMentionsHandle(post.content, personaAccount.handle)) {
        continue;
      }
      const id = `post:${post.id}`;
      if (seen.has(id)) continue;
      items.push({
        id,
        kind: "mention",
        createdAt: post.createdAt,
        actorAccount: accountById.get(post.authorAccountId) ?? null,
        actorSnapshot: post.authorSnapshot,
        post,
        content: post.content,
        replyTarget: null,
        interactionId: null,
      });
    }
    return items.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [accountById, interactionById, interactions, personaAccount, postById, posts]);

  const noodlerNotificationLikes = useMemo(() => {
    if (!personaLinkedNoodlerAccount) return [];
    const ownedAccountId = personaLinkedNoodlerAccount.id;
    const ownedPostIds = new Set(
      posts.filter((post) => post.authorAccountId === ownedAccountId).map((post) => post.id),
    );
    return interactions
      .filter((interaction) => interaction.type === "like" && interaction.actorAccountId !== ownedAccountId)
      .map((interaction) => {
        const targetReply = interaction.parentInteractionId
          ? (interactionById.get(interaction.parentInteractionId) ?? null)
          : null;
        const targetsOwnedAccount = targetReply
          ? targetReply.actorAccountId === ownedAccountId
          : ownedPostIds.has(interaction.postId);
        return {
          interaction,
          targetReply,
          targetsOwnedAccount,
          post: postById.get(interaction.postId) ?? null,
          actorAccount: accountById.get(interaction.actorAccountId) ?? null,
          actorSnapshot: interaction.actorSnapshot,
        };
      })
      .filter((item) => item.targetsOwnedAccount)
      .filter((item): item is typeof item & { post: NoodlePost } => Boolean(item.post))
      .sort(
        (left, right) =>
          new Date(right.interaction.createdAt).getTime() - new Date(left.interaction.createdAt).getTime(),
      );
  }, [accountById, interactionById, interactions, personaLinkedNoodlerAccount, postById, posts]);

  const noodlerNotificationReplies = useMemo(() => {
    if (!personaLinkedNoodlerAccount) return [];
    const ownedAccountId = personaLinkedNoodlerAccount.id;
    const items: Array<{
      id: string;
      createdAt: string;
      actorAccount: NoodleAccount | null;
      actorSnapshot: NoodlePost["authorSnapshot"];
      post: NoodlePost;
      content: string;
      replyTarget: "post" | "comment" | null;
      interactionId: string;
    }> = [];
    for (const interaction of interactions) {
      if (interaction.type !== "reply" || interaction.actorAccountId === ownedAccountId) continue;
      const post = postById.get(interaction.postId);
      if (!post || post.authorAccountId !== ownedAccountId) continue;
      const parentReply = interaction.parentInteractionId
        ? (interactionById.get(interaction.parentInteractionId) ?? null)
        : null;
      const repliesToOwnedComment = parentReply?.actorAccountId === ownedAccountId;
      items.push({
        id: `reply:${interaction.id}`,
        createdAt: interaction.createdAt,
        actorAccount: accountById.get(interaction.actorAccountId) ?? null,
        actorSnapshot: interaction.actorSnapshot,
        post,
        content: interaction.content ?? "",
        replyTarget: repliesToOwnedComment ? "comment" : "post",
        interactionId: interaction.id,
      });
    }
    return items.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [accountById, interactionById, interactions, personaLinkedNoodlerAccount, postById]);

  const noodlerNotificationSubscriptions = useMemo(() => {
    if (!personaLinkedNoodlerAccount) return [];
    return subscriptions
      .filter((subscription) => subscription.creatorAccountId === personaLinkedNoodlerAccount.id)
      .map((subscription) => ({
        subscription,
        subscriberAccount: accountById.get(subscription.subscriberAccountId) ?? null,
      }))
      .sort(
        (left, right) =>
          new Date(right.subscription.createdAt).getTime() - new Date(left.subscription.createdAt).getTime(),
      );
  }, [accountById, personaLinkedNoodlerAccount, subscriptions]);

  const noodlerNotificationUnlocks = useMemo(() => {
    if (!personaLinkedNoodlerAccount) return [];
    const ownedPostIds = new Set(
      posts.filter((post) => post.authorAccountId === personaLinkedNoodlerAccount.id).map((post) => post.id),
    );
    return postUnlocks
      .filter((unlock) => ownedPostIds.has(unlock.postId))
      .map((unlock) => ({
        unlock,
        unlockerAccount: accountById.get(unlock.accountId) ?? null,
        post: postById.get(unlock.postId) ?? null,
      }))
      .sort((left, right) => new Date(right.unlock.createdAt).getTime() - new Date(left.unlock.createdAt).getTime());
  }, [accountById, personaLinkedNoodlerAccount, postById, postUnlocks, posts]);

  const noodlerNotificationActivity = useMemo(() => {
    const likeEntries = noodlerNotificationLikes.map((item) => ({
      kind: "like" as const,
      createdAt: item.interaction.createdAt,
      item,
    }));
    const replyEntries = noodlerNotificationReplies.map((item) => ({
      kind: "reply" as const,
      createdAt: item.createdAt,
      item,
    }));
    return [...likeEntries, ...replyEntries].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  }, [noodlerNotificationLikes, noodlerNotificationReplies]);

  useEffect(() => {
    if (activeNoodleView !== "home" || !notificationFocusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const timeline = timelineScrollRef.current;
      if (!timeline) return;
      const postElement = Array.from(timeline.querySelectorAll<HTMLElement>("[data-noodle-post-id]")).find(
        (element) => element.dataset.noodlePostId === notificationFocusTarget.postId,
      );
      const interactionElement = notificationFocusTarget.interactionId
        ? Array.from(timeline.querySelectorAll<HTMLElement>("[data-noodle-interaction-id]")).find(
            (element) => element.dataset.noodleInteractionId === notificationFocusTarget.interactionId,
          )
        : null;
      const targetElement = interactionElement ?? postElement;
      if (!targetElement) {
        setNotificationFocusTarget(null);
        return;
      }
      targetElement.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
      targetElement.focus({ preventScroll: true });
      setHighlightedInteractionId(interactionElement ? notificationFocusTarget.interactionId : null);
      setNotificationFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeNoodleView, notificationFocusTarget, prefersReducedMotion]);

  useEffect(() => {
    if (!highlightedInteractionId) return;
    const timeout = window.setTimeout(() => setHighlightedInteractionId(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [highlightedInteractionId]);

  const notificationReadAt = personaAccount
    ? (notificationReadOverrides[personaAccount.id] ??
      readAccountSetting(personaAccount, NOODLE_NOTIFICATIONS_READ_AT_KEY))
    : "";
  const notificationReadTime = Date.parse(notificationReadAt) || 0;
  const notificationCount =
    notificationLikes.filter((item) => new Date(item.interaction.createdAt).getTime() > notificationReadTime).length +
    notificationFollowAccounts.filter((item) => (Date.parse(item.followedAt) || 0) > notificationReadTime).length +
    notificationReplyItems.filter((item) => new Date(item.createdAt).getTime() > notificationReadTime).length;
  const notificationBadgeLabel = notificationCount > 99 ? "99+" : String(notificationCount);
  const noodlerNotificationReadAt = personaAccount
    ? (notificationReadOverrides[`noodler:${personaAccount.id}`] ??
      readAccountSetting(personaAccount, NOODLER_NOTIFICATIONS_READ_AT_KEY))
    : "";
  const noodlerNotificationReadTime = Date.parse(noodlerNotificationReadAt) || 0;
  const noodlerNotificationCount =
    noodlerNotificationSubscriptions.filter(
      (item) => new Date(item.subscription.createdAt).getTime() > noodlerNotificationReadTime,
    ).length +
    noodlerNotificationUnlocks.filter((item) => new Date(item.unlock.createdAt).getTime() > noodlerNotificationReadTime)
      .length +
    noodlerNotificationLikes.filter(
      (item) => new Date(item.interaction.createdAt).getTime() > noodlerNotificationReadTime,
    ).length +
    noodlerNotificationReplies.filter((item) => new Date(item.createdAt).getTime() > noodlerNotificationReadTime)
      .length;
  const noodlerNotificationBadgeLabel = noodlerNotificationCount > 99 ? "99+" : String(noodlerNotificationCount);
  const followableCharacterAccounts = useMemo(
    () =>
      accounts
        .filter(
          (account) =>
            account.kind === "character" &&
            hasGeneratedProfile(account) &&
            (account.invited || folderInvitedCharacterIds.has(account.entityId)),
        )
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [accounts, folderInvitedCharacterIds],
  );
  const suggestedCharacters = useMemo(() => {
    if (isGlobalPersonaSelected) return [];
    return followableCharacterAccounts
      .filter((account) => !followedAccountIds.has(account.id))
      .map((account) => ({
        account,
        accountId: account.id,
        name: account.displayName,
        handle: account.handle,
        avatarUrl: account.avatarUrl,
      }))
      .slice(0, 5);
  }, [followableCharacterAccounts, followedAccountIds, isGlobalPersonaSelected]);

  const markNoodlerAccountViewed = (account: NoodleAccount) => {
    if (account.visibility !== "private") return;
    if ((noodlerUnseenCountByAccountId.get(account.id) ?? 0) === 0) return;
    updateAccount.mutate({
      id: account.id,
      settings: {
        ...account.settings,
        [NOODLER_LAST_VIEWED_AT_KEY]: new Date().toISOString(),
      },
    });
  };

  const openProfile = (account: NoodleAccount | null) => {
    if (!account) return;
    if (account.visibility === "private" && !isNoodlerEnabled) {
      enterNoodlerVerification();
      return;
    }
    markNoodlerAccountViewed(account);
    setViewedProfileAccountId(account.id === personaAccount?.id ? null : account.id);
    setProfileEditing(false);
    setProfileTab("posts");
    setProfileConnectionTab(null);
    setActiveNoodleMode(account.visibility === "private" ? "noodler" : "noodle");
    setActiveNoodleView("profile");
    setAccountSwitcherOpen(false);
    setMobileDrawerOpen(false);
  };

  const openOwnProfile = () => {
    if (isGlobalPersonaSelected) return;
    setProfileEditing(false);
    setProfileTab("posts");
    setProfileConnectionTab(null);
    if (activeNoodleMode === "noodler") {
      // No linked NoodleR account yet: stay in NoodleR mode and show the
      // sign-up screen instead of bouncing back to the public profile.
      setViewedProfileAccountId(personaLinkedNoodlerAccount ? personaLinkedNoodlerAccount.id : null);
      setActiveNoodleView("profile");
    } else {
      setViewedProfileAccountId(null);
      setActiveNoodleMode("noodle");
      setActiveNoodleView("profile");
    }
    setAccountSwitcherOpen(false);
    setMobileDrawerOpen(false);
  };

  const handleSearchChange = (value: string) => {
    setPostSearch(value);
    if (!value.trim()) return;
    setActiveNoodleView("home");
    setAccountSwitcherOpen(false);
    setProfileConnectionTab(null);
  };

  const handleComposerChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    composerValueRef.current = value;
    const hasText = Boolean(value.trim());
    if (hasText !== composerHasTextRef.current) {
      composerHasTextRef.current = hasText;
      setComposerHasText(hasText);
    }
    const nextMention = activeComposerMention(value, event.target.selectionStart ?? value.length);
    if (nextMention || activeMention) setActiveMention(nextMention);
    if (activeMentionIndex !== 0) setActiveMentionIndex(0);
  };

  const selectComposerMention = (account: NoodleAccount) => {
    if (!activeMention) return;
    const insertedMention = `@${account.handle} `;
    const source = composerValueRef.current;
    const nextComposer = source.slice(0, activeMention.start) + insertedMention + source.slice(activeMention.end);
    const nextCaret = activeMention.start + insertedMention.length;
    composerValueRef.current = nextComposer;
    composerHasTextRef.current = Boolean(nextComposer.trim());
    setComposerHasText(composerHasTextRef.current);
    setComposer(nextComposer);
    setActiveMention(null);
    setActiveMentionIndex(0);
    window.requestAnimationFrame(() => {
      const textarea = composeOpen ? modalComposerRef.current : inlineComposerRef.current;
      if (textarea) textarea.value = nextComposer;
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!activeMention) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setActiveMention(null);
      return;
    }
    if (mentionSuggestions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveMentionIndex((current) => (current + direction + mentionSuggestions.length) % mentionSuggestions.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const account = mentionSuggestions[Math.min(activeMentionIndex, mentionSuggestions.length - 1)];
      if (account) selectComposerMention(account);
    }
  };

  const renderComposerMentionSuggestions = (listboxId: string) => {
    return (
      <NoodleMentionSuggestions
        activeMention={activeMention}
        activeIndex={activeMentionIndex}
        accounts={mentionSuggestions}
        listboxId={listboxId}
        onSelect={selectComposerMention}
      />
    );
  };

  const handleReplyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    replyValueRef.current = value;
    const hasText = Boolean(value.trim());
    if (hasText !== replyHasTextRef.current) {
      replyHasTextRef.current = hasText;
      setReplyHasText(hasText);
    }
    const nextMention = activeComposerMention(value, event.target.selectionStart ?? value.length);
    if (nextMention || activeReplyMention) setActiveReplyMention(nextMention);
    if (activeReplyMentionIndex !== 0) setActiveReplyMentionIndex(0);
  };

  const selectReplyMention = (account: NoodleAccount) => {
    if (!activeReplyMention) return;
    const insertedMention = `@${account.handle} `;
    const source = replyValueRef.current;
    const nextReply = source.slice(0, activeReplyMention.start) + insertedMention + source.slice(activeReplyMention.end);
    const nextCaret = activeReplyMention.start + insertedMention.length;
    replyValueRef.current = nextReply;
    replyHasTextRef.current = Boolean(nextReply.trim());
    setReplyHasText(replyHasTextRef.current);
    setReplyText(nextReply);
    setActiveReplyMention(null);
    setActiveReplyMentionIndex(0);
    window.requestAnimationFrame(() => {
      if (replyComposerRef.current) replyComposerRef.current.value = nextReply;
      replyComposerRef.current?.focus();
      replyComposerRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleReplyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!activeReplyMention) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setActiveReplyMention(null);
      return;
    }
    if (replyMentionSuggestions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveReplyMentionIndex(
        (current) => (current + direction + replyMentionSuggestions.length) % replyMentionSuggestions.length,
      );
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const account = replyMentionSuggestions[Math.min(activeReplyMentionIndex, replyMentionSuggestions.length - 1)];
      if (account) selectReplyMention(account);
    }
  };

  const updateFollowedAccount = (account: NoodleAccount, followed: boolean) => {
    if (!personaAccount || account.id === personaAccount.id) return;
    const currentFollowingAccountIds = readStringArray(personaAccount.settings?.followingAccountIds);
    const nextFollowingAccountIds = followed
      ? Array.from(new Set([...currentFollowingAccountIds, account.id]))
      : currentFollowingAccountIds.filter((id) => id !== account.id);
    const nextFollowedAtByAccount = {
      ...parseRecord(personaAccount.settings?.[NOODLE_FOLLOWED_AT_BY_ACCOUNT_KEY]),
    };
    if (followed) nextFollowedAtByAccount[account.id] = new Date().toISOString();
    else delete nextFollowedAtByAccount[account.id];
    updateAccount.mutate(
      {
        id: personaAccount.id,
        settings: {
          ...personaAccount.settings,
          followingAccountIds: nextFollowingAccountIds,
          [NOODLE_FOLLOWED_AT_BY_ACCOUNT_KEY]: nextFollowedAtByAccount,
        },
      },
      {
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update followed accounts."),
      },
    );
  };

  const submitPost = () => {
    if (!personaAccount || !canSubmitPost) return;
    const content = composerValueRef.current.trim() || draftPoll?.question || "Shared an image.";
    const postingToNoodler = activeNoodleMode === "noodler" && Boolean(personaLinkedNoodlerAccount);
    createPost.mutate(
      {
        authorKind: "persona",
        authorEntityId: personaAccount.entityId,
        ...(postingToNoodler ? { authorAccountId: personaLinkedNoodlerAccount!.id } : {}),
        content,
        imageUrl: attachedImageUrl.trim() || null,
        poll: draftPoll,
        access: postingToNoodler ? composerAccess : "public",
      },
      {
        onSuccess: () => {
          composerValueRef.current = "";
          composerHasTextRef.current = false;
          if (inlineComposerRef.current) inlineComposerRef.current.value = "";
          if (modalComposerRef.current) modalComposerRef.current.value = "";
          setComposer("");
          setComposerHasText(false);
          setActiveMention(null);
          setAttachedImageUrl("");
          setComposerAccess("public");
          setDraftPoll(null);
          setPollQuestion("");
          setPollOptions(["", ""]);
          setActiveComposerTool(null);
          setComposeOpen(false);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not post to Noodle."),
      },
    );
  };

  const submitPrivatePost = () => {
    if (!personaAccount || !viewedProfileAccount || !viewingOwnPrivateAccount) return;
    const content = privateComposerText.trim() || "Shared an image.";
    if (!content && !privateComposerImageUrl.trim()) return;
    const ppvPrice = privateComposerAccess === "ppv" ? Number.parseFloat(privateComposerPpvPrice) : NaN;
    createPost.mutate(
      {
        authorKind: "persona",
        authorEntityId: personaAccount.entityId,
        authorAccountId: viewedProfileAccount.id,
        content,
        imageUrl: privateComposerImageUrl.trim() || null,
        access: privateComposerAccess,
        ...(Number.isFinite(ppvPrice) && ppvPrice >= 0 ? { ppvPrice } : {}),
      },
      {
        onSuccess: () => {
          setPrivateComposerText("");
          setPrivateComposerImageUrl("");
          setPrivateComposerAccess("public");
          setPrivateComposerPpvPrice("");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not post to NoodleR."),
      },
    );
  };

  const reactToPost = (post: NoodlePost, type: "like" | "repost", active = false) => {
    if (!personaAccount) return;
    if (active) {
      removeInteraction.mutate(
        {
          postId: post.id,
          actorKind: "persona",
          actorEntityId: personaAccount.entityId,
          type,
        },
        {
          onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update Noodle post."),
        },
      );
      return;
    }
    createInteraction.mutate(
      {
        postId: post.id,
        actorKind: "persona",
        actorEntityId: personaAccount.entityId,
        type,
        content: null,
      },
      {
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update Noodle post."),
      },
    );
  };

  const voteInPoll = (post: NoodlePost, optionId: string, selectedOptionId: string | null) => {
    if (!personaAccount || optionId === selectedOptionId) return;
    createInteraction.mutate(
      {
        postId: post.id,
        actorKind: "persona",
        actorEntityId: personaAccount.entityId,
        type: "vote",
        content: optionId,
      },
      {
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save your poll vote."),
      },
    );
  };

  const submitReply = (post: NoodlePost) => {
    const replyContent = replyValueRef.current.trim();
    if (!personaAccount || (!replyContent && !replyImageUrl.trim())) return;
    createInteraction.mutate(
      {
        postId: post.id,
        actorKind: "persona",
        actorEntityId: personaAccount.entityId,
        type: "reply",
        content: replyContent || null,
        imageUrl: replyImageUrl.trim() || null,
        parentInteractionId: replyParentInteractionId,
      },
      {
        onSuccess: clearReplyComposer,
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not reply on Noodle."),
      },
    );
  };

  const createInteractionPendingFor = (
    postId: string,
    type: NoodleInteractionType,
    parentInteractionId: string | null = null,
  ) =>
    createInteraction.isPending &&
    createInteraction.variables?.postId === postId &&
    createInteraction.variables.type === type &&
    (createInteraction.variables.parentInteractionId ?? null) === parentInteractionId;

  const removeInteractionPendingFor = (
    postId: string,
    type: "like" | "repost",
    parentInteractionId: string | null = null,
  ) =>
    removeInteraction.isPending &&
    removeInteraction.variables?.postId === postId &&
    removeInteraction.variables.type === type &&
    (removeInteraction.variables.parentInteractionId ?? null) === parentInteractionId;

  const reactionPendingFor = (postId: string, type: "like" | "repost", parentInteractionId: string | null = null) =>
    createInteractionPendingFor(postId, type, parentInteractionId) ||
    removeInteractionPendingFor(postId, type, parentInteractionId);

  const reactToReply = (post: NoodlePost, target: NoodleInteraction, active: boolean) => {
    if (!personaAccount) return;
    const input = {
      postId: post.id,
      actorKind: "persona" as const,
      actorEntityId: personaAccount.entityId,
      type: "like" as const,
      parentInteractionId: target.id,
    };
    if (active) {
      removeInteraction.mutate(input, {
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update comment like."),
      });
      return;
    }
    createInteraction.mutate(
      { ...input, content: null },
      {
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update comment like."),
      },
    );
  };

  const startEditingPost = (post: NoodlePost) => {
    setEditingPostId(post.id);
    setEditingPostContent(post.content);
    setPostMenuId(null);
  };

  const cancelEditingPost = () => {
    setEditingPostId(null);
    setEditingPostContent("");
  };

  const saveEditedPost = (post: NoodlePost) => {
    const content = editingPostContent.trim();
    if (!content) {
      toast.error("Posts cannot be empty.");
      return;
    }
    updatePost.mutate(
      { id: post.id, content },
      {
        onSuccess: () => cancelEditingPost(),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not edit Noodle post."),
      },
    );
  };

  const startEditingReply = (reply: NoodleInteraction) => {
    setEditingReplyId(reply.id);
    setEditingReplyContent(reply.content ?? "");
  };

  const cancelEditingReply = () => {
    setEditingReplyId(null);
    setEditingReplyContent("");
  };

  const saveEditedReply = (post: NoodlePost, reply: NoodleInteraction) => {
    if (!personaAccount) return;
    const content = editingReplyContent.trim();
    if (!content && !reply.imageUrl) {
      toast.error("Comments need text or an image.");
      return;
    }
    updateInteraction.mutate(
      {
        postId: post.id,
        interactionId: reply.id,
        personaId: personaAccount.entityId,
        content,
      },
      {
        onSuccess: cancelEditingReply,
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not edit Noodle comment."),
      },
    );
  };

  const deleteNoodleReply = (post: NoodlePost, reply: NoodleInteraction) => {
    setConfirmAction({
      kind: "delete-reply",
      postId: post.id,
      interactionId: reply.id,
      title: "Delete Noodle Comment",
      message: "This removes the comment and any replies or likes attached to it.",
      confirmLabel: "Delete comment",
    });
  };

  const deleteNoodlePost = (post: NoodlePost) => {
    setPostMenuId(null);
    setConfirmAction({
      kind: "delete-post",
      postId: post.id,
      title: "Delete Noodle Post",
      message: "This removes the post and its likes, reposts, replies, and activity note.",
      confirmLabel: "Delete post",
    });
  };

  const resetTimeline = () => {
    setConfirmAction({
      kind: "reset-timeline",
      title: "Reset Noodle Timeline",
      message:
        "This removes all posts, replies, likes, reposts, activity digests, and refresh records. Profiles, follows, invites, and settings stay.",
      confirmLabel: "Reset timeline",
    });
  };

  const deleteNoodlerProfile = (account: NoodleAccount) => {
    setConfirmAction({
      kind: "delete-noodler-profile",
      accountId: account.id,
      title: "Delete NoodleR Profile",
      message: "This removes the NoodleR profile, its private posts, comments, subscriptions, and unlocks.",
      confirmLabel: "Delete profile",
    });
  };

  const confirmNoodleAction = () => {
    if (!confirmAction) return;
    if (confirmAction.kind === "delete-post") {
      const postId = confirmAction.postId;
      deletePost.mutate(postId, {
        onSuccess: () => {
          if (replyPostId === postId) {
            clearReplyComposer();
          }
          if (editingPostId === postId) cancelEditingPost();
          setConfirmAction(null);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not delete Noodle post."),
      });
      return;
    }
    if (confirmAction.kind === "delete-reply") {
      if (!personaAccount) return;
      const { postId, interactionId } = confirmAction;
      deleteInteraction.mutate(
        { postId, interactionId, personaId: personaAccount.entityId },
        {
          onSuccess: () => {
            if (editingReplyId === interactionId) cancelEditingReply();
            if (replyParentInteractionId === interactionId) clearReplyComposer();
            setConfirmAction(null);
          },
          onError: (error) => toast.error(error instanceof Error ? error.message : "Could not delete Noodle comment."),
        },
      );
      return;
    }
    if (confirmAction.kind === "delete-noodler-profile") {
      const accountId = confirmAction.accountId;
      deletePrivateAccount.mutate(accountId, {
        onSuccess: () => {
          if (viewedProfileAccountId === accountId) setViewedProfileAccountId(personaAccount?.id ?? null);
          if (privateGuideAccountId === accountId) setPrivateGuideAccountId(null);
          setConfirmAction(null);
          toast.success("NoodleR profile deleted.");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not delete NoodleR profile."),
      });
      return;
    }
    if (confirmAction.kind === "uninvite-everybody") {
      clearInvites.mutate(undefined, {
        onSuccess: () => {
          setConfirmAction(null);
          toast.success("Noodle invites cleared.");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not clear Noodle invites."),
      });
      return;
    }
    resetNoodleTimeline.mutate(undefined, {
      onSuccess: () => {
        clearReplyComposer();
        setPostMenuId(null);
        cancelEditingPost();
        cancelEditingReply();
        setConfirmAction(null);
        toast.success("Noodle timeline reset.");
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not reset Noodle timeline."),
    });
  };

  const triggerRefresh = () => {
    if (imagePromptReviewItems.length > 0) return;
    if (!settings?.generationConnectionId) {
      toast.error("Choose a generation connection for Noodle first.");
      return;
    }
    const defaultImageConnectionId = readString(imageConnections.find((connection) => connection.defaultForAgents)?.id);
    if (settings.enableImagePrompts && !settings.imageGenerationConnectionId && !defaultImageConnectionId) {
      toast.error("Choose an image generation connection for Noodle first.");
      return;
    }
    refreshNoodle.mutate(
      { personaId: personaAccount?.entityId, connectionId: settings.generationConnectionId },
      {
        onSuccess: (result) => {
          if (result.imagePromptReviewItems.length > 0) {
            setImagePromptReviewItems(result.imagePromptReviewItems);
            return;
          }
          toast.success("Noodle timeline refreshed.");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not refresh Noodle."),
      },
    );
  };

  const generateGuidedPrivatePost = (account: NoodleAccount) => {
    if (!privateGuideIncludeText && !privateGuideIncludeImage) {
      toast.error("Enable text, image, or both for the NoodleR post.");
      return;
    }
    if (!settings?.generationConnectionId) {
      toast.error("Choose a generation connection for Noodle first.");
      return;
    }
    const defaultImageConnectionId = readString(imageConnections.find((connection) => connection.defaultForAgents)?.id);
    if (privateGuideIncludeImage && !settings.imageGenerationConnectionId && !defaultImageConnectionId) {
      toast.error("Choose an image generation connection for Noodle first.");
      return;
    }
    refreshNoodle.mutate(
      {
        targetAccountId: account.id,
        connectionId: settings.generationConnectionId,
        privatePostGuide: {
          access: privateGuideAccess,
          includeText: privateGuideIncludeText,
          includeImage: privateGuideIncludeImage,
          theme: privateGuideTheme.trim() || undefined,
          prompt: privateGuidePrompt.trim() || undefined,
        },
      },
      {
        onSuccess: (result) => {
          setPrivateGuideAccountId(null);
          setProfileTab("posts");
          if (result.imagePromptReviewItems.length > 0) {
            setImagePromptReviewItems(result.imagePromptReviewItems);
            toast.success("NoodleR post created. Review its image prompt to finish the image.");
            return;
          }
          toast.success(
            result.createdPostIds?.length ? "NoodleR post created." : "NoodleR post generation finished.",
          );
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not generate a NoodleR post."),
      },
    );
  };

  const openGuidedPrivatePost = (account: NoodleAccount) => {
    setPrivateGuideAccess("subscriber");
    setPrivateGuideIncludeText(true);
    setPrivateGuideIncludeImage(true);
    setPrivateGuideTheme("");
    setPrivateGuidePrompt("");
    setPrivateGuideAccountId(account.id);
  };

  const confirmReviewedNoodleImagePrompts = (overrides: ImagePromptOverride[]) => {
    confirmNoodleImagePrompts.mutate(overrides, {
      onSuccess: () => {
        setImagePromptReviewItems([]);
        toast.success("Noodle timeline refreshed.");
      },
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : "Could not generate the reviewed Noodle images."),
    });
  };

  const closeComposeModal = useCallback(() => {
    setComposer(composerValueRef.current);
    setComposeOpen(false);
    setActiveMention(null);
    setActiveComposerTool(null);
  }, []);

  const scrollTimelineToTop = useCallback(() => {
    window.requestAnimationFrame(() => {
      timelineScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  // Single place responsible for clearing NoodleR-scoped state (viewed
  // profile, hub tab) whenever the mode changes or NoodleR access is
  // revoked, so a stale private profile/tab can never survive a mode
  // switch. All mode-changing navigation should go through this instead of
  // hand-rolling a subset of these resets.
  const resetNoodleModeTransientState = useCallback(() => {
    setAccountSwitcherOpen(false);
    setMobileDrawerOpen(false);
    setActiveComposerTool(null);
    setProfileConnectionTab(null);
    setViewedProfileAccountId(null);
    setNoodlerHubTab("timeline");
  }, []);

  const transitionNoodleMode = useCallback(
    (next: NoodleMode) => {
      resetNoodleModeTransientState();
      setActiveNoodleMode(next);
      setActiveNoodleView(next === "noodler" ? "noodler" : "home");
    },
    [resetNoodleModeTransientState],
  );

  // The verification screen is presented with NoodleR chrome even though
  // the feature isn't enabled yet — route every entry point through this
  // so activeNoodleMode never falls out of sync with what's on screen.
  const enterNoodlerVerification = useCallback(() => {
    resetNoodleModeTransientState();
    setActiveNoodleMode("noodler");
    setActiveNoodleView("noodler-verification");
  }, [resetNoodleModeTransientState]);

  const openHomeTimeline = useCallback(() => {
    transitionNoodleMode(activeNoodleMode === "noodler" ? "noodler" : "noodle");
    scrollTimelineToTop();
  }, [transitionNoodleMode, activeNoodleMode, scrollTimelineToTop]);

  // Explicit mode-switch affordances (the Noodle/NoodleR toggle, and the
  // mobile bottom nav's "Home" tab which doubles as that toggle) always
  // land in Noodle mode regardless of what's currently active — unlike
  // openHomeTimeline, which stays in the current mode.
  const switchToNoodleMode = useCallback(() => {
    transitionNoodleMode("noodle");
    scrollTimelineToTop();
  }, [transitionNoodleMode, scrollTimelineToTop]);

  // Safety net: if enableNoodler flips off through a path other than
  // setNoodlerEnabled (e.g. settings refetched after being changed in
  // another tab/device) while still on NoodleR chrome, fall back to Noodle
  // mode instead of leaving stale NoodleR chrome up. The verification
  // screen is exempt — it's intentionally NoodleR-styled while disabled.
  useEffect(() => {
    if (!isNoodlerEnabled && activeNoodleMode === "noodler" && activeNoodleView !== "noodler-verification") {
      transitionNoodleMode("noodle");
    }
  }, [isNoodlerEnabled, activeNoodleMode, activeNoodleView, transitionNoodleMode]);

  const openMobileHomeTimeline = () => {
    setPostSearch("");
    openHomeTimeline();
  };

  const switchToNoodleModeMobile = () => {
    setPostSearch("");
    switchToNoodleMode();
  };

  const openNotificationTarget = (postId: string, interactionId: string | null) => {
    clearReplyComposer();
    setPostSearch("");
    setTimelineTab("main");
    setActiveNoodleView("home");
    setAccountSwitcherOpen(false);
    setMobileDrawerOpen(false);
    setActiveComposerTool(null);
    setProfileConnectionTab(null);
    setNotificationFocusTarget({ postId, interactionId });
  };

  const openSearch = () => {
    setActiveNoodleView("search");
    setTimelineTab("main");
    setAccountSwitcherOpen(false);
    setMobileDrawerOpen(false);
    setActiveComposerTool(null);
    setProfileConnectionTab(null);
    scrollTimelineToTop();
  };

  const openNotifications = () => {
    if (isGlobalPersonaSelected) return;
    if (personaAccount) {
      const readAtKey =
        activeNoodleMode === "noodler" ? NOODLER_NOTIFICATIONS_READ_AT_KEY : NOODLE_NOTIFICATIONS_READ_AT_KEY;
      const overrideKey = activeNoodleMode === "noodler" ? `noodler:${personaAccount.id}` : personaAccount.id;
      const accountId = personaAccount.id;
      const previousOverride = notificationReadOverrides[overrideKey];
      const readAt = new Date().toISOString();
      setNotificationReadOverrides((current) => ({ ...current, [overrideKey]: readAt }));
      updateAccount.mutate(
        {
          id: accountId,
          settings: {
            ...personaAccount.settings,
            [readAtKey]: readAt,
          },
        },
        {
          onSuccess: () => {
            setNotificationReadOverrides((current) => {
              if (current[overrideKey] !== readAt) return current;
              const next = { ...current };
              delete next[overrideKey];
              return next;
            });
          },
          onError: (error) => {
            setNotificationReadOverrides((current) => {
              if (current[overrideKey] !== readAt) return current;
              const next = { ...current };
              if (previousOverride) next[overrideKey] = previousOverride;
              else delete next[overrideKey];
              return next;
            });
            toast.error(error instanceof Error ? error.message : "Could not mark notifications as read.");
          },
        },
      );
    }
    setActiveNoodleView("notifications");
    setAccountSwitcherOpen(false);
    setMobileDrawerOpen(false);
    setActiveComposerTool(null);
    setProfileConnectionTab(null);
  };

  const openSettings = () => {
    if (activeNoodleMode === "noodler" && personaLinkedNoodlerAccount) {
      setViewedProfileAccountId(personaLinkedNoodlerAccount.id);
    }
    setActiveNoodleView("settings");
    setAccountSwitcherOpen(false);
    setMobileDrawerOpen(false);
    setActiveComposerTool(null);
    setProfileConnectionTab(null);
  };

  const setNoodlerEnabled = (enabled: boolean) => {
    if (enabled) {
      enterNoodlerVerification();
      return;
    }
    saveSettings({ enableNoodler: false, noodler: { enableFanActivityScheduler: false } });
    // Always reset, not just when currently in NoodleR mode — otherwise a
    // stale viewedProfileAccountId/noodlerHubTab from an earlier visit can
    // survive disabling the feature.
    transitionNoodleMode("noodle");
  };

  const openNoodlerHub = () => {
    if (!isNoodlerEnabled) {
      enterNoodlerVerification();
      return;
    }
    transitionNoodleMode("noodler");
  };

  const normalizedInviteSearch = inviteSearch.trim().toLowerCase();
  const filteredCharacters = useMemo(
    () =>
      characters
        .filter((character) => readString(character.id))
        .filter((character) => (settings?.allowProfessorMari ?? true) || readString(character.id) !== PROFESSOR_MARI_ID)
        .filter((character) => characterName(character).toLowerCase().includes(normalizedInviteSearch))
        .sort((left, right) => characterName(left).localeCompare(characterName(right))),
    [characters, normalizedInviteSearch, settings?.allowProfessorMari],
  );
  const visibleInviteCharacters = filteredCharacters.slice(0, inviteCharacterLimit);
  const hasMoreInviteCharacters = filteredCharacters.length > visibleInviteCharacters.length;
  const filteredCharacterGroups = useMemo(
    () =>
      characterGroups
        .filter((group) => readString(group.id))
        .filter((group) => characterGroupName(group).toLowerCase().includes(normalizedInviteSearch))
        .sort((left, right) => characterGroupName(left).localeCompare(characterGroupName(right)))
        .slice(0, 24),
    [characterGroups, normalizedInviteSearch],
  );
  const carryoverTargets = useMemo(
    () => new Set(settings?.carryoverModes ?? carryoverTargetsFromLegacy(settings?.carryoverMode)),
    [settings?.carryoverMode, settings?.carryoverModes],
  );

  const toggleCharacterGroupInvite = (groupId: string) => {
    if (!settings) return;
    const current = settings.invitedCharacterGroupIds ?? [];
    const next = current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId];
    saveSettings({ invitedCharacterGroupIds: next });
  };

  const inviteSelectedFolderCharacters = () => {
    if (uninvitedSelectedFolderCharacterIds.length === 0) {
      toast.info("Selected folder characters are already invited.");
      return;
    }
    inviteCharacters.mutate(uninvitedSelectedFolderCharacterIds, {
      onSuccess: (accounts) => {
        toast.success(
          `Invited ${accounts.length} ${accounts.length === 1 ? "character" : "characters"} from selected folders.`,
        );
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not invite folder characters."),
    });
  };

  const uninviteEverybody = () => {
    setConfirmAction({
      kind: "uninvite-everybody",
      title: "Uninvite Everybody",
      message: "This removes all direct Noodle character invites, clears selected invite folders, and turns off random users.",
      confirmLabel: "Uninvite everybody",
    });
  };

  const toggleCarryoverTarget = (target: NoodleCarryoverTarget, checked: boolean) => {
    if (!settings) return;
    const current = new Set(settings.carryoverModes ?? carryoverTargetsFromLegacy(settings.carryoverMode));
    if (checked) current.add(target);
    else current.delete(target);
    const next = NOODLE_CARRYOVER_TARGETS.filter((mode) => current.has(mode));
    saveSettings({
      carryoverModes: next,
      carryoverMode: legacyCarryoverModeFromTargets(next),
    });
  };

  useEffect(() => {
    if (!composeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeComposeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composeOpen, closeComposeModal]);

  useEffect(() => {
    if (!accountSwitcherOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountSwitcherOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (accountSwitcherRef.current?.contains(event.target)) return;
      setAccountSwitcherOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [accountSwitcherOpen]);

  const settingsContent = (
    <>
      <Section
        title="Invites"
        help="Choose who can participate in Noodle refreshes. Direct character invites, selected character folders, and optional random users form the pool the generator can draw from."
      >
        <div className="space-y-4">
          <ToggleSetting
            label="Professor Mari participates"
            help="When off, Professor Mari is hidden from Noodle account discovery and excluded from future generated posts, replies, reactions, mentions, profiles, and chat carryover. Existing timeline history is preserved."
            checked={settings?.allowProfessorMari ?? true}
            disabled={!settings || updateSettings.isPending}
            onChange={(checked) => saveSettings({ allowProfessorMari: checked })}
          />

          <label className="block space-y-1.5">
            <FieldLabel help="Filters both character folders and individual characters in this invite section.">
              Characters to Invite
            </FieldLabel>
            <input
              value={inviteSearch}
              onChange={(event) => setInviteSearch(event.target.value)}
              className={fieldClass}
              placeholder="Search characters or folders"
            />
          </label>

          {characterGroups.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setInviteFoldersOpen((open) => !open)}
                className="flex w-full items-center gap-2 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-3 py-2 text-left text-xs transition-colors hover:border-[var(--noodle-blue)]/60"
                aria-expanded={inviteFoldersOpen}
              >
                <FolderOpen size={15} className="shrink-0 text-[var(--noodle-blue)]" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Add from Folder</span>
                  <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                    Invite every character in selected folders.
                  </span>
                </span>
                <ChevronRight
                  size={15}
                  className={cn(
                    "shrink-0 text-[var(--muted-foreground)] transition-transform",
                    inviteFoldersOpen && "rotate-90",
                  )}
                />
              </button>
              {inviteFoldersOpen && (
                <div className="overflow-hidden rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)]">
                  <div className="max-h-44 space-y-2 overflow-y-auto p-2 [scrollbar-gutter:stable]">
                    {filteredCharacterGroups.length > 0 ? (
                      filteredCharacterGroups.map((group) => {
                        const id = readString(group.id);
                        const name = characterGroupName(group);
                        const memberCount = readStringArray(group.characterIds).length;
                        const selected = selectedCharacterGroupIds.has(id);
                        const description = readString(group.description).trim();
                        return (
                          <label
                            key={id}
                            className="flex items-center gap-3 rounded-md p-2 text-xs hover:bg-foreground/5"
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={!settings || updateSettings.isPending}
                              onChange={() => toggleCharacterGroupInvite(id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold">{name}</span>
                              <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                                {memberCount} {memberCount === 1 ? "character" : "characters"}
                                {description ? `, ${description}` : ""}
                              </span>
                            </span>
                          </label>
                        );
                      })
                    ) : (
                      <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No matching folders.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={inviteSelectedFolderCharacters}
                    disabled={
                      !settings ||
                      updateSettings.isPending ||
                      inviteCharacters.isPending ||
                      uninvitedSelectedFolderCharacterIds.length === 0
                    }
                    className="flex min-h-10 w-full items-center justify-center gap-2 border-t border-[var(--marinara-chat-chrome-panel-border)] px-3 py-2 text-xs font-semibold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {inviteCharacters.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <UserPlus size={14} />
                    )}
                    {folderInviteButtonLabel}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel help="Directly invited characters are eligible regardless of folder selection and get priority in Noodle suggestions and generated activity.">
                Characters
              </FieldLabel>
              <button
                type="button"
                onClick={uninviteEverybody}
                disabled={
                  !settings ||
                  updateSettings.isPending ||
                  inviteCharacter.isPending ||
                  inviteCharacters.isPending ||
                  removeCharacter.isPending ||
                  clearInvites.isPending ||
                  !hasActiveInvites
                }
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--destructive)]/35 px-3 text-[0.68rem] font-semibold text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {clearInvites.isPending ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />}
                Uninvite everybody
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] [scrollbar-gutter:stable]">
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b border-[var(--marinara-chat-chrome-panel-border)] p-2 text-left transition-colors hover:bg-foreground/5"
                disabled={!settings || updateSettings.isPending}
                onClick={() => saveSettings({ allowRandomUsers: !(settings?.allowRandomUsers ?? false) })}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--noodle-blue)]/10 text-[var(--noodle-blue)]">
                  <Dices size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Random users</span>
                  <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                    {(settings?.allowRandomUsers ?? false) ? "Enabled" : "Ambient fake profiles"}
                  </span>
                </span>
                <span className={iconButtonClass}>
                  {(settings?.allowRandomUsers ?? false) ? <UserMinus size={15} /> : <UserPlus size={15} />}
                </span>
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between border-b border-[var(--marinara-chat-chrome-panel-border)] px-2 py-1.5 text-left text-[0.68rem] font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-foreground/5"
                onClick={() => setFillerAccountsExpanded((expanded) => !expanded)}
              >
                <span>Manage random user roster</span>
                <span>{fillerAccountsExpanded ? "Hide" : "Show"}</span>
              </button>
              {fillerAccountsExpanded && (
                <div className="space-y-1.5 border-b border-[var(--marinara-chat-chrome-panel-border)] p-2">
                  {fillerProfilesQuery.isLoading && (
                    <p className="text-[0.68rem] text-[var(--muted-foreground)]">Loading…</p>
                  )}
                  {fillerProfiles.map((profile) => (
                    <div key={profile.id} className="flex items-center gap-2 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] p-1.5">
                      <input
                        type="checkbox"
                        checked={profile.enabled}
                        onChange={(event) =>
                          updateFillerProfile.mutate({ id: profile.id, enabled: event.target.checked })
                        }
                        disabled={updateFillerProfile.isPending}
                      />
                      <input
                        value={profile.displayName}
                        onChange={(event) =>
                          updateFillerProfile.mutate({ id: profile.id, displayName: event.target.value })
                        }
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs font-semibold focus:border-[var(--noodle-divider)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => deleteFillerProfile.mutate(profile.id)}
                        disabled={deleteFillerProfile.isPending}
                        className="shrink-0 rounded-full p-1 text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Delete ${profile.displayName}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      value={newFillerAccountName}
                      onChange={(event) => setNewFillerAccountName(event.target.value)}
                      placeholder="New filler account name…"
                      className={cn(fieldClass, "h-7 flex-1 text-xs")}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const displayName = newFillerAccountName.trim();
                        if (!displayName) return;
                        createFillerProfile.mutate(
                          { displayName, bio: "", enabled: true },
                          { onSuccess: () => setNewFillerAccountName("") },
                        );
                      }}
                      disabled={createFillerProfile.isPending || !newFillerAccountName.trim()}
                      className="h-7 shrink-0 rounded-full bg-[var(--noodle-blue)] px-3 text-[0.68rem] font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
              {visibleInviteCharacters.map((character) => {
                const id = readString(character.id);
                const name = characterName(character);
                const account = characterAccountByEntity.get(id);
                const invited = account?.invited === true;
                const includedByFolder = folderInvitedCharacterIds.has(id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 border-b border-[var(--marinara-chat-chrome-panel-border)] p-2 last:border-b-0"
                  >
                    <Avatar
                      account={{
                        displayName: name,
                        avatarUrl: readString(character.avatarPath) || null,
                        avatarCrop: rawCharacterAvatarCrop(character),
                      }}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{name}</p>
                      <p className="text-[0.68rem] text-[var(--muted-foreground)]">
                        {invited ? "Invited" : includedByFolder ? "Included by folder" : "Not invited"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={iconButtonClass}
                      disabled={inviteCharacter.isPending || removeCharacter.isPending}
                      onClick={() =>
                        invited
                          ? removeCharacter.mutate(id, {
                              onError: (error) =>
                                toast.error(error instanceof Error ? error.message : "Could not remove invite."),
                            })
                          : inviteCharacter.mutate(id, {
                              onError: (error) =>
                                toast.error(error instanceof Error ? error.message : "Could not invite character."),
                            })
                      }
                      title={invited ? "Remove direct invite" : "Invite directly"}
                    >
                      {invited ? <UserMinus size={15} /> : <UserPlus size={15} />}
                    </button>
                  </div>
                );
              })}
              {filteredCharacters.length === 0 && (
                <p className="px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">No matching characters.</p>
              )}
              {hasMoreInviteCharacters && (
                <button
                  type="button"
                  onClick={() => setInviteCharacterLimit((limit) => limit + NOODLE_INVITE_PAGE_SIZE)}
                  className="w-full px-3 py-2 text-xs font-semibold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
                >
                  Load more ({visibleInviteCharacters.length} of {filteredCharacters.length})
                </button>
              )}
            </div>
          </div>
        </div>
      </Section>

      {settings && (
        <>
          <Section
            title="Refresh"
            help="Controls the model connection and how often Noodle can create a fresh timeline update."
          >
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <FieldLabel help="The text-generation connection used to write new Noodle posts, replies, reposts, likes, and activity digests.">
                  Generation connection
                </FieldLabel>
                <select
                  value={settings.generationConnectionId ?? ""}
                  onChange={(event) => saveSettings({ generationConnectionId: event.target.value || null })}
                  className={fieldClass}
                >
                  <option value="">Choose connection</option>
                  {connections.map((connection) => (
                    <option key={String(connection.id)} value={String(connection.id)}>
                      {String(connection.name ?? connection.model ?? "Connection")}
                    </option>
                  ))}
                </select>
              </label>
              <NumberSetting
                label="Refreshes/day"
                help="How many automatic timeline refreshes Noodle schedules per local day. Refreshes are spread across the day with one randomized time in each window. Set 0 to turn them off."
                value={settings.refreshesPerDay}
                min={0}
                max={24}
                onCommit={(value) => saveSettings({ refreshesPerDay: value })}
              />
              {scheduler && (
                <div
                  className="rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--noodle-blue)]/5 px-3 py-2.5 text-xs"
                  data-component="NoodleView.RefreshSchedule"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 font-semibold text-[var(--foreground)]">
                      <RefreshCw size={14} />
                      Automatic schedule
                    </span>
                    {scheduler.refreshesPerDay > 0 && (
                      <span className="shrink-0 text-[var(--muted-foreground)]">
                        {scheduler.completedSlots}/{scheduler.refreshesPerDay} slots
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 leading-5 text-[var(--muted-foreground)]">{noodleSchedulerSummary(scheduler)}</p>
                  {(scheduler.timezone === "Etc/Unknown" || scheduler.timezone === "local") && (
                    <div
                      className="mt-2 flex gap-2 rounded-md bg-[var(--destructive)]/10 px-2.5 py-2 leading-5 text-[var(--foreground)]"
                      role="alert"
                    >
                      <AlertTriangle className="mt-0.5 shrink-0 text-[var(--destructive)]" size={14} />
                      <p>
                        The server timezone could not be detected. Remove a blank <code>TZ=</code> from your{" "}
                        <code>.env</code>, or set an IANA timezone such as <code>TZ=Europe/Warsaw</code>, then restart
                        Marinara.
                      </p>
                    </div>
                  )}
                  {scheduler.scheduledTimes.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[0.68rem] font-semibold text-[var(--muted-foreground)]">
                        Planned times ({scheduler.timezone})
                      </p>
                      <div className="mt-1 max-h-52 divide-y divide-[var(--noodle-divider)] overflow-y-auto border-y border-[var(--noodle-divider)]">
                        {scheduler.scheduledTimes.map((time, index) => {
                          const completed = (scheduler.completedTimes ?? []).includes(time);
                          const editing = editingRefreshTime === time;
                          const originalClockTime = formatNoodleRefreshTimeInput(time, scheduler.timezone);
                          return (
                            <div
                              key={time}
                              className="flex min-h-10 items-center gap-2 py-1.5"
                              data-noodle-schedule-slot={time}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="mr-2 text-[var(--muted-foreground)]">{index + 1}.</span>
                                <span className="font-semibold text-[var(--foreground)]">
                                  {formatNoodleRefreshTime(time, scheduler.timezone)}
                                </span>
                              </span>
                              {completed ? (
                                <span className="shrink-0 text-[0.65rem] font-semibold text-[var(--muted-foreground)]">
                                  Completed
                                </span>
                              ) : editing ? (
                                <div className="flex shrink-0 items-center gap-1">
                                  <input
                                    type="time"
                                    value={refreshTimeDraft}
                                    onChange={(event) => setRefreshTimeDraft(event.target.value)}
                                    aria-label={`New time for refresh ${index + 1}`}
                                    className="mari-chrome-field h-8 w-[6.5rem] rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--noodle-blue)]"
                                  />
                                  <button
                                    type="button"
                                    onClick={cancelRefreshTimeEdit}
                                    disabled={rescheduleRefresh.isPending}
                                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:opacity-50"
                                    title="Cancel"
                                    aria-label="Cancel reschedule"
                                  >
                                    <X size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={saveRefreshTimeEdit}
                                    disabled={
                                      rescheduleRefresh.isPending ||
                                      !refreshTimeDraft ||
                                      refreshTimeDraft === originalClockTime
                                    }
                                    className="h-8 rounded-full bg-[var(--noodle-blue)] px-3 text-[0.68rem] font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {rescheduleRefresh.isPending ? "Saving" : "Save"}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => beginRefreshTimeEdit(time)}
                                  disabled={rescheduleRefresh.isPending}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:opacity-50"
                                  title={`Reschedule ${formatNoodleRefreshTime(time, scheduler.timezone)}`}
                                  aria-label={`Reschedule refresh ${index + 1}`}
                                >
                                  <Pencil size={14} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {scheduler.lastError && (
                    <p className="mt-1 line-clamp-2 leading-5 text-[var(--noodle-blue)]" title={scheduler.lastError}>
                      Waiting: {scheduler.lastError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Section>

          <Section
            title="NoodleR Access"
            help="Controls whether the private NoodleR side of Noodle is available from the mode switcher and mobile navigation."
          >
            <div className="space-y-3">
              <ToggleSetting
                label="Enable NoodleR"
                help="Unlocks the private creator network mode. The first activation runs a completely serious verification screen."
                checked={isNoodlerEnabled}
                disabled={updateSettings.isPending}
                onChange={setNoodlerEnabled}
              />
              <ToggleSetting
                label="Allow global feed persona"
                help="Adds a 'Global' entry to the account switcher that shows every post across all personas, in both Noodle and NoodleR."
                checked={settings?.allowGlobalPersona === true}
                disabled={updateSettings.isPending}
                onChange={(enabled) => saveSettings({ allowGlobalPersona: enabled })}
              />
              {!isNoodlerEnabled && (
                <p className="rounded-md border border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/5 px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
                  NoodleR stays tucked away until this is enabled. Attempts to enter NoodleR will open verification first.
                </p>
              )}
              <button
                type="button"
                onClick={enterNoodlerVerification}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--noodle-divider)] px-3 text-xs font-bold transition-colors hover:bg-[var(--accent)]"
              >
                <Lock size={14} />
                Test verification screen
              </button>
              {isNoodlerEnabled && (
                <p className="rounded-md border border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/5 px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
                  Your page's stage identity, subscription pricing, and fan activity now live under NoodleR settings
                  — switch to NoodleR mode and open Settings there.
                </p>
              )}
            </div>
          </Section>

          <Section
            title="Active Accounts"
            help="Controls how many eligible characters or random users are active during one generation of the timeline."
          >
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <FieldLabel help="Selects how many invited characters or random users are active during one timeline generation. All uses every eligible account, Random range chooses between Min active and Max active, and Exact count uses one fixed count.">
                  Active selection
                </FieldLabel>
                <select
                  value={settings.participantSelectionMode}
                  onChange={(event) =>
                    saveSettings({
                      participantSelectionMode: event.target
                        .value as NoodleSettingsUpdateInput["participantSelectionMode"],
                    })
                  }
                  className={fieldClass}
                >
                  <option value="random_range">Random range</option>
                  <option value="exact">Exact count</option>
                  <option value="all">All invited</option>
                </select>
              </label>
              {settings.participantSelectionMode === "random_range" && (
                <div className="grid grid-cols-2 gap-2">
                  <NumberSetting
                    label="Min active"
                    help="Lowest number of eligible character or random-user accounts that can participate in one timeline generation."
                    value={settings.participantMin}
                    min={1}
                    max={100}
                    onCommit={(value) => saveSettings({ participantMin: value })}
                  />
                  <NumberSetting
                    label="Max active"
                    help="Highest number of eligible character or random-user accounts that can participate in one timeline generation."
                    value={settings.participantMax}
                    min={1}
                    max={100}
                    onCommit={(value) => saveSettings({ participantMax: value })}
                  />
                </div>
              )}
              {settings.participantSelectionMode === "exact" && (
                <NumberSetting
                  label="Active count"
                  help="Exact number of eligible character or random-user accounts that participate in one timeline generation."
                  value={settings.participantMax}
                  min={1}
                  max={100}
                  onCommit={(value) => saveSettings({ participantMin: value, participantMax: value })}
                />
              )}
            </div>
          </Section>

          <Section title="Activity" help="Limits how much generated Noodle activity one refresh may create.">
            <div className="grid grid-cols-2 gap-2">
              <NumberSetting
                label="Posts"
                help="Maximum new top-level posts the model may create in one refresh."
                value={settings.maxGeneratedPostsPerRefresh}
                min={0}
                max={100}
                onCommit={(value) => saveSettings({ maxGeneratedPostsPerRefresh: value })}
              />
              <NumberSetting
                label="Replies"
                help="Maximum reply interactions the model may add in one refresh."
                value={settings.maxRepliesPerRefresh}
                min={0}
                max={200}
                onCommit={(value) => saveSettings({ maxRepliesPerRefresh: value })}
              />
              <NumberSetting
                label="Reposts"
                help="Maximum repost interactions the model may add in one refresh."
                value={settings.maxRepostsPerRefresh}
                min={0}
                max={100}
                onCommit={(value) => saveSettings({ maxRepostsPerRefresh: value })}
              />
              <NumberSetting
                label="Likes"
                help="Maximum like interactions the model may add in one refresh."
                value={settings.maxLikesPerRefresh}
                min={0}
                max={500}
                onCommit={(value) => saveSettings({ maxLikesPerRefresh: value })}
              />
            </div>
          </Section>

          <Section
            title="Image Generation"
            help="Controls generated post images and whether characters can reuse existing gallery images."
          >
            <div className="space-y-3">
              <ToggleSetting
                label="Image generation"
                help="Generates actual post images from Noodle visual requests, using image connection defaults and the global image style profile system."
                checked={settings.enableImagePrompts}
                disabled={updateSettings.isPending}
                onChange={(checked) => saveSettings({ enableImagePrompts: checked })}
              />
              {settings.enableImagePrompts && (
                <>
                  <label className="block space-y-1.5">
                    <FieldLabel help="The image-generation connection used to create Noodle post images. Leaving it as Default uses the connection marked default for image generation.">
                      Image generation connection
                    </FieldLabel>
                    <select
                      value={settings.imageGenerationConnectionId ?? ""}
                      onChange={(event) => saveSettings({ imageGenerationConnectionId: event.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">Default image generation connection</option>
                      {imageConnections.map((connection) => (
                        <option key={String(connection.id)} value={String(connection.id)}>
                          {String(connection.name ?? connection.model ?? "Image connection")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <FieldLabel help="Extra instructions passed into the Noodle Post Image prompt override. The full template is also available in Settings, Generations, Image Generation Prompt Overrides.">
                      Prompt instructions
                    </FieldLabel>
                    <textarea
                      value={imageGenerationPromptDraft}
                      onChange={(event) => setImageGenerationPromptDraft(event.target.value)}
                      onBlur={() => {
                        if (imageGenerationPromptDraft !== settings.imageGenerationPrompt) {
                          saveSettings({ imageGenerationPrompt: imageGenerationPromptDraft });
                        }
                      }}
                      className={textareaClass}
                    />
                  </label>
                  <ToggleSetting
                    label="Use avatar references"
                    help="Sends character avatars or preferred full-body references to the image provider when a character's post image is generated."
                    checked={settings.imageGenerationUseAvatarReferences}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => saveSettings({ imageGenerationUseAvatarReferences: checked })}
                  />
                  <ToggleSetting
                    label="Include descriptions"
                    help="Adds character appearance and description notes to the final image prompt before style-profile compilation."
                    checked={settings.imageGenerationIncludeDescriptions}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => saveSettings({ imageGenerationIncludeDescriptions: checked })}
                  />
                  <NumberSetting
                    label="Images/refresh"
                    help="Maximum number of generated post images Noodle may create during each manual or automatic timeline refresh."
                    value={settings.maxImagesPerRefresh}
                    min={0}
                    max={50}
                    onCommit={(value) => saveSettings({ maxImagesPerRefresh: value })}
                  />
                </>
              )}
              <ToggleSetting
                label="Attach gallery images"
                help="Lets characters attach existing images from their own galleries or chats they are in when the timeline writer asks for a gallery attachment."
                checked={settings.allowGalleryImageAttachments}
                disabled={updateSettings.isPending}
                onChange={(checked) => saveSettings({ allowGalleryImageAttachments: checked })}
              />
            </div>
          </Section>

          <Section
            title="Image Understanding"
            help="Lets a vision-capable connection describe timeline images for the Noodle writer, including text-only models."
          >
            <div className="space-y-3">
              <ToggleSetting
                label="Image captioning"
                help="Converts timeline images into concise descriptions before refresh generation, so text-only models can understand what was posted."
                checked={settings.imageCaptioningEnabled}
                disabled={updateSettings.isPending || connections.length === 0}
                onChange={(checked) => saveSettings({ imageCaptioningEnabled: checked })}
              />
              {settings.imageCaptioningEnabled && (
                <label className="block space-y-1.5">
                  <FieldLabel help="Choose a vision-capable text connection. Default uses the Noodle generation connection; select another connection when that model cannot see images.">
                    Captioning connection
                  </FieldLabel>
                  <select
                    value={settings.imageCaptioningConnectionId ?? ""}
                    onChange={(event) => saveSettings({ imageCaptioningConnectionId: event.target.value || null })}
                    className={fieldClass}
                  >
                    <option value="">Use Noodle generation connection</option>
                    {connections.map((connection) => (
                      <option key={String(connection.id)} value={String(connection.id)}>
                        {String(connection.name ?? connection.model ?? "Connection")}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </Section>

          <Section title="Appearance" help="Controls how the timeline and profiles render posts.">
            <label className="block space-y-1.5">
              <FieldLabel help="Timeline shows posts as Twitter-style cards. Grid shows an image-first, Instagram-style grid on the main feed and on profile tabs (posts without an image are skipped in Grid).">
                Feed layout
              </FieldLabel>
              <select
                value={settings.layout}
                onChange={(event) => saveSettings({ layout: event.target.value as NoodleSettingsUpdateInput["layout"] })}
                className={fieldClass}
              >
                <option value="timeline">Timeline</option>
                <option value="grid">Grid</option>
              </select>
            </label>
          </Section>

          <Section
            title="Timeline Writing"
            help="Tunes how the refresh writer approaches tone and long-term memory. Off by default; existing timelines keep their current behavior until you turn this on."
          >
            <div className="space-y-3">
              <ToggleSetting
                label="Enhanced tone & continuity"
                help="When on: each account's voice is grounded more strongly in its own personality instead of a default upbeat tone, accounts are encouraged to react to each other's posts in the same refresh, and older-post recall happens more often and favors posts relevant to currently active accounts. When off, refreshes use the original tone and recall behavior. The Noodle Timeline Voice & Tone prompt override (Settings -> Generations -> Image Generation Prompt Overrides) still lets you rewrite the tone text directly regardless of this toggle."
                checked={settings.enableEnhancedTimelineWriting}
                disabled={updateSettings.isPending}
                onChange={(checked) => saveSettings({ enableEnhancedTimelineWriting: checked })}
              />
            </div>
          </Section>

          <Section
            title="World / Lore"
            help="Lets Noodle refreshes pull matching lorebook entries into the timeline prompt, the same lorebook system used by chat generation."
          >
            <div className="space-y-3">
              <ToggleSetting
                label="Lorebook context"
                help="Scans recent Noodle activity and character profiles for lorebook keyword matches and includes them as world/lore context. Off by default; existing timelines are unaffected until you turn this on."
                checked={settings.enableLorebookContext}
                disabled={updateSettings.isPending}
                onChange={(checked) => saveSettings({ enableLorebookContext: checked })}
              />
            </div>
          </Section>

          <Section
            title="Carryover"
            help="Controls whether recent Noodle activity is appended to chat, roleplay, or game context."
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <FieldLabel help="Toggle each mode that should receive recent Noodle activity involving the current persona or chat characters. When all three are off, nothing is carried into chat context.">
                  Carryover to chats
                </FieldLabel>
                <div className="grid gap-2 sm:grid-cols-3">
                  <ToggleSetting
                    label="Conversations"
                    checked={carryoverTargets.has("conversation")}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => toggleCarryoverTarget("conversation", checked)}
                  />
                  <ToggleSetting
                    label="Roleplays"
                    checked={carryoverTargets.has("roleplay")}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => toggleCarryoverTarget("roleplay", checked)}
                  />
                  <ToggleSetting
                    label="Games"
                    checked={carryoverTargets.has("game")}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => toggleCarryoverTarget("game", checked)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberSetting
                  label="Carry hours"
                  help="How far back Noodle looks for activity digests when adding recent social media context to chats."
                  value={settings.carryoverHours}
                  min={1}
                  max={720}
                  onCommit={(value) => saveSettings({ carryoverHours: value })}
                />
                <NumberSetting
                  label="Carry items"
                  help="Maximum number of recent Noodle activity summaries appended to a chat context."
                  value={settings.carryoverMaxItems}
                  min={1}
                  max={50}
                  onCommit={(value) => saveSettings({ carryoverMaxItems: value })}
                />
              </div>
            </div>
          </Section>

          <Section
            title="Reset Noodle"
            help="Clears timeline content while keeping profiles, follows, invites, and Noodle settings."
          >
            <button
              type="button"
              onClick={resetTimeline}
              disabled={resetNoodleTimeline.isPending}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition-colors hover:border-[var(--noodle-blue)]/60 hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resetNoodleTimeline.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} className="text-[var(--noodle-blue)]" />
              )}
              {resetNoodleTimeline.isPending ? "Resetting Noodle" : "Reset Noodle Timeline"}
            </button>
          </Section>
        </>
      )}
    </>
  );

  const noodlerSettingsContent = (
    <>
      <Section
        title="NoodleR Access"
        help="Controls whether the private NoodleR side of Noodle is available from the mode switcher and mobile navigation."
      >
        <div className="space-y-3">
          <ToggleSetting
            label="Enable NoodleR"
            help="Unlocks the private creator network mode. Turning this off exits NoodleR mode immediately."
            checked={isNoodlerEnabled}
            disabled={updateSettings.isPending}
            onChange={setNoodlerEnabled}
          />
          <ToggleSetting
            label="Allow global feed persona"
            help="Adds a 'Global' entry to the account switcher that shows every post across all personas, in both Noodle and NoodleR."
            checked={settings?.allowGlobalPersona === true}
            disabled={updateSettings.isPending}
            onChange={(enabled) => saveSettings({ allowGlobalPersona: enabled })}
          />
        </div>
      </Section>

      <Section
        title="NoodleR Fan Activity"
        help="Global kill switch for unattended fan activity across every NoodleR (private) page. Off by default. Even a page with its own auto-schedule toggle on stays dormant until this is also on; turning this off freezes every page's scheduled activity at once."
      >
        <div className="space-y-3">
          <ToggleSetting
            label="Enable NoodleR fan activity"
            help="Lets the fan-activity scheduler run unattended for any NoodleR page that has both fan activity and its own auto-schedule toggle turned on. Manual 'Simulate fan activity now' is unaffected by this switch either way."
            checked={settings?.noodler.enableFanActivityScheduler ?? false}
            disabled={!settings || updateSettings.isPending || !isNoodlerEnabled}
            onChange={(checked) => saveSettings({ noodler: { enableFanActivityScheduler: checked } })}
          />
        </div>
      </Section>

      {viewedProfileAccount && viewingOwnPrivateAccount ? (
        <>
          <Section title="Stage profile" help="Controls the private creator identity shown on your NoodleR page.">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <FieldLabel help="&quot;Secret&quot; filters the linked name out of generated posts/images — it's AI-generated content moderation, not a hard guarantee it can never slip through.">
                    Identity
                  </FieldLabel>
                  <select
                    value={stageProfileDisclosure}
                    onChange={(event) =>
                      setStageProfileDisclosure(event.target.value as NoodlePrivateIdentityDisclosure)
                    }
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
          </Section>

          <Section title="Monetization" help="Subscription pricing and pay-per-view bundling for your NoodleR page.">
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={viewedProfileAccount.settings?.subscriptionIncludesPpv === true}
                  onChange={(event) =>
                    updateAccount.mutate({
                      id: viewedProfileAccount.id,
                      settings: { subscriptionIncludesPpv: event.target.checked },
                    })
                  }
                  disabled={updateAccount.isPending}
                />
                <span>
                  Subscribers automatically unlock pay-per-post content too. Off by default — subscribers still have
                  to unlock each pay-per-post individually.
                </span>
              </label>
              <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span className="shrink-0 font-semibold text-[var(--foreground)]">Subscription price</span>
                <span>$</span>
                <input
                  key={viewedProfileAccount.id}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={
                    typeof viewedProfileAccount.settings?.subscriptionPrice === "number"
                      ? (viewedProfileAccount.settings.subscriptionPrice as number)
                      : ""
                  }
                  placeholder="9.99"
                  onBlur={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    updateAccount.mutate({
                      id: viewedProfileAccount.id,
                      settings: { subscriptionPrice: Number.isFinite(value) && value >= 0 ? value : null },
                    });
                  }}
                  className={cn(fieldClass, "h-8 w-24")}
                />
                <span>/mo · shown to fans, no real payment is processed</span>
              </label>
            </div>
          </Section>

          <Section
            title="Relationships & privacy"
            help="Who this character knows, and who this private page should stay invisible to — separate from the public account's own visibility."
          >
            <div className="space-y-4">
              {(() => {
                const linkedPublicAccount = accounts.find(
                  (account) => account.linkedAccountId === viewedProfileAccount.id,
                );
                const linkedKnownAccountIds = linkedPublicAccount?.settings?.social as
                  | { knownAccountIds?: unknown }
                  | undefined;
                const knownAccountIds = new Set(
                  Array.isArray(linkedKnownAccountIds?.knownAccountIds)
                    ? (linkedKnownAccountIds!.knownAccountIds as string[])
                    : [],
                );
                const hiddenFromSetting = viewedProfileAccount.settings?.hiddenFrom as
                  | { hiddenFromAccountIds?: unknown }
                  | undefined;
                const hiddenFromIds = new Set(
                  Array.isArray(hiddenFromSetting?.hiddenFromAccountIds)
                    ? (hiddenFromSetting!.hiddenFromAccountIds as string[])
                    : [],
                );
                const otherPublicAccounts = accounts.filter(
                  (account) => account.visibility === "public" && account.id !== linkedPublicAccount?.id,
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
                    id: viewedProfileAccount.id,
                    settings: { hiddenFrom: { hiddenFromAccountIds: Array.from(next) } },
                  });
                };
                return (
                  <>
                    <div>
                      <p className="text-xs font-semibold text-[var(--foreground)]">People this character knows</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        Biases who this character's public account tries to interact with. Doesn't restrict anyone
                        else — just a preference.
                      </p>
                      {!linkedPublicAccount ? (
                        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                          No linked public account found for this page.
                        </p>
                      ) : (
                        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--noodle-divider)] p-2">
                          {otherPublicAccounts.map((account) => (
                            <label
                              key={account.id}
                              className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[var(--accent)]"
                            >
                              <input
                                type="checkbox"
                                checked={knownAccountIds.has(account.id)}
                                onChange={() => toggleKnown(account.id)}
                                disabled={updateAccount.isPending}
                              />
                              <span className="truncate">
                                {account.displayName} <span className="text-[var(--muted-foreground)]">@{account.handle}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[var(--foreground)]">Hide this page from</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        These accounts will never see or be shown this page, even in Discover — separate from any
                        other private page linked to a different account.
                      </p>
                      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--noodle-divider)] p-2">
                        {otherPublicAccounts.map((account) => (
                          <label
                            key={account.id}
                            className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[var(--accent)]"
                          >
                            <input
                              type="checkbox"
                              checked={hiddenFromIds.has(account.id)}
                              onChange={() => toggleHidden(account.id)}
                              disabled={updateAccount.isPending}
                            />
                            <span className="truncate">
                              {account.displayName} <span className="text-[var(--muted-foreground)]">@{account.handle}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </Section>

          <Section
            title="Fan activity"
            help="Lets existing filler accounts like, comment on, subscribe to, and unlock this page's posts on their own. Fans never write new posts — only you do that."
          >
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={readFanActivityEnabled(viewedProfileAccount)}
                  onChange={(event) =>
                    updateAccount.mutate({
                      id: viewedProfileAccount.id,
                      settings: {
                        fanActivity: {
                          ...fanActivitySettingsFromAccount(viewedProfileAccount),
                          enabled: event.target.checked,
                        },
                      },
                    })
                  }
                  disabled={updateAccount.isPending}
                />
                <span>Turn on fan activity for this page. Off by default.</span>
              </label>
              {readFanActivityEnabled(viewedProfileAccount) && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={readFanActivityIntensity(viewedProfileAccount)}
                    onChange={(event) =>
                      updateAccount.mutate({
                        id: viewedProfileAccount.id,
                        settings: {
                          fanActivity: {
                            ...fanActivitySettingsFromAccount(viewedProfileAccount),
                            intensity: event.target.value,
                          },
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
                    onClick={() => simulateFanActivity.mutate(viewedProfileAccount.id)}
                    disabled={simulateFanActivity.isPending}
                    className="ml-auto h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {simulateFanActivity.isPending ? "Simulating…" : "Simulate fan activity now"}
                  </button>
                  <label className="mt-1 flex w-full items-start gap-2 text-xs text-[var(--muted-foreground)]">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={readFanActivityAutoSchedule(viewedProfileAccount)}
                      onChange={(event) =>
                        updateAccount.mutate({
                          id: viewedProfileAccount.id,
                          settings: {
                            fanActivity: {
                              ...fanActivitySettingsFromAccount(viewedProfileAccount),
                              autoSchedule: event.target.checked,
                            },
                          },
                        })
                      }
                      disabled={updateAccount.isPending}
                    />
                    <span>
                      Run fan activity on a schedule, unattended. Also needs "Enable NoodleR fan activity" above —
                      this only opts this page in, it doesn't turn scheduling on by itself.
                    </span>
                  </label>
                </div>
              )}
            </div>
          </Section>
        </>
      ) : (
        <Section title="Your page" help="Create a NoodleR page to manage stage identity, pricing, and fan activity here.">
          <p className="text-xs leading-5 text-[var(--muted-foreground)]">
            You don't have a NoodleR page linked to this persona yet. Create one from your public profile to unlock
            these settings.
          </p>
        </Section>
      )}
    </>
  );

  const renderPostArticle = (post: NoodlePost) => {
    const authorAccount = accountById.get(post.authorAccountId) ?? null;
    const author = authorAccount ?? post.authorSnapshot;
    const postInteractions = interactions.filter((interaction) => interaction.postId === post.id);
    const rootPostInteractions = postInteractions.filter((interaction) => !interaction.parentInteractionId);
    const poll = readNoodlePollFromMetadata(post.metadata);
    const pollVotes = poll
      ? rootPostInteractions.filter(
          (interaction) =>
            interaction.type === "vote" && poll.options.some((option) => option.id === interaction.content),
        )
      : [];
    const personaPollVote = personaAccount
      ? (pollVotes.find((interaction) => interaction.actorAccountId === personaAccount.id)?.content ?? null)
      : null;
    const likedByPersona = personaAccount
      ? rootPostInteractions.some(
          (interaction) => interaction.type === "like" && interaction.actorAccountId === personaAccount.id,
        )
      : false;
    const repostedByPersona = personaAccount
      ? rootPostInteractions.some(
          (interaction) => interaction.type === "repost" && interaction.actorAccountId === personaAccount.id,
        )
      : false;
    const replies = postInteractions.filter((interaction) => interaction.type === "reply");
    const replyById = new Map(replies.map((reply) => [reply.id, reply]));
    const orderedReplies: NoodleInteraction[] = [];
    const visitedReplyIds = new Set<string>();
    const appendReplyBranch = (reply: NoodleInteraction) => {
      if (visitedReplyIds.has(reply.id)) return;
      visitedReplyIds.add(reply.id);
      orderedReplies.push(reply);
      for (const child of replies) {
        if (child.parentInteractionId === reply.id) appendReplyBranch(child);
      }
    };
    for (const reply of replies) {
      if (!reply.parentInteractionId || !replyById.has(reply.parentInteractionId)) appendReplyBranch(reply);
    }
    for (const reply of replies) appendReplyBranch(reply);
    const replyTarget = replyParentInteractionId ? (replyById.get(replyParentInteractionId) ?? null) : null;
    const replyTargetActor = replyTarget
      ? (accountById.get(replyTarget.actorAccountId) ?? replyTarget.actorSnapshot)
      : author;
    const postLikePending = reactionPendingFor(post.id, "like");
    const postRepostPending = reactionPendingFor(post.id, "repost");
    const postReplyPending = createInteractionPendingFor(post.id, "reply", replyParentInteractionId);
    const pollVotePending = createInteractionPendingFor(post.id, "vote");
    const renderReplyComposer = (nested: boolean) => (
      <div
        data-component="NoodleView.ReplyComposer"
        data-noodle-reply-parent-id={replyParentInteractionId ?? ""}
        className={cn("border-[var(--noodle-divider)] py-3", nested ? "ml-10 border-b" : "mt-3 border-y")}
      >
        {replyParentInteractionId && replyTargetActor && (
          <p className="mb-2 text-xs text-[var(--muted-foreground)]">
            Replying to <span className="font-semibold text-[var(--noodle-blue)]">@{replyTargetActor.handle}</span>
          </p>
        )}
        <textarea
          ref={replyComposerRef}
          defaultValue={replyText}
          onChange={handleReplyChange}
          onBlur={() => setReplyText(replyValueRef.current)}
          onKeyDown={handleReplyKeyDown}
          className={cn(textareaClass, "min-h-16 resize-none bg-transparent")}
          placeholder="Leave a comment…"
          aria-autocomplete="list"
          aria-controls={activeReplyMention ? "noodle-reply-mention-list" : undefined}
          aria-expanded={Boolean(activeReplyMention)}
          aria-activedescendant={
            activeReplyMention && replyMentionSuggestions.length > 0
              ? `noodle-reply-mention-list-option-${Math.min(
                  activeReplyMentionIndex,
                  replyMentionSuggestions.length - 1,
                )}`
              : undefined
          }
        />
        <NoodleMentionSuggestions
          activeMention={activeReplyMention}
          activeIndex={activeReplyMentionIndex}
          accounts={replyMentionSuggestions}
          listboxId="noodle-reply-mention-list"
          onSelect={selectReplyMention}
        />
        {replyImageUrl && (
          <div className="relative mt-2 overflow-hidden rounded-xl border border-[var(--noodle-divider)]">
            <button
              type="button"
              onClick={() => setImageLightbox(createNoodleLightboxImage(`reply-draft-${post.id}`, replyImageUrl))}
              className="block w-full"
              title="Open attached image"
            >
              <img src={replyImageUrl} alt="Attached reply preview" className="max-h-52 w-full object-cover" />
            </button>
            <button
              type="button"
              onClick={() => setReplyImageUrl("")}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white transition-colors hover:bg-black/80"
              title="Remove image"
              aria-label="Remove reply image"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <div ref={replyImageToolRef} className="relative">
              <NoodleToolButton
                title="Attach image"
                active={activeReplyComposerTool === "image"}
                onClick={() => setActiveReplyComposerTool((current) => (current === "image" ? null : "image"))}
              >
                <ImageIcon size={17} />
              </NoodleToolButton>
            </div>
            <div ref={replyMediaToolRef} className="relative">
              <NoodleToolButton
                title="Emoji, GIFs and stickers"
                active={activeReplyComposerTool === "media"}
                onClick={() => setActiveReplyComposerTool((current) => (current === "media" ? null : "media"))}
              >
                <Smile size={17} />
              </NoodleToolButton>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearReplyComposer}
              className="h-8 rounded-full px-3 text-xs font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
            <button
              type="button"
              className="h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={(!replyHasText && !replyImageUrl.trim()) || postReplyPending}
              onClick={() => submitReply(post)}
            >
              {postReplyPending ? "Replying…" : "Reply"}
            </button>
          </div>
        </div>
        {activeReplyComposerTool === "image" && (
          <NoodleToolPopover
            title="Attach image"
            anchorRef={replyImageToolRef}
            onClose={() => setActiveReplyComposerTool(null)}
            wide
          >
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => replyImageFileRef.current?.click()}
                disabled={uploadGlobalImages.isPending}
                className="h-9 w-full rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadGlobalImages.isPending ? "Uploading..." : "Upload From Device"}
              </button>
              <div
                data-component="NoodleView.ReplyImageDivider"
                className="flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-normal text-[var(--noodle-blue)]"
              >
                <span className="h-px flex-1 bg-[var(--noodle-divider)]" />
                or
                <span className="h-px flex-1 bg-[var(--noodle-divider)]" />
              </div>
              <label className="block space-y-1.5">
                <span className={labelClass}>Image URL</span>
                <input
                  value={replyImageUrlDraft}
                  onChange={(event) => setReplyImageUrlDraft(event.target.value)}
                  placeholder="https://..."
                  className={fieldClass}
                />
              </label>
              <button
                type="button"
                onClick={applyReplyImageUrl}
                className="h-9 w-full rounded-full border border-[var(--noodle-divider)] px-4 text-xs font-bold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
              >
                Attach URL
              </button>
            </div>
          </NoodleToolPopover>
        )}
        {activeReplyComposerTool === "media" && (
          <NoodleAnchoredPopover anchorRef={replyMediaToolRef} wide>
            <ConversationMediaPickerPanel
              tabs={NOODLE_MEDIA_PICKER_TABS}
              activeTab={mediaPickerTab}
              onActiveTabChange={setMediaPickerTab}
              onClose={() => setActiveReplyComposerTool(null)}
              onEmojiSelect={appendToReply}
              onGifSelect={(gifUrl) => {
                setReplyImageUrl(gifUrl);
                setActiveReplyComposerTool(null);
              }}
              onStickerSelect={(name) => {
                appendToReply(`sticker:${name}:`);
                setActiveReplyComposerTool(null);
              }}
              className="w-full !border-[var(--marinara-chat-chrome-panel-border)] !bg-[var(--background)] !text-[var(--foreground)] shadow-2xl shadow-black/35"
            />
          </NoodleAnchoredPopover>
        )}
      </div>
    );
    return (
      <article
        key={post.id}
        data-noodle-post-id={post.id}
        tabIndex={-1}
        className="border-b border-[var(--noodle-divider)] px-4 py-4 transition-colors hover:bg-[var(--accent)]/35"
      >
        <div className="flex gap-3">
          {author ? (
            <button
              type="button"
              onClick={() => openProfile(authorAccount)}
              disabled={!authorAccount}
              className="h-fit rounded-full text-left transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
              title={authorAccount ? `View @${authorAccount.handle}` : undefined}
            >
              <Avatar account={author} />
            </button>
          ) : (
            <AtSign size={28} className="text-[var(--noodle-blue)]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={() => openProfile(authorAccount)}
                  disabled={!authorAccount}
                  className="font-semibold transition-colors enabled:hover:text-[var(--noodle-blue)] disabled:cursor-default"
                >
                  {author?.displayName ?? "Noodle User"}
                </button>
                <span className="text-xs text-[var(--muted-foreground)]">@{author?.handle ?? "noodle"}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{formatTime(post.createdAt)}</span>
              </div>
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setPostMenuId((current) => (current === post.id ? null : post.id))}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
                  title="Post actions"
                  aria-label="Post actions"
                >
                  <MoreHorizontal size={18} />
                </button>
                {postMenuId === post.id && (
                  <div className="absolute right-0 top-[calc(100%+0.25rem)] z-30 min-w-32 overflow-hidden rounded-lg border border-[var(--noodle-divider)] bg-[var(--background)] py-1 text-xs shadow-2xl shadow-black/30">
                    <button
                      type="button"
                      onClick={() => startEditingPost(post)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]"
                    >
                      <Pencil size={14} className="text-[var(--noodle-blue)]" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteNoodlePost(post)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]"
                    >
                      <Trash2 size={14} className="text-[var(--noodle-blue)]" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
            {editingPostId === post.id ? (
              <div className="mt-2 space-y-2">
                <textarea
                  value={editingPostContent}
                  onChange={(event) => setEditingPostContent(event.target.value)}
                  className={cn(textareaClass, "min-h-28")}
                  placeholder="Edit post"
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelEditingPost}
                    className="h-8 rounded-full border border-[var(--noodle-divider)] px-4 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEditedPost(post)}
                    disabled={!editingPostContent.trim() || updatePost.isPending}
                    className="h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatePost.isPending ? "Saving" : "Save"}
                  </button>
                </div>
              </div>
            ) : !poll || post.content.trim() !== poll.question ? (
              <NoodlePostContent content={post.content} accountByHandle={accountByHandle} onOpenProfile={openProfile} />
            ) : null}
            {poll && (
              <NoodlePollCard
                poll={poll}
                votes={pollVotes}
                accountById={accountById}
                selectedOptionId={personaPollVote}
                disabled={!personaAccount}
                pending={pollVotePending}
                onVote={(optionId) => voteInPoll(post, optionId, personaPollVote)}
                onOpenProfile={openProfile}
              />
            )}
            {post.imageUrl && canRevealPostAccess(post) ? (
              <button
                type="button"
                onClick={() =>
                  setImageLightbox(createNoodleLightboxImage(post.id, post.imageUrl!, post.imagePrompt ?? ""))
                }
                className="mt-3 block w-full overflow-hidden rounded-xl text-left ring-offset-[var(--background)] transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--noodle-blue)] focus-visible:ring-offset-2"
                title="Open image"
                aria-label="Open post image"
              >
                <img
                  src={post.imageUrl}
                  alt={`Image posted by ${author?.displayName ?? "Noodle user"}`}
                  className="max-h-96 w-full object-cover"
                />
              </button>
            ) : post.imageUrl ? (
              <div className="relative mt-3 flex h-52 w-full items-center justify-center overflow-hidden rounded-xl">
                <img src={post.imageUrl} alt="" className="h-full w-full object-cover blur-2xl" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-center text-white">
                  <span className="text-xs font-semibold">{unlockLabel(post)}</span>
                  {post.access === "ppv" && (
                    <button
                      type="button"
                      onClick={() => unlockAccessPost(post)}
                      disabled={unlockPost.isPending}
                      className="h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Unlock
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleSubscription(post.authorAccountId)}
                    disabled={subscribeAccount.isPending}
                    className="h-8 rounded-full border border-white/60 px-4 text-xs font-bold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Subscribe
                  </button>
                </div>
              </div>
            ) : post.imagePrompt ? (
              <div className="mt-3 rounded-xl border border-[var(--noodle-blue)]/35 bg-[var(--noodle-blue)]/10 p-3 text-xs leading-5">
                <span className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--noodle-blue)]">
                  <ImageIcon size={13} />
                  Image prompt
                </span>
                {post.imagePrompt}
              </div>
            ) : null}

            <div className="mt-3 flex max-w-md items-center justify-between gap-1">
              <button
                type="button"
                className={cn(iconButtonClass, "rounded-full", likedByPersona && "bg-[var(--noodle-blue)]/10")}
                disabled={!personaAccount || postLikePending}
                onClick={() => reactToPost(post, "like", likedByPersona)}
                title={likedByPersona ? "Unlike" : "Like"}
                aria-label={`${likedByPersona ? "Unlike" : "Like"} post`}
                aria-busy={postLikePending}
                data-noodle-reaction="like"
              >
                <Heart
                  size={18}
                  fill={likedByPersona ? "currentColor" : "none"}
                  strokeWidth={likedByPersona ? 2.4 : 2}
                  className={cn(
                    "transition-[fill,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    likedByPersona && "scale-110",
                  )}
                />
                {countInteractions(rootPostInteractions, "like")}
              </button>
              <button
                type="button"
                className={cn(iconButtonClass, "rounded-full", repostedByPersona && "bg-[var(--noodle-blue)]/10")}
                disabled={!personaAccount || postRepostPending}
                onClick={() => reactToPost(post, "repost", repostedByPersona)}
                title={repostedByPersona ? "Undo repost" : "Repost"}
                aria-busy={postRepostPending}
                data-noodle-reaction="repost"
              >
                <Repeat2 size={24} strokeWidth={1.55} className="-my-1" />
                {countInteractions(rootPostInteractions, "repost")}
              </button>
              <button
                type="button"
                className={cn(iconButtonClass, "rounded-full hover:text-[var(--noodle-blue)]")}
                disabled={!personaAccount}
                onClick={() => openReplyComposer(post.id)}
                title="Reply"
              >
                <MessageCircle size={18} />
                {replies.length}
              </button>
            </div>

            {replyPostId === post.id && !replyParentInteractionId && renderReplyComposer(false)}

            {replies.length > 0 && (
              <div className="mt-3 border-t border-[var(--noodle-divider)]">
                {orderedReplies.map((reply) => {
                  const actorAccount = accountById.get(reply.actorAccountId) ?? null;
                  const actor = actorAccount ?? reply.actorSnapshot;
                  const parentReply = reply.parentInteractionId
                    ? (replyById.get(reply.parentInteractionId) ?? null)
                    : null;
                  const parentActor = parentReply
                    ? (accountById.get(parentReply.actorAccountId) ?? parentReply.actorSnapshot)
                    : null;
                  const replyLikes = postInteractions.filter(
                    (interaction) => interaction.type === "like" && interaction.parentInteractionId === reply.id,
                  );
                  const likedReplyByPersona = personaAccount
                    ? replyLikes.some((interaction) => interaction.actorAccountId === personaAccount.id)
                    : false;
                  const canManageReply = Boolean(
                    personaAccount &&
                    canManageNoodleReply({
                      actorKind: actorAccount?.kind ?? reply.actorSnapshot?.kind,
                      actorAccountId: reply.actorAccountId,
                      personaAccountId: personaAccount.id,
                    }),
                  );
                  return (
                    <Fragment key={reply.id}>
                      <div
                        data-noodle-interaction-id={reply.id}
                        tabIndex={-1}
                        className={cn(
                          "grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-2 border-b border-[var(--noodle-divider)] bg-transparent py-3 text-xs outline-none transition-shadow duration-300 last:border-b-0",
                          highlightedInteractionId === reply.id &&
                            "rounded-lg ring-1 ring-inset ring-[var(--noodle-blue)]/70",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => openProfile(actorAccount)}
                          disabled={!actorAccount}
                          className="h-8 w-8 shrink-0 rounded-full text-left transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
                          title={actorAccount ? `View @${actorAccount.handle}` : undefined}
                        >
                          <Avatar account={actor ?? { displayName: "Noodle User", avatarUrl: null }} size="sm" />
                        </button>
                        <div className="min-w-0 bg-transparent">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <button
                              type="button"
                              onClick={() => openProfile(actorAccount)}
                              disabled={!actorAccount}
                              className="max-w-full truncate font-semibold transition-colors enabled:hover:text-[var(--noodle-blue)] disabled:cursor-default"
                            >
                              {actor?.displayName ?? "Noodle User"}
                            </button>
                            <span className="truncate text-[var(--muted-foreground)]">
                              @{actor?.handle ?? "noodle"}
                            </span>
                            <span className="text-[var(--muted-foreground)]">· {formatTime(reply.createdAt)}</span>
                          </div>
                          {parentActor && (
                            <p className="mt-0.5 text-[var(--muted-foreground)]">
                              Replying to <span className="text-[var(--noodle-blue)]">@{parentActor.handle}</span>
                            </p>
                          )}
                          {editingReplyId === reply.id ? (
                            <div className="mt-2 space-y-2" data-component="NoodleView.CommentEditor">
                              <textarea
                                value={editingReplyContent}
                                onChange={(event) => setEditingReplyContent(event.target.value)}
                                className={cn(textareaClass, "min-h-20 resize-y")}
                                placeholder="Edit comment"
                                autoFocus
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={cancelEditingReply}
                                  disabled={updateInteraction.isPending}
                                  className="h-8 rounded-full px-3 text-xs font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => saveEditedReply(post, reply)}
                                  disabled={
                                    (!editingReplyContent.trim() && !reply.imageUrl) || updateInteraction.isPending
                                  }
                                  className="h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {updateInteraction.isPending ? "Saving" : "Save"}
                                </button>
                              </div>
                            </div>
                          ) : reply.content ? (
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-5">{reply.content}</p>
                          ) : null}
                          {reply.imageUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setImageLightbox(
                                  createNoodleLightboxImage(reply.id, reply.imageUrl!, reply.content ?? ""),
                                )
                              }
                              className="mt-2 block w-full overflow-hidden rounded-xl text-left ring-offset-[var(--background)] transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--noodle-blue)] focus-visible:ring-offset-2"
                              title="Open image"
                              aria-label="Open comment image"
                            >
                              <img
                                src={reply.imageUrl}
                                alt={`Image in ${actor?.displayName ?? "Noodle user"}'s comment`}
                                className="max-h-72 w-full object-cover"
                              />
                            </button>
                          )}
                          <div className="mt-1.5 flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => reactToReply(post, reply, likedReplyByPersona)}
                              disabled={!personaAccount || reactionPendingFor(post.id, "like", reply.id)}
                              className={cn(
                                "inline-flex h-7 items-center gap-1 rounded-full px-2 font-medium text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50",
                                likedReplyByPersona && "bg-[var(--noodle-blue)]/10",
                              )}
                              title={likedReplyByPersona ? "Unlike comment" : "Like comment"}
                              aria-busy={reactionPendingFor(post.id, "like", reply.id)}
                            >
                              <Heart
                                size={14}
                                fill={likedReplyByPersona ? "currentColor" : "none"}
                                strokeWidth={likedReplyByPersona ? 2.4 : 2}
                                className={cn(
                                  "transition-[fill,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                                  likedReplyByPersona && "scale-110",
                                )}
                              />
                              {replyLikes.length > 0 && replyLikes.length}
                            </button>
                            <button
                              type="button"
                              onClick={() => openReplyComposer(post.id, reply.id)}
                              disabled={!personaAccount}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Reply"
                              aria-label="Reply"
                            >
                              <MessageCircle size={14} />
                            </button>
                            {canManageReply && editingReplyId !== reply.id && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEditingReply(reply)}
                                  disabled={updateInteraction.isPending || deleteInteraction.isPending}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Edit comment"
                                  aria-label="Edit comment"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteNoodleReply(post, reply)}
                                  disabled={updateInteraction.isPending || deleteInteraction.isPending}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Delete comment"
                                  aria-label="Delete comment"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {replyPostId === post.id && replyParentInteractionId === reply.id && renderReplyComposer(true)}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </article>
    );
  };

  const renderPostGridTile = (post: NoodlePost) => {
    const author = accountById.get(post.authorAccountId) ?? post.authorSnapshot;
    const revealed = canRevealPostAccess(post);
    return (
      <button
        key={post.id}
        type="button"
        data-noodle-post-id={post.id}
        onClick={() =>
          revealed
            ? setImageLightbox(createNoodleLightboxImage(post.id, post.imageUrl!, post.imagePrompt ?? ""))
            : post.access === "ppv"
              ? unlockAccessPost(post)
            : toggleSubscription(post.authorAccountId)
        }
        className="group relative aspect-square overflow-hidden bg-[var(--accent)]"
        title={revealed ? post.content || author?.displayName || "Noodle post" : unlockLabel(post)}
      >
        <img
          src={post.imageUrl!}
          alt={post.content || `Image posted by ${author?.displayName ?? "Noodle user"}`}
          className={cn(
            "h-full w-full object-cover transition-transform group-hover:scale-105",
            !revealed && "blur-xl",
          )}
        />
        {!revealed && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[0.65rem] font-semibold text-white">
            {unlockLabel(post)}
          </span>
        )}
      </button>
    );
  };

  const renderPostGrid = (postsToRender: NoodlePost[]) => (
    <div className="grid grid-cols-3 gap-0.5">
      {postsToRender.filter((post) => Boolean(post.imageUrl)).map(renderPostGridTile)}
    </div>
  );

  const renderAccountRow = (account: NoodleAccount, options?: { showFollowButton?: boolean }) => {
    const followable = canFollowAccount(account);
    const followed = followedAccountIds.has(account.id);
    return (
      <div
        key={account.id}
        className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-3 last:border-b-0"
      >
        <button
          type="button"
          onClick={() => openProfile(account)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left transition-colors hover:text-[var(--noodle-blue)]"
        >
          <Avatar account={account} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{account.displayName}</span>
            <span className="block truncate text-sm text-[var(--muted-foreground)]">@{account.handle}</span>
            {account.bio.trim() && (
              <span className="mt-1 line-clamp-2 block text-sm leading-5 text-[var(--foreground)]">{account.bio}</span>
            )}
          </span>
        </button>
        {options?.showFollowButton && followable ? (
          <button
            type="button"
            onClick={() => updateFollowedAccount(account, !followed)}
            disabled={updateAccount.isPending}
            className={cn(
              "mt-1 h-8 shrink-0 rounded-full px-4 text-xs font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
              followed
                ? "border border-[var(--noodle-divider)] text-[var(--foreground)]"
                : "bg-[var(--foreground)] text-[var(--background)]",
            )}
          >
            {followed ? "Following" : "Follow"}
          </button>
        ) : null}
      </div>
    );
  };

  const renderNoodlerAccountRow = (account: NoodleAccount, isOwn: boolean) => {
    const subscribed = subscribedCreatorIds.has(account.id);
    const unseenCount = noodlerUnseenCountByAccountId.get(account.id) ?? 0;
    // Private accounts never carry their own linkedAccountId back to the public
    // side (only the public account points at its private counterpart), so the
    // owning persona/character has to be looked up by scanning for the match.
    const linkedPublicAccount = isOwn ? accounts.find((candidate) => candidate.linkedAccountId === account.id) : null;
    return (
      <div
        key={account.id}
        className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-3 last:border-b-0"
      >
        <button
          type="button"
          onClick={() => openProfile(account)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left transition-colors hover:text-[var(--noodle-blue)]"
        >
          <Avatar account={account} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="block truncate text-sm font-bold">{account.displayName}</span>
              <NoodlerPrivateBadge />
            </span>
            <span className="block truncate text-sm text-[var(--muted-foreground)]">@{account.handle}</span>
            {linkedPublicAccount && (
              <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
                Main account: {linkedPublicAccount.displayName} (@{linkedPublicAccount.handle})
              </span>
            )}
            {unseenCount > 0 && (
              <span className="mt-1 inline-flex h-5 items-center rounded-full bg-[var(--noodle-blue)] px-2 text-[0.65rem] font-black text-zinc-950">
                {unseenCount > 9 ? "9+" : unseenCount} new
              </span>
            )}
            {account.bio.trim() && (
              <span className="mt-1 line-clamp-2 block text-sm leading-5 text-[var(--foreground)]">{account.bio}</span>
            )}
          </span>
        </button>
        {!isOwn && (
          <button
            type="button"
            onClick={() => toggleSubscription(account.id)}
            disabled={subscribeAccount.isPending || unsubscribeAccount.isPending}
            className={cn(
              "mt-1 h-8 shrink-0 rounded-full px-4 text-xs font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
              subscribed
                ? "border border-[var(--noodle-divider)] text-[var(--foreground)]"
                : "bg-[var(--foreground)] text-[var(--background)]",
            )}
          >
            {subscribeLabel(account, subscribed)}
          </button>
        )}
        {isOwn && (
          <button
            type="button"
            onClick={() => deleteNoodlerProfile(account)}
            disabled={deletePrivateAccount.isPending}
            className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            title="Delete NoodleR profile"
            aria-label="Delete NoodleR profile"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  };

  const renderNoodlerActivityRow = (item: Extract<NoodlerTimelineItem, { kind: "subscription" | "unlock" | "reply" }>) => {
    const actor = item.actorAccount ?? item.interaction?.actorSnapshot ?? null;
    const creator = item.creatorAccount;
    const icon = item.kind === "subscription" ? UserPlus : item.kind === "unlock" ? Lock : MessageCircle;
    const Icon = icon;
    const actionText =
      item.kind === "subscription"
        ? "subscribed to"
        : item.kind === "unlock"
          ? "unlocked a post from"
          : "commented on";
    return (
      <div key={item.id} className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
        {actor ? (
          <button
            type="button"
            onClick={() => openProfile(item.actorAccount)}
            disabled={!item.actorAccount}
            className="rounded-full transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
            title={item.actorAccount ? `View @${item.actorAccount.handle}` : undefined}
          >
            <Avatar account={actor} />
          </button>
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 text-[var(--noodle-blue)]">
            <Icon size={21} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => openProfile(item.actorAccount)}
              disabled={!item.actorAccount}
              className="font-bold transition-colors enabled:hover:text-[var(--noodle-blue)] disabled:cursor-default"
            >
              {actor?.displayName ?? "NoodleR fan"}
            </button>
            <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm leading-5">
            {actionText}{" "}
            <button
              type="button"
              onClick={() => openProfile(creator)}
              disabled={!creator}
              className="font-semibold text-[var(--noodle-blue)] transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
            >
              {creator?.displayName ?? "a NoodleR creator"}
            </button>
          </p>
          {item.kind === "reply" && item.interaction?.content && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-5">{item.interaction.content}</p>
          )}
          {item.post && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">{item.post.content}</p>
          )}
        </div>
      </div>
    );
  };

  const renderNoodlerTimelineItem = (item: NoodlerTimelineItem) =>
    item.kind === "post" ? renderPostArticle(item.post) : renderNoodlerActivityRow(item);

  const renderNoodlerSuggestionRow = (account: NoodleAccount) => {
    const subscriberCount = subscriberCountByCreatorId.get(account.id) ?? 0;
    const price =
      typeof account.settings?.subscriptionPrice === "number" ? (account.settings.subscriptionPrice as number) : null;
    return (
      <div key={account.id} className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => openProfile(account)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors hover:text-[var(--noodle-blue)]"
        >
          <Avatar account={account} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{account.displayName}</span>
              <NoodlerPrivateBadge />
            </span>
            <span className="block truncate text-xs text-[var(--muted-foreground)]">
              {price ? `$${price.toFixed(2)}/mo` : "Free to subscribe"} · {subscriberCount} subscriber
              {subscriberCount === 1 ? "" : "s"}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => toggleSubscription(account.id)}
          disabled={subscribeAccount.isPending || unsubscribeAccount.isPending}
          className="h-8 shrink-0 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {subscribeLabel(account, false)}
        </button>
      </div>
    );
  };

  const renderNoodlerDiscoverCard = (account: NoodleAccount) => {
    const subscribed = subscribedCreatorIds.has(account.id);
    const subscriberCount = subscriberCountByCreatorId.get(account.id) ?? 0;
    const latestPost = latestPrivatePostByCreatorId.get(account.id) ?? null;
    const unseenCount = noodlerUnseenCountByAccountId.get(account.id) ?? 0;
    return (
      <article key={account.id} className="border-b border-[var(--noodle-divider)] px-4 py-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => openProfile(account)}
            className="rounded-full transition-opacity hover:opacity-80"
            title={`View @${account.handle}`}
          >
            <Avatar account={account} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => openProfile(account)}
                className="min-w-0 text-left transition-colors hover:text-[var(--noodle-blue)]"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-bold">{account.displayName}</span>
                  <NoodlerPrivateBadge />
                </span>
                <span className="block truncate text-sm text-[var(--muted-foreground)]">@{account.handle}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleSubscription(account.id)}
                disabled={subscribeAccount.isPending || unsubscribeAccount.isPending}
                className={cn(
                  "h-8 shrink-0 rounded-full px-4 text-xs font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                  subscribed
                    ? "border border-[var(--noodle-divider)] text-[var(--foreground)]"
                    : "bg-[var(--foreground)] text-[var(--background)]",
                )}
              >
                {subscribeLabel(account, subscribed)}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <span>{subscriberCount} subscriber{subscriberCount === 1 ? "" : "s"}</span>
              {unseenCount > 0 && (
                <span className="rounded-full bg-[var(--noodle-blue)] px-2 py-0.5 font-black text-zinc-950">
                  {unseenCount > 9 ? "9+" : unseenCount} new
                </span>
              )}
            </div>
            {account.bio.trim() && <p className="mt-2 line-clamp-2 text-sm leading-5">{account.bio}</p>}
            {latestPost ? (
              <button
                type="button"
                onClick={() => openProfile(account)}
                className="mt-3 w-full rounded-lg border border-[var(--noodle-divider)] p-3 text-left transition-colors hover:border-[var(--noodle-blue)]/60 hover:bg-[var(--noodle-blue)]/10"
              >
                <span className="text-[0.65rem] font-semibold uppercase tracking-normal text-[var(--noodle-blue)]">
                  Latest post
                </span>
                <span className="mt-1 line-clamp-2 block text-sm leading-5">
                  {latestPost.content || (latestPost.imageUrl ? "Shared an image." : "Private update")}
                </span>
              </button>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-[var(--noodle-divider)] px-3 py-3 text-sm text-[var(--muted-foreground)]">
                No private posts yet.
              </p>
            )}
          </div>
        </div>
      </article>
    );
  };

  const renderFollowNotification = (item: (typeof notificationFollowAccounts)[number]) => (
    <div key={item.account.id} className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
      <button
        type="button"
        onClick={() => openProfile(item.account)}
        className="rounded-full transition-opacity hover:opacity-80"
        title={`View @${item.account.handle}`}
      >
        <Avatar account={item.account} />
      </button>
      <button
        type="button"
        onClick={() => openProfile(item.account)}
        className="min-w-0 flex-1 text-left transition-colors hover:text-[var(--noodle-blue)]"
      >
        <span className="block truncate text-sm font-bold">{item.account.displayName}</span>
        <span className="block truncate text-sm text-[var(--muted-foreground)]">@{item.account.handle}</span>
        <span className="mt-1 block text-sm leading-5">followed you</span>
      </button>
    </div>
  );

  const renderLikeNotification = (item: (typeof notificationLikes)[number]) => {
    const actor = item.actorAccount ?? item.actorSnapshot;
    return (
      <div
        key={item.interaction.id}
        className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4"
      >
        {actor ? (
          <button
            type="button"
            onClick={() => openProfile(item.actorAccount)}
            disabled={!item.actorAccount}
            className="rounded-full transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
            title={item.actorAccount ? `View @${item.actorAccount.handle}` : undefined}
          >
            <Avatar account={actor} />
          </button>
        ) : (
          <Heart size={28} className="text-[var(--noodle-blue)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => openProfile(item.actorAccount)}
              disabled={!item.actorAccount}
              className="font-bold transition-colors enabled:hover:text-[var(--noodle-blue)] disabled:cursor-default"
            >
              {actor?.displayName ?? "Noodle User"}
            </button>
            <span className="text-xs text-[var(--muted-foreground)]">@{actor?.handle ?? "noodle"}</span>
            <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.interaction.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm">liked your {item.targetReply ? "comment" : "post"}</p>
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--muted-foreground)]">
            {item.targetReply?.content || (item.targetReply?.imageUrl ? "Shared an image." : item.post.content)}
          </p>
        </div>
      </div>
    );
  };

  const renderReplyNotification = (item: (typeof notificationReplyItems)[number]) => {
    const actor = item.actorAccount ?? item.actorSnapshot;
    return (
      <div key={item.id} className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
        {actor ? (
          <button
            type="button"
            onClick={() => openProfile(item.actorAccount)}
            disabled={!item.actorAccount}
            className="rounded-full transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
            title={item.actorAccount ? `View @${item.actorAccount.handle}` : undefined}
          >
            <Avatar account={actor} />
          </button>
        ) : (
          <MessageCircle size={28} className="text-[var(--noodle-blue)]" />
        )}
        <button
          type="button"
          onClick={() => openNotificationTarget(item.post.id, item.interactionId)}
          data-noodle-notification-target={item.interactionId ?? item.post.id}
          data-noodle-notification-kind={item.kind}
          className="-m-2 min-w-0 flex-1 rounded-lg p-2 text-left outline-none transition-colors hover:bg-[var(--noodle-blue)]/10 focus-visible:ring-2 focus-visible:ring-[var(--noodle-blue)]/70"
          title={item.kind === "reply" ? "Open reply in timeline" : "Open post in timeline"}
          aria-label={
            item.kind === "reply"
              ? `Open reply from ${actor?.displayName ?? "Noodle user"} in timeline`
              : `Open mention from ${actor?.displayName ?? "Noodle user"} in timeline`
          }
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-bold">{actor?.displayName ?? "Noodle User"}</span>
            <span className="text-xs text-[var(--muted-foreground)]">@{actor?.handle ?? "noodle"}</span>
            <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm">
            {item.kind === "reply" ? `replied to your ${item.replyTarget ?? "post"}` : "mentioned you"}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-5">{item.content}</p>
          {item.kind === "reply" && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">{item.post.content}</p>
          )}
        </button>
      </div>
    );
  };

  const renderNoodlerSubscriptionNotification = (item: (typeof noodlerNotificationSubscriptions)[number]) => (
    <div
      key={item.subscription.id}
      className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4"
    >
      {item.subscriberAccount ? (
        <button
          type="button"
          onClick={() => openProfile(item.subscriberAccount)}
          className="rounded-full transition-opacity hover:opacity-80"
          title={`View @${item.subscriberAccount.handle}`}
        >
          <Avatar account={item.subscriberAccount} />
        </button>
      ) : (
        <UserPlus size={28} className="text-[var(--noodle-blue)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-bold">{item.subscriberAccount?.displayName ?? "A fan"}</span>
          <span className="text-xs text-[var(--muted-foreground)]">
            @{item.subscriberAccount?.handle ?? "noodle"}
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.subscription.createdAt)}</span>
        </div>
        <p className="mt-1 text-sm">subscribed to your page</p>
      </div>
    </div>
  );

  const renderNoodlerUnlockNotification = (item: (typeof noodlerNotificationUnlocks)[number]) => (
    <div key={item.unlock.id} className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
      {item.unlockerAccount ? (
        <button
          type="button"
          onClick={() => openProfile(item.unlockerAccount)}
          className="rounded-full transition-opacity hover:opacity-80"
          title={`View @${item.unlockerAccount.handle}`}
        >
          <Avatar account={item.unlockerAccount} />
        </button>
      ) : (
        <Lock size={28} className="text-[var(--noodle-blue)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-bold">{item.unlockerAccount?.displayName ?? "A fan"}</span>
          <span className="text-xs text-[var(--muted-foreground)]">@{item.unlockerAccount?.handle ?? "noodle"}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.unlock.createdAt)}</span>
        </div>
        <p className="mt-1 text-sm">unlocked a pay-per-view post</p>
        {item.post && (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--muted-foreground)]">
            {item.post.content || (item.post.imageUrl ? "Shared an image." : "Private post")}
          </p>
        )}
      </div>
    </div>
  );

  const renderNoodlerActivityNotification = (entry: (typeof noodlerNotificationActivity)[number]) => {
    if (entry.kind === "like") {
      const item = entry.item;
      const actor = item.actorAccount ?? item.actorSnapshot;
      return (
        <div
          key={`like:${item.interaction.id}`}
          className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4"
        >
          {actor ? (
            <Avatar account={actor} />
          ) : (
            <Heart size={28} className="text-[var(--noodle-blue)]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate font-bold">{actor?.displayName ?? "Noodle User"}</span>
              <span className="text-xs text-[var(--muted-foreground)]">@{actor?.handle ?? "noodle"}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.interaction.createdAt)}</span>
            </div>
            <p className="mt-1 text-sm">liked your {item.targetReply ? "comment" : "post"}</p>
          </div>
        </div>
      );
    }
    const item = entry.item;
    const actor = item.actorAccount ?? item.actorSnapshot;
    return (
      <div key={item.id} className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
        {actor ? (
          <Avatar account={actor} />
        ) : (
          <MessageCircle size={28} className="text-[var(--noodle-blue)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-bold">{actor?.displayName ?? "Noodle User"}</span>
            <span className="text-xs text-[var(--muted-foreground)]">@{actor?.handle ?? "noodle"}</span>
            <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm">replied to your {item.replyTarget ?? "post"}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-5">{item.content}</p>
        </div>
      </div>
    );
  };

  const NOODLER_NOTIFICATION_TABS: Array<{ id: typeof noodlerNotificationTab; label: string }> = [
    { id: "subscribers", label: "Subscribers" },
    { id: "unlocks", label: "Unlocks" },
    { id: "activity", label: "Activity" },
  ];

  const noodlerNotificationsContent = (
    <div className="min-h-full">
      <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
        <div className="flex min-h-14 items-center gap-3 px-2 py-2 lg:px-4">
          <MobileTimelineBackButton label="Back to NoodleR" onClick={openMobileHomeTimeline} />
          <Bell size={22} className="hidden text-[var(--noodle-blue)] lg:block" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">NoodleR notifications</h2>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {personaLinkedNoodlerAccount ? `@${personaLinkedNoodlerAccount.handle}` : "No NoodleR page yet"}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3">
          {NOODLER_NOTIFICATION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setNoodlerNotificationTab(tab.id)}
              className={cn(
                "relative flex h-12 items-center justify-center text-sm font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                noodlerNotificationTab === tab.id && "text-[var(--foreground)]",
              )}
            >
              {tab.label}
              {noodlerNotificationTab === tab.id && (
                <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {noodlerNotificationTab === "subscribers" ? (
        noodlerNotificationSubscriptions.length > 0 ? (
          <div>{noodlerNotificationSubscriptions.map(renderNoodlerSubscriptionNotification)}</div>
        ) : (
          <div className="px-8 py-14 text-center">
            <UserPlus size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
            <p className="text-base font-bold">No subscribers yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
              New subscribers to your NoodleR page will show here.
            </p>
          </div>
        )
      ) : noodlerNotificationTab === "unlocks" ? (
        noodlerNotificationUnlocks.length > 0 ? (
          <div>{noodlerNotificationUnlocks.map(renderNoodlerUnlockNotification)}</div>
        ) : (
          <div className="px-8 py-14 text-center">
            <Lock size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
            <p className="text-base font-bold">No unlocks yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
              Pay-per-view unlocks on your posts will show here.
            </p>
          </div>
        )
      ) : noodlerNotificationActivity.length > 0 ? (
        <div>{noodlerNotificationActivity.map(renderNoodlerActivityNotification)}</div>
      ) : (
        <div className="px-8 py-14 text-center">
          <Heart size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
          <p className="text-base font-bold">No activity yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
            Likes and replies on your NoodleR posts will show here.
          </p>
        </div>
      )}
    </div>
  );

  const renderComposerToolPopovers = ({
    imageRef,
    pollRef,
    mediaRef,
  }: {
    imageRef: RefObject<HTMLDivElement | null>;
    pollRef: RefObject<HTMLDivElement | null>;
    mediaRef: RefObject<HTMLDivElement | null>;
  }) => (
    <>
      {activeComposerTool === "image" && (
        <NoodleToolPopover title="Attach image" anchorRef={imageRef} onClose={() => setActiveComposerTool(null)} wide>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => imageFileRef.current?.click()}
              disabled={uploadGlobalImages.isPending}
              className="h-9 w-full rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploadGlobalImages.isPending ? "Uploading..." : "Upload From Device"}
            </button>
            <div className="flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-normal text-[var(--marinara-chat-chrome-panel-muted)]">
              <span className="h-px flex-1 bg-[var(--noodle-divider)]" />
              or
              <span className="h-px flex-1 bg-[var(--noodle-divider)]" />
            </div>
            <label className="block space-y-1.5">
              <span className={labelClass}>Image URL</span>
              <input
                value={imageUrlDraft}
                onChange={(event) => setImageUrlDraft(event.target.value)}
                placeholder="https://..."
                className={fieldClass}
              />
            </label>
            <button
              type="button"
              onClick={applyImageUrl}
              className="h-9 w-full rounded-full border border-[var(--noodle-divider)] px-4 text-xs font-bold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
            >
              Attach URL
            </button>
          </div>
        </NoodleToolPopover>
      )}
      {activeComposerTool === "poll" && (
        <NoodleToolPopover
          title={draftPoll ? "Edit poll" : "Create poll"}
          anchorRef={pollRef}
          onClose={() => setActiveComposerTool(null)}
          wide
        >
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className={labelClass}>Question</span>
              <input
                value={pollQuestion}
                onChange={(event) => setPollQuestion(event.target.value)}
                className={fieldClass}
                placeholder="Ask a question"
              />
            </label>
            <div className="space-y-2">
              {pollOptions.map((option, index) => (
                <input
                  key={index}
                  value={option}
                  onChange={(event) =>
                    setPollOptions((current) =>
                      current.map((entry, optionIndex) => (optionIndex === index ? event.target.value : entry)),
                    )
                  }
                  className={fieldClass}
                  placeholder={`Option ${index + 1}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPollOptions((current) => (current.length >= 4 ? current : [...current, ""]))}
                className="h-8 flex-1 rounded-full border border-[var(--noodle-divider)] px-3 text-xs font-semibold text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
              >
                Add Option
              </button>
              <button
                type="button"
                onClick={applyPoll}
                className="h-8 flex-1 rounded-full bg-[var(--noodle-blue)] px-3 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90"
              >
                {draftPoll ? "Update Poll" : "Add Poll"}
              </button>
            </div>
          </div>
        </NoodleToolPopover>
      )}
      {activeComposerTool === "media" && (
        <NoodleAnchoredPopover anchorRef={mediaRef} wide>
          <ConversationMediaPickerPanel
            tabs={NOODLE_MEDIA_PICKER_TABS}
            activeTab={mediaPickerTab}
            onActiveTabChange={setMediaPickerTab}
            onClose={() => setActiveComposerTool(null)}
            onEmojiSelect={appendToComposer}
            onGifSelect={(gifUrl) => {
              setAttachedImageUrl(gifUrl);
              setActiveComposerTool(null);
            }}
            onStickerSelect={(name) => {
              appendToComposer(`sticker:${name}:`);
              setActiveComposerTool(null);
            }}
            className="w-full !border-[var(--marinara-chat-chrome-panel-border)] !bg-[var(--background)] !text-[var(--foreground)] shadow-2xl shadow-black/35"
          />
        </NoodleAnchoredPopover>
      )}
    </>
  );

  const rightRailContent = (
    <aside className="hidden w-[22rem] shrink-0 px-4 py-3 xl:block">
      <div className="sticky top-3 space-y-4">
        <label className="flex h-11 items-center gap-2 rounded-full border border-[var(--noodle-divider)] bg-[var(--background)] px-4 text-sm transition-colors focus-within:border-[var(--noodle-blue)]">
          <Search size={17} className="shrink-0 text-[var(--noodle-blue)]" />
          <input
            value={postSearch}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search posts or @users"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
          />
          {postSearch.trim() && (
            <button
              type="button"
              onClick={() => setPostSearch("")}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </label>

        {activeNoodleMode === "noodler" ? (
          <section className="overflow-hidden rounded-2xl border border-[var(--noodle-divider)] bg-[var(--background)]">
            <div className="border-b border-[var(--noodle-divider)] px-4 py-3">
              <h3 className="text-lg font-bold">Creators to check out</h3>
              <p className="text-xs text-[var(--muted-foreground)]">Paid pages, not follows — subscribe to unlock.</p>
            </div>
            {suggestedNoodlerCreators.length > 0 ? (
              <div className="divide-y divide-[var(--noodle-divider)]">
                {suggestedNoodlerCreators.map(renderNoodlerSuggestionRow)}
              </div>
            ) : (
              <p className="px-4 py-5 text-sm text-[var(--muted-foreground)]">No NoodleR creators to suggest yet.</p>
            )}
          </section>
        ) : (
          <section className="overflow-hidden rounded-2xl border border-[var(--noodle-divider)] bg-[var(--background)]">
            <div className="border-b border-[var(--noodle-divider)] px-4 py-3">
              <h3 className="text-lg font-bold">Who to follow</h3>
            </div>
            {suggestedCharacters.length > 0 ? (
              <div className="divide-y divide-[var(--noodle-divider)]">
                {suggestedCharacters.map((character) => (
                  <div key={character.accountId} className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openProfile(character.account)}
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
                      onClick={() => updateFollowedAccount(character.account, true)}
                      disabled={updateAccount.isPending}
                      className="h-8 rounded-full bg-[var(--foreground)] px-4 text-xs font-bold text-[var(--background)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Follow
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-5 text-sm text-[var(--muted-foreground)]">
                {followableCharacterAccounts.length > 0 ? "You're following everyone!" : "No one's cooking yet…"}
              </p>
            )}
          </section>
        )}
      </div>
    </aside>
  );

  const noodleHomeProps: NoodleHomeProps = {
    activeNoodleView: activeNoodleView === "search" || activeNoodleView === "notifications" ? activeNoodleView : "home",
    isLoading,
    personaAccount,
    isGlobalPersonaSelected,
    settings,
    onOpenMobileDrawer: () => setMobileDrawerOpen(true),
    onBackToHome: openMobileHomeTimeline,
    postSearch,
    onPostSearchChange: setPostSearch,
    rawPostSearch,
    normalizedPostSearch,
    isAccountSearch,
    accountSearchTerm,
    accountSearchResults,
    renderAccountRow,
    timelineTab,
    onTimelineTabChange: setTimelineTab,
    timelinePosts,
    baseTimelinePostsCount: baseTimelinePosts.length,
    postsCount: posts.length,
    renderPostArticle,
    renderPostGrid,
    onOpenProfile: openProfile,
    suggestedCharacters,
    followableCharacterAccountsCount: followableCharacterAccounts.length,
    onUpdateFollowedAccount: updateFollowedAccount,
    updateAccountPending: updateAccount.isPending,
    composeOpen,
    inlineComposerRef,
    composer,
    onComposerChange: handleComposerChange,
    onComposerBlur: () => setComposer(composerValueRef.current),
    onComposerKeyDown: handleComposerKeyDown,
    activeMention,
    mentionSuggestionsCount: mentionSuggestions.length,
    activeMentionIndex,
    composePlaceholder,
    composeActionLabel,
    renderComposerMentionSuggestions,
    renderDraftPoll,
    attachedImageUrl,
    onAttachedImageUrlChange: setAttachedImageUrl,
    imageToolRef,
    pollToolRef,
    mediaToolRef,
    activeComposerTool,
    onActiveComposerToolChange: setActiveComposerTool,
    draftPollActive: Boolean(draftPoll),
    onTogglePollComposer: togglePollComposer,
    onSubmitPost: submitPost,
    canSubmitPost,
    createPostPending: createPost.isPending,
    renderComposerToolPopovers,
    onTriggerRefresh: triggerRefresh,
    refreshNoodlePending: refreshNoodle.isPending,
    imagePromptReviewItemsCount: imagePromptReviewItems.length,
    notificationTab,
    onNotificationTabChange: setNotificationTab,
    notificationLikesCount: notificationLikes.length,
    notificationFollowAccountsCount: notificationFollowAccounts.length,
    notificationReplyItemsCount: notificationReplyItems.length,
    renderLikeNotification: renderLikeNotification as (item: unknown) => React.ReactNode,
    renderFollowNotification: renderFollowNotification as (item: unknown) => React.ReactNode,
    renderReplyNotification: renderReplyNotification as (item: unknown) => React.ReactNode,
    notificationLikes,
    notificationFollowAccounts,
    notificationReplyItems,
    hasOlderHistory: Boolean(data?.hasOlderHistory),
    oldestLoadedPostCreatedAt,
    onLoadOlderPosts: (before) =>
      loadOlderPosts.mutate(before, {
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not load older posts."),
      }),
    loadOlderPostsPending: loadOlderPosts.isPending,
  };

  const isGridLayout = settings?.layout === "grid";
  const linkedNoodlerAccount = viewedProfileAccount?.linkedAccountId
    ? (accountById.get(viewedProfileAccount.linkedAccountId) ?? null)
    : null;
  const subscriptionActionPending = subscribeAccount.isPending || unsubscribeAccount.isPending;

  const publicProfileViewProps: PublicProfileViewProps = {
    onBackToHome: openMobileHomeTimeline,
    viewedProfileAccount,
    profileDisplayHandle,
    canEditViewedProfile,
    profileUploadTarget,
    bannerFileRef,
    avatarFileRef,
    onProfileImageFile: handleProfileImageFile,
    profileBannerPreview,
    profilePreviewAccount,
    isEditingProfile,
    onEditToggle: () => {
      if (isEditingProfile) saveProfile();
      else setProfileEditing(true);
    },
    canSaveProfile,
    updateAccountPending: updateAccount.isPending,
    profileName,
    onProfileNameChange: setProfileName,
    profileHandle,
    onProfileHandleChange: setProfileHandle,
    profileBio,
    onProfileBioChange: setProfileBio,
    profileLocation,
    onProfileLocationChange: setProfileLocation,
    profileBioPreview,
    noodleCustomEmojiMap,
    profileLocationPreview,
    profileFollowingCount,
    profileFollowerCount,
    onOpenFollowing: () => setProfileConnectionTab("following"),
    onOpenFollowers: () => setProfileConnectionTab("followers"),
    canFollowViewedProfile,
    viewedProfileFollowed,
    onUpdateFollowedAccount: updateFollowedAccount,
    isNoodlerEnabled,
    viewingOwnProfile,
    linkedNoodlerAccount,
    onOpenLinkedNoodler: openProfile,
    onCreateNoodler: openPrivateStageSetup,
    createPrivateAccountPending: createPrivateAccount.isPending,
    profileTab,
    onProfileTabChange: setProfileTab,
    profileVisiblePosts,
    isGridLayout,
    renderPostGrid,
    renderPostArticle,
  };

  const profileViewProps: PrivateProfileViewProps = {
    onBackToHome: openMobileHomeTimeline,
    viewedProfileAccount,
    profileDisplayHandle,
    canEditViewedProfile,
    profileUploadTarget,
    bannerFileRef,
    avatarFileRef,
    onProfileImageFile: handleProfileImageFile,
    profileBannerPreview,
    profilePreviewAccount,
    isEditingProfile,
    onEditToggle: () => {
      if (isEditingProfile) saveProfile();
      else setProfileEditing(true);
    },
    canSaveProfile,
    updateAccountPending: updateAccount.isPending,
    profileName,
    onProfileNameChange: setProfileName,
    profileHandle,
    onProfileHandleChange: setProfileHandle,
    profileBio,
    onProfileBioChange: setProfileBio,
    profileLocation,
    onProfileLocationChange: setProfileLocation,
    profileBioPreview,
    noodleCustomEmojiMap,
    profileLocationPreview,
    profileFollowingCount,
    profileFollowerCount,
    onOpenFollowing: () => setProfileConnectionTab("following"),
    onOpenFollowers: () => setProfileConnectionTab("followers"),
    isNoodlerEnabled,
    subscribed: viewedProfileAccount ? subscribedCreatorIds.has(viewedProfileAccount.id) : false,
    onToggleSubscription: toggleSubscription,
    subscriptionActionPending,
    viewingOwnPrivateAccount,
    onDeleteNoodlerProfile: deleteNoodlerProfile,
    deletePrivateAccountPending: deletePrivateAccount.isPending,
    onOpenGuidedPrivatePost: openGuidedPrivatePost,
    refreshNoodlePending: refreshNoodle.isPending,
    onRetryPrivateIdentity: (accountId: string) => retryPrivateIdentity.mutate(accountId),
    retryPrivateIdentityPending: retryPrivateIdentity.isPending,
    privateComposerText,
    onPrivateComposerTextChange: setPrivateComposerText,
    privateComposerAccess,
    onPrivateComposerAccessChange: setPrivateComposerAccess,
    privateComposerPpvPrice,
    onPrivateComposerPpvPriceChange: setPrivateComposerPpvPrice,
    privateComposerImageUrl,
    onPrivateComposerImageUrlChange: setPrivateComposerImageUrl,
    onSubmitPrivatePost: submitPrivatePost,
    createPostPending: createPost.isPending,
    profileTab,
    onProfileTabChange: setProfileTab,
    profileVisiblePosts,
    isGridLayout,
    renderPostGrid,
    renderPostArticle,
  };

  const noodlerHomeProps: NoodlerHomeProps = {
    activeNoodleView:
      activeNoodleView === "noodler"
        ? "noodler"
        : activeNoodleView === "profile"
          ? "profile"
          : "noodler-verification",
    personaAccount,
    isGlobalPersonaSelected,
    onBackToHome: openMobileHomeTimeline,
    onEnableNoodlerFromVerification: enableNoodlerFromVerification,
    hasSettings: Boolean(settings),
    updateSettingsPending: updateSettings.isPending,
    onOpenMobileDrawer: () => setMobileDrawerOpen(true),
    noodlerHubLoading: noodlerHubQuery.isLoading,
    noodlerHubTab,
    onNoodlerHubTabChange: setNoodlerHubTab,
    noodlerTimelineItems,
    renderNoodlerTimelineItem,
    privateAccountsCount: privateAccounts.length,
    noodlerHub,
    renderNoodlerAccountRow,
    sortedNoodlerDiscoverAccounts,
    renderNoodlerDiscoverCard,
    composeOpen,
    inlineComposerRef,
    composer,
    onComposerChange: handleComposerChange,
    onComposerBlur: () => setComposer(composerValueRef.current),
    onComposerKeyDown: handleComposerKeyDown,
    activeMention,
    mentionSuggestionsCount: mentionSuggestions.length,
    activeMentionIndex,
    composePlaceholder,
    composeActionLabel,
    renderComposerMentionSuggestions,
    renderDraftPoll,
    attachedImageUrl,
    onAttachedImageUrlChange: setAttachedImageUrl,
    imageToolRef,
    pollToolRef,
    mediaToolRef,
    activeComposerTool,
    onActiveComposerToolChange: setActiveComposerTool,
    draftPollActive: Boolean(draftPoll),
    onTogglePollComposer: togglePollComposer,
    onSubmitPost: submitPost,
    canSubmitPost,
    createPostPending: createPost.isPending,
    renderComposerToolPopovers,
    onTriggerRefresh: triggerRefresh,
    refreshNoodlePending: refreshNoodle.isPending,
    hasNoodlerAccount: Boolean(personaLinkedNoodlerAccount),
    noodlerPostingMode: readPrivatePostingMode(personaLinkedNoodlerAccount),
    onOpenOwnProfile: openOwnProfile,
    showNoodlerSignup: activeNoodleMode === "noodler" && !viewedProfileAccountId && !personaLinkedNoodlerAccount,
    stageDraft: privateStageDraft,
    onStartStageDraft: () => {
      if (personaAccount) openPrivateStageSetup(personaAccount);
    },
    onStageDraftChange: (patch: Partial<PrivateStageDraft>) => {
      setPrivateStageDraft((draft) => (draft ? { ...draft, ...patch } : draft));
    },
    onSubmitStageDraft: createPrivateStageAccount,
    onCancelStageDraft: () => setPrivateStageDraft(null),
    stageDraftPending: createPrivateAccount.isPending,
    profileViewProps,
  };

  return (
    <div
      className={cn(
        "mari-chrome-token-scope relative flex h-full min-h-0 flex-col bg-[var(--background)] text-[var(--foreground)]",
        NOODLE_ICON_SCOPE_CLASS,
      )}
      data-component="NoodleView"
      style={
        {
          "--noodle-blue": activeNoodleMode === "noodler" ? NOODLER_BLUE : NOODLE_BLUE,
          "--noodle-divider": "var(--marinara-chat-chrome-panel-divider)",
        } as CSSProperties
      }
    >
      <BrowserChrome mode={activeNoodleMode} path={browserPath} />
      <input ref={imageFileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      <input ref={replyImageFileRef} type="file" accept="image/*" className="hidden" onChange={handleReplyImageFile} />
      {imageLightbox && (
        <ChatImageLightbox
          image={imageLightbox}
          alt={imageLightbox.prompt || "Noodle image"}
          pinEnabled={false}
          onClose={() => setImageLightbox(null)}
        />
      )}
      <AnimatePresence>
        {mobileDrawerOpen && (
          <motion.div
            initial={prefersReducedMotion ? { opacity: 0 } : { x: "-100%" }}
            animate={prefersReducedMotion ? { opacity: 1 } : { x: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { x: "-100%" }}
            transition={prefersReducedMotion ? { duration: 0.1 } : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 z-[80] h-full w-full bg-[var(--background)] lg:hidden"
            data-component="NoodleView.MobileDrawer"
            data-motion="slide-x"
          >
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="Noodle account menu"
              className={cn(
                "mari-chrome-token-scope flex h-full w-full flex-col overflow-y-auto bg-[var(--background)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 text-[var(--foreground)]",
                NOODLE_ICON_SCOPE_CLASS,
              )}
              style={
                {
                  "--noodle-blue": activeNoodleMode === "noodler" ? NOODLER_BLUE : NOODLE_BLUE,
                  "--noodle-divider": "var(--marinara-chat-chrome-panel-divider)",
                } as CSSProperties
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {isGlobalPersonaSelected ? (
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 ring-1 ring-[var(--noodle-blue)]/25">
                      <Globe2 size={24} className="text-[var(--noodle-blue)]" />
                    </span>
                  ) : personaAccount ? (
                    <Avatar account={personaAccount} />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 ring-1 ring-[var(--noodle-blue)]/25">
                      <AtSign size={24} className="text-[var(--noodle-blue)]" />
                    </span>
                  )}
                  <p className="mt-3 truncate text-lg font-bold">
                    {isGlobalPersonaSelected ? "Global" : (personaAccount?.displayName ?? "Noodle Account")}
                  </p>
                  <p className="truncate text-sm text-[var(--muted-foreground)]">
                    {isGlobalPersonaSelected
                      ? `${activeNoodleModeMeta.tagline} · every persona`
                      : personaAccount
                        ? `${activeNoodleModeMeta.tagline} · @${personaAccount.handle}`
                        : "Pick a persona below"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
                  title="Close"
                  aria-label="Close Noodle account menu"
                >
                  <X size={20} />
                </button>
              </div>

              {isNoodlerEnabled && (
                <div className="mt-7">
                  <NoodleModeSwitcher
                    activeMode={activeNoodleMode}
                    onOpenNoodle={switchToNoodleModeMobile}
                    onOpenNoodler={openNoodlerHub}
                  />
                </div>
              )}

              <nav className="mt-4 space-y-1" aria-label="Noodle account navigation">
                <button
                  type="button"
                  onClick={openMobileHomeTimeline}
                  className="flex min-h-12 w-full items-center gap-4 rounded-xl px-2 text-left text-base font-bold transition-colors hover:bg-[var(--accent)]"
                >
                  <Home size={23} />
                  Home
                </button>
                <button
                  type="button"
                  onClick={openOwnProfile}
                  disabled={isGlobalPersonaSelected}
                  className="flex min-h-12 w-full items-center gap-4 rounded-xl px-2 text-left text-base font-bold transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <User size={23} />
                  Profile
                </button>
                <button
                  type="button"
                  onClick={openSettings}
                  className="flex min-h-12 w-full items-center gap-4 rounded-xl px-2 text-left text-base font-bold transition-colors hover:bg-[var(--accent)]"
                >
                  <Settings2 size={23} />
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isGlobalPersonaSelected) return;
                    setComposer(composerValueRef.current);
                    setComposeOpen(true);
                    setActiveComposerTool(null);
                    setMobileDrawerOpen(false);
                  }}
                  disabled={isGlobalPersonaSelected}
                  className="flex min-h-12 w-full items-center gap-4 rounded-xl px-2 text-left text-base font-bold transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pencil size={23} />
                  {composeActionLabel}
                </button>
              </nav>

              <div className="relative mt-auto border-t border-[var(--noodle-divider)] pt-3">
                {mobileAccountSwitcherOpen && (
                  <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 max-h-64 overflow-y-auto rounded-2xl border border-[var(--noodle-divider)] bg-[var(--background)] p-2 shadow-2xl shadow-black/35">
                    <p className={cn(labelClass, "px-2 pb-2")}>Switch account</p>
                    {allowGlobalPersona || sortedPersonaAccounts.length > 0 ? (
                      <div className="space-y-1">
                        {allowGlobalPersona && (
                          <button
                            data-noodle-persona-id={NOODLE_GLOBAL_PERSONA_ID}
                            type="button"
                            onClick={() => {
                              setSelectedPersonaId(NOODLE_GLOBAL_PERSONA_ID);
                              setViewedProfileAccountId(null);
                              setProfileEditing(false);
                              setProfileTab("posts");
                              setProfileConnectionTab(null);
                              setTimelineTab("main");
                              setActiveNoodleView(activeNoodleMode === "noodler" ? "noodler" : "home");
                              setMobileAccountSwitcherOpen(false);
                              setMobileDrawerOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                              isGlobalPersonaSelected && "bg-[var(--noodle-blue)]/10",
                            )}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 text-[var(--noodle-blue)] ring-1 ring-[var(--noodle-blue)]/25">
                              <Globe2 size={17} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">Global</span>
                              <span className="block truncate text-xs text-[var(--muted-foreground)]">
                                See every persona's posts
                              </span>
                            </span>
                            {isGlobalPersonaSelected && <span className="h-2 w-2 rounded-full bg-[var(--noodle-blue)]" />}
                          </button>
                        )}
                        {sortedPersonaAccounts.map((account) => {
                          const selected = account.id === personaAccount?.id;
                          return (
                            <button
                              key={account.id}
                              data-noodle-persona-id={account.entityId}
                              type="button"
                              onClick={() => {
                                setSelectedPersonaId(account.entityId);
                                setViewedProfileAccountId(null);
                                setProfileEditing(false);
                                setProfileTab("posts");
                                setProfileConnectionTab(null);
                                setMobileAccountSwitcherOpen(false);
                                setMobileDrawerOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                                selected && "bg-[var(--noodle-blue)]/10",
                              )}
                            >
                              <Avatar account={account} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="block truncate text-sm font-semibold">{account.displayName}</span>
                                  {isNoodlerEnabled && Boolean(account.linkedAccountId) && <NoodlerBadge />}
                                </span>
                                <span className="block truncate text-xs text-[var(--muted-foreground)]">
                                  @{account.handle}
                                </span>
                              </span>
                              {selected && <span className="h-2 w-2 rounded-full bg-[var(--noodle-blue)]" />}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="px-2 py-3 text-xs text-[var(--muted-foreground)]">No persona accounts yet.</p>
                    )}
                  </div>
                )}
                <button
                  data-component="NoodleView.MobileAccountSwitcher"
                  type="button"
                  onClick={() => setMobileAccountSwitcherOpen((current) => !current)}
                  aria-expanded={mobileAccountSwitcherOpen}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-[var(--accent)]"
                >
                  {isGlobalPersonaSelected ? (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15">
                      <Globe2 size={18} />
                    </span>
                  ) : personaAccount ? (
                    <Avatar account={personaAccount} size="sm" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15">
                      <AtSign size={18} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">Switch account</span>
                    <span className="block truncate text-xs text-[var(--muted-foreground)]">
                      {isGlobalPersonaSelected ? "Global" : personaAccount ? `@${personaAccount.handle}` : "Choose a persona"}
                    </span>
                  </span>
                  <MoreHorizontal size={19} />
                </button>
              </div>
            </aside>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
        <div className="flex min-h-0 w-full max-w-[1264px] justify-center">
          <aside className="hidden w-[17rem] shrink-0 border-r border-[var(--noodle-divider)] bg-[var(--background)] lg:flex lg:flex-col [&_svg]:!text-[var(--noodle-blue)]">
            <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
              <div className="mb-5 flex h-12 items-center">
                {activeNoodleMode === "noodler" ? (
                  <NoodlerLogo className="h-10 w-16" />
                ) : (
                  <NoodleLogo className="h-10 w-16" />
                )}
              </div>
              {isNoodlerEnabled && (
                <div className="mb-4">
                  <NoodleModeSwitcher
                    activeMode={activeNoodleMode}
                    onOpenNoodle={switchToNoodleMode}
                    onOpenNoodler={openNoodlerHub}
                  />
                </div>
              )}
              <nav className="space-y-1 border-t border-[var(--noodle-divider)] pt-3">
                <button
                  type="button"
                  onClick={openHomeTimeline}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-4 rounded-full px-3 text-left text-[0.95rem] font-semibold hover:bg-[var(--accent)]",
                    (activeNoodleMode === "noodler"
                      ? activeNoodleView === "noodler"
                      : activeNoodleView === "home") && "bg-[var(--noodle-blue)]/10",
                  )}
                >
                  {activeNoodleMode === "noodler" ? (
                    <NoodlerLogo size={24} />
                  ) : (
                    <Home size={22} className="!text-[var(--noodle-blue)]" />
                  )}
                  {activeNoodleMode === "noodler" ? "Hub" : "Home"}
                </button>
                <button
                  type="button"
                  onClick={openNotifications}
                  disabled={isGlobalPersonaSelected}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-4 rounded-full px-3 text-left text-[0.95rem] font-semibold hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50",
                    activeNoodleView === "notifications" && "bg-[var(--noodle-blue)]/10",
                  )}
                >
                  <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                    <Bell size={22} className="!text-[var(--noodle-blue)]" />
                    {!isGlobalPersonaSelected &&
                      (activeNoodleMode === "noodler" ? noodlerNotificationCount : notificationCount) > 0 && (
                      <span
                        data-component="NoodleView.NotificationBadge"
                        className="absolute -right-2 -top-2 min-w-4 rounded-full bg-[var(--noodle-blue)] px-1 text-center text-[0.58rem] font-black leading-4 text-zinc-950 ring-2 ring-[var(--background)]"
                      >
                        {activeNoodleMode === "noodler" ? noodlerNotificationBadgeLabel : notificationBadgeLabel}
                      </span>
                    )}
                  </span>
                  Notifications
                </button>
                <button
                  type="button"
                  onClick={openOwnProfile}
                  disabled={isGlobalPersonaSelected}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-4 rounded-full px-3 text-left text-[0.95rem] font-semibold hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50",
                    activeNoodleView === "profile" && "bg-[var(--noodle-blue)]/10",
                  )}
                >
                  <User size={22} className="!text-[var(--noodle-blue)]" />
                  Profile
                </button>
                <button
                  type="button"
                  onClick={openSettings}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-4 rounded-full px-3 text-left text-[0.95rem] font-semibold hover:bg-[var(--accent)]",
                    activeNoodleView === "settings" && "bg-[var(--noodle-blue)]/10",
                  )}
                >
                  <Settings2 size={22} className="!text-[var(--noodle-blue)]" />
                  Settings
                </button>
              </nav>
              <button
                type="button"
                onClick={() => {
                  if (isGlobalPersonaSelected) return;
                  setComposer(composerValueRef.current);
                  setComposeOpen(true);
                  setActiveComposerTool(null);
                }}
                disabled={isGlobalPersonaSelected}
                className="mt-5 h-12 rounded-full bg-[var(--noodle-blue)] px-6 text-sm font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {composeActionLabel}
              </button>
              <div ref={accountSwitcherRef} className="relative mt-auto">
                {accountSwitcherOpen && (
                  <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 overflow-hidden rounded-xl border border-[var(--noodle-divider)] bg-[var(--background)] p-2 shadow-2xl shadow-black/30">
                    <p className={cn(labelClass, "px-2 pb-2")}>Switch account</p>
                    {allowGlobalPersona || sortedPersonaAccounts.length > 0 ? (
                      <div className="max-h-72 space-y-1 overflow-y-auto">
                        {allowGlobalPersona && (
                          <button
                            data-noodle-persona-id={NOODLE_GLOBAL_PERSONA_ID}
                            type="button"
                            onClick={() => {
                              setSelectedPersonaId(NOODLE_GLOBAL_PERSONA_ID);
                              setViewedProfileAccountId(null);
                              setProfileEditing(false);
                              setProfileTab("posts");
                              setProfileConnectionTab(null);
                              setTimelineTab("main");
                              setActiveNoodleView(activeNoodleMode === "noodler" ? "noodler" : "home");
                              setAccountSwitcherOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                              isGlobalPersonaSelected && "bg-[var(--noodle-blue)]/10",
                            )}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 text-[var(--noodle-blue)] ring-1 ring-[var(--noodle-blue)]/25">
                              <Globe2 size={17} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold">Global</span>
                              <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                                See every persona's posts
                              </span>
                            </span>
                            {isGlobalPersonaSelected && <span className="h-2 w-2 rounded-full bg-[var(--noodle-blue)]" />}
                          </button>
                        )}
                        {visiblePersonaAccounts.map((account) => {
                          const selected = account.id === personaAccount?.id;
                          return (
                            <button
                              key={account.id}
                              data-noodle-persona-id={account.entityId}
                              type="button"
                              onClick={() => {
                                setSelectedPersonaId(account.entityId);
                                setViewedProfileAccountId(null);
                                setProfileEditing(false);
                                setProfileTab("posts");
                                setProfileConnectionTab(null);
                                setAccountSwitcherOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                                selected && "bg-[var(--noodle-blue)]/10",
                              )}
                            >
                              <Avatar account={account} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="block truncate text-xs font-semibold">{account.displayName}</span>
                                  {isNoodlerEnabled && Boolean(account.linkedAccountId) && <NoodlerBadge />}
                                </span>
                                <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                                  @{account.handle}
                                </span>
                              </span>
                              {selected && <span className="h-2 w-2 rounded-full bg-[var(--noodle-blue)]" />}
                            </button>
                          );
                        })}
                        {hasMorePersonaAccounts && (
                          <button
                            type="button"
                            onClick={() =>
                              setPersonaAccountLimit((current) => current + NOODLE_PERSONA_SWITCHER_PAGE_SIZE)
                            }
                            className="mt-1 h-9 w-full rounded-lg text-xs font-semibold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
                          >
                            Load more ({visiblePersonaAccounts.length} of {sortedPersonaAccounts.length})
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="px-2 py-3 text-xs text-[var(--muted-foreground)]">No persona accounts yet.</p>
                    )}
                  </div>
                )}
                <button
                  data-component="NoodleView.AccountSwitcher"
                  type="button"
                  onClick={() => setAccountSwitcherOpen((current) => !current)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-full px-3 text-left transition-colors hover:bg-[var(--accent)]"
                  title="Switch account"
                >
                  {isGlobalPersonaSelected ? (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 text-[var(--noodle-blue)] ring-1 ring-[var(--noodle-blue)]/25">
                      <Globe2 size={22} />
                    </span>
                  ) : personaAccount ? (
                    <Avatar account={personaAccount} />
                  ) : (
                    <AtSign size={28} className="!text-[var(--noodle-blue)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      {isGlobalPersonaSelected ? "Global" : (personaAccount?.displayName ?? "Noodle Account")}
                      {isNoodlerEnabled && Boolean(personaAccount?.linkedAccountId) && <NoodlerBadge />}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {isGlobalPersonaSelected ? "Every persona" : personaAccount ? `@${personaAccount.handle}` : "Pick a persona"}
                    </p>
                  </div>
                  <MoreHorizontal size={18} className="!text-[var(--noodle-blue)] opacity-70" />
                </button>
              </div>
            </div>
          </aside>

          <main ref={timelineScrollRef} className="min-w-0 flex-1 overflow-y-auto lg:max-w-[640px]">
            <div className="min-h-full w-full border-x border-[var(--noodle-divider)] bg-[var(--background)] pb-[calc(52px+env(safe-area-inset-bottom))] lg:pb-0">
              {activeNoodleView === "noodler-verification" ||
              activeNoodleView === "noodler" ||
              (activeNoodleView === "profile" && !profileConnectionTab && activeNoodleMode === "noodler") ? (
                <Suspense
                  fallback={
                    <div className="flex justify-center py-14">
                      <Loader2 size={24} className="animate-spin text-[var(--noodle-blue)]" />
                    </div>
                  }
                >
                  <NoodlerHome {...noodlerHomeProps} />
                </Suspense>
              ) : activeNoodleView === "settings" ? (
                <div className="min-h-full">
                  <div className="border-b border-[var(--noodle-divider)] px-2 py-3 lg:px-4 lg:py-5">
                    <div className="flex items-center gap-3">
                      <MobileTimelineBackButton
                        label={activeNoodleMode === "noodler" ? "Back to NoodleR" : "Back to Noodle"}
                        onClick={openMobileHomeTimeline}
                      />
                      <Settings2 size={22} className="hidden text-[var(--noodle-blue)] lg:block" />
                      <div className="min-w-0">
                        <h2 className="text-lg font-bold">
                          {activeNoodleMode === "noodler" ? "NoodleR settings" : "Noodle settings"}
                        </h2>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {personaAccount ? `@${personaAccount.handle}` : "Choose a persona account"}
                        </p>
                      </div>
                    </div>
                  </div>
                  {activeNoodleMode === "noodler" ? noodlerSettingsContent : settingsContent}
                </div>
              ) : activeNoodleView === "notifications" && activeNoodleMode === "noodler" ? (
                noodlerNotificationsContent
              ) : activeNoodleView === "profile" && profileConnectionTab ? (
                <div className="min-h-full">
                  <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
                    <div className="flex min-h-14 items-center gap-3 px-3 py-2">
                      <MobileTimelineBackButton onClick={openMobileHomeTimeline} />
                      <button
                        type="button"
                        onClick={() => setProfileConnectionTab(null)}
                        className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 lg:flex"
                        title="Back to profile"
                        aria-label="Back to profile"
                      >
                        <ChevronLeft size={22} />
                      </button>
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-bold">{profilePreviewAccount.displayName}</h2>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          @{profileDisplayHandle || "noodle"}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2">
                      {PROFILE_CONNECTION_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setProfileConnectionTab(tab.id)}
                          className={cn(
                            "relative flex h-12 items-center justify-center text-sm font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                            profileConnectionTab === tab.id && "text-[var(--foreground)]",
                          )}
                        >
                          {tab.label}
                          {profileConnectionTab === tab.id && (
                            <span className="absolute bottom-0 left-1/2 h-1 w-16 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  {profileConnectionAccounts.length > 0 ? (
                    <div>
                      {profileConnectionAccounts.map((account) =>
                        renderAccountRow(account, { showFollowButton: true }),
                      )}
                    </div>
                  ) : (
                    <div className="px-8 py-14 text-center">
                      <p className="text-base font-bold">
                        {profileConnectionTab === "following" ? "Not following anyone yet." : "No followers yet."}
                      </p>
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                        Nothing boiling here yet.
                      </p>
                    </div>
                  )}
                </div>
              ) : activeNoodleView === "profile" ? (
                <PublicProfileView {...publicProfileViewProps} />
              ) : (
                <NoodleHome {...noodleHomeProps} />
              )}
            </div>
          </main>
          {activeNoodleView === "settings" || activeNoodleView === "noodler-verification" ? (
            <aside className="hidden w-[22rem] shrink-0 px-4 py-3 xl:block" aria-hidden="true" />
          ) : (
            rightRailContent
          )}
        </div>
      </div>

      <nav
        className="absolute inset-x-0 bottom-0 z-50 border-t border-[var(--noodle-divider)] bg-[var(--background)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Noodle mobile navigation"
        data-component="NoodleView.MobileBottomNav"
      >
        <div className="grid h-[52px] grid-cols-4">
          <button
            type="button"
            onClick={switchToNoodleModeMobile}
            aria-label="Noodle home"
            aria-current={activeNoodleView === "home" ? "page" : undefined}
            className="relative flex items-center justify-center transition-colors hover:bg-[var(--accent)]"
          >
            <Home size={22} strokeWidth={activeNoodleView === "home" ? 2.8 : 2} />
            {activeNoodleView === "home" && (
              <span className="absolute top-1 h-1 w-1 rounded-full bg-[var(--noodle-blue)]" />
            )}
          </button>
          <button
            type="button"
            onClick={openSearch}
            aria-label="Search Noodle"
            aria-current={activeNoodleView === "search" ? "page" : undefined}
            className="relative flex items-center justify-center transition-colors hover:bg-[var(--accent)]"
          >
            <Search size={22} strokeWidth={activeNoodleView === "search" ? 2.8 : 2} />
            {activeNoodleView === "search" && (
              <span className="absolute top-1 h-1 w-1 rounded-full bg-[var(--noodle-blue)]" />
            )}
          </button>
          <button
            type="button"
            onClick={openNotifications}
            disabled={isGlobalPersonaSelected}
            aria-label="Noodle notifications"
            aria-current={activeNoodleView === "notifications" ? "page" : undefined}
            className="relative flex items-center justify-center transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="relative flex h-6 w-6 items-center justify-center">
              <Bell size={22} strokeWidth={activeNoodleView === "notifications" ? 2.8 : 2} />
              {!isGlobalPersonaSelected &&
                (activeNoodleMode === "noodler" ? noodlerNotificationCount : notificationCount) > 0 && (
                <span
                  data-component="NoodleView.NotificationBadge"
                  className="absolute -right-2 -top-2 min-w-4 rounded-full bg-[var(--noodle-blue)] px-1 text-center text-[0.58rem] font-black leading-4 text-zinc-950 ring-2 ring-[var(--background)]"
                >
                  {activeNoodleMode === "noodler" ? noodlerNotificationBadgeLabel : notificationBadgeLabel}
                </span>
              )}
            </span>
            {activeNoodleView === "notifications" && (
              <span className="absolute top-1 h-1 w-1 rounded-full bg-[var(--noodle-blue)]" />
            )}
          </button>
          <button
            type="button"
            onClick={openNoodlerHub}
            aria-label="NoodleR"
            aria-current={activeNoodleView === "noodler" || activeNoodleView === "noodler-verification" ? "page" : undefined}
            className="relative flex items-center justify-center transition-colors hover:bg-[var(--accent)]"
          >
            <NoodlerLogo size={24} />
            {(activeNoodleView === "noodler" || activeNoodleView === "noodler-verification") && (
              <span className="absolute top-1 h-1 w-1 rounded-full bg-[var(--noodle-blue)]" />
            )}
          </button>
        </div>
      </nav>

      {composeOpen && (
        <div className="absolute inset-0 z-[70] flex items-start justify-center bg-black/45 px-3 py-12 sm:px-4 sm:py-16">
          <button
            type="button"
            aria-label="Close post composer"
            onClick={closeComposeModal}
            className="absolute inset-0"
          />
          <section
            className="marinara-chat-popover relative z-10 w-full max-w-[36rem] overflow-hidden rounded-2xl border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] text-[var(--foreground)] shadow-2xl shadow-black/35"
            style={{ backgroundColor: "var(--background)" }}
            data-component="NoodleView.ModalComposer"
          >
            <div className="flex min-h-12 items-center gap-3 border-b border-[var(--noodle-divider)] px-3">
              <button
                type="button"
                onClick={closeComposeModal}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
                title="Close"
              >
                <X size={17} />
              </button>
              <h2 className="text-sm font-bold">{activeNoodleMode === "noodler" ? "New NoodleR post" : "New post"}</h2>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
                {personaAccount ? (
                  <Avatar account={personaAccount} />
                ) : (
                  <AtSign size={28} className="text-[var(--noodle-blue)]" />
                )}
                <div className="min-w-0">
                  <textarea
                    ref={modalComposerRef}
                    autoFocus
                    defaultValue={composer}
                    onChange={handleComposerChange}
                    onBlur={() => setComposer(composerValueRef.current)}
                    onKeyDown={handleComposerKeyDown}
                    disabled={!personaAccount}
                    placeholder={composePlaceholder}
                    aria-autocomplete="list"
                    aria-controls={activeMention ? "noodle-modal-mention-list" : undefined}
                    aria-expanded={Boolean(activeMention)}
                    aria-activedescendant={
                      activeMention && mentionSuggestions.length > 0
                        ? `noodle-modal-mention-list-option-${Math.min(
                            activeMentionIndex,
                            mentionSuggestions.length - 1,
                          )}`
                        : undefined
                    }
                    className="min-h-36 w-full resize-none border-0 bg-transparent py-2 text-[1rem] leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:opacity-60"
                  />
                  {renderComposerMentionSuggestions("noodle-modal-mention-list")}
                  {renderDraftPoll()}
                  {attachedImageUrl && (
                    <div className="overflow-hidden rounded-xl border border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/10">
                      <img src={attachedImageUrl} alt="" className="max-h-60 w-full object-cover" />
                      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-[var(--noodle-blue)]">
                        <span className="min-w-0 truncate">Attached image</span>
                        <button
                          type="button"
                          onClick={() => setAttachedImageUrl("")}
                          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--noodle-blue)]/15"
                          title="Remove image"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                  {activeNoodleMode === "noodler" && personaLinkedNoodlerAccount && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { value: "public", label: "Public" },
                          {
                            value: "subscriber",
                            label:
                              typeof personaLinkedNoodlerAccount.settings?.subscriptionPrice === "number"
                                ? `Subscribers · $${(personaLinkedNoodlerAccount.settings.subscriptionPrice as number).toFixed(2)}/mo`
                                : "Subscribers only",
                          },
                          { value: "ppv", label: "Pay-per-view" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setComposerAccess(option.value)}
                          style={{ "--chip-tint": "var(--noodle-blue)" } as CSSProperties}
                          className={cn(
                            "mari-suggestion-chip",
                            composerAccess === option.value && "mari-suggestion-chip--selected",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--noodle-divider)] pt-3 pl-14">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <div ref={modalImageToolRef} className="relative">
                    <NoodleToolButton
                      title="Attach image"
                      active={activeComposerTool === "image"}
                      onClick={() => setActiveComposerTool((current) => (current === "image" ? null : "image"))}
                    >
                      <ImageIcon size={18} />
                    </NoodleToolButton>
                  </div>
                  <div ref={modalPollToolRef} className="relative">
                    <NoodleToolButton
                      title={draftPoll ? "Edit poll" : "Create poll"}
                      active={activeComposerTool === "poll" || Boolean(draftPoll)}
                      onClick={togglePollComposer}
                    >
                      <ListChecks size={18} />
                    </NoodleToolButton>
                  </div>
                  <div ref={modalMediaToolRef} className="relative">
                    <NoodleToolButton
                      title="Emoji, GIFs and stickers"
                      active={activeComposerTool === "media"}
                      onClick={() => setActiveComposerTool((current) => (current === "media" ? null : "media"))}
                    >
                      <Smile size={18} />
                    </NoodleToolButton>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={submitPost}
                  disabled={!canSubmitPost || createPost.isPending}
                  className="h-9 rounded-full bg-[var(--noodle-blue)] px-6 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createPost.isPending ? "Posting..." : composeActionLabel}
                </button>
                {composeOpen &&
                  renderComposerToolPopovers({
                    imageRef: modalImageToolRef,
                    pollRef: modalPollToolRef,
                    mediaRef: modalMediaToolRef,
                  })}
              </div>
            </div>
          </section>
        </div>
      )}
      {privateGuideAccount && (
        <Modal
          open={Boolean(privateGuideAccount)}
          onClose={() => {
            if (!refreshNoodle.isPending) setPrivateGuideAccountId(null);
          }}
          title="Generate NoodleR Post"
          width="max-w-lg"
          panelClassName={NOODLE_ICON_SCOPE_CLASS}
          panelStyle={{ "--noodle-blue": NOODLE_BLUE } as CSSProperties}
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className={labelClass}>Status</span>
                <select
                  value={privateGuideAccess}
                  onChange={(event) => setPrivateGuideAccess(event.target.value as NoodlePrivatePostAccess)}
                  className={fieldClass}
                >
                  <option value="public">Free</option>
                  <option value="subscriber">Subscribers only</option>
                  <option value="ppv">Pay-per-post</option>
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className={labelClass}>Theme</span>
                <input
                  value={privateGuideTheme}
                  onChange={(event) => setPrivateGuideTheme(event.target.value)}
                  placeholder="Behind the scenes, outfit drop, flirt, teaser"
                  className={fieldClass}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-3 text-xs font-semibold text-[var(--foreground)]">
              <label className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--noodle-divider)] px-3">
                <input
                  type="checkbox"
                  checked={privateGuideIncludeText}
                  onChange={(event) => setPrivateGuideIncludeText(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--noodle-blue)]"
                />
                Text
              </label>
              <label className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--noodle-divider)] px-3">
                <input
                  type="checkbox"
                  checked={privateGuideIncludeImage}
                  onChange={(event) => setPrivateGuideIncludeImage(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--noodle-blue)]"
                />
                Image
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className={labelClass}>Prompt</span>
              <textarea
                value={privateGuidePrompt}
                onChange={(event) => setPrivateGuidePrompt(event.target.value)}
                placeholder="Tell the generator what this private post should be about."
                className={cn(textareaClass, "min-h-28 resize-none")}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPrivateGuideAccountId(null)}
                disabled={refreshNoodle.isPending}
                className="h-9 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] px-4 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => generateGuidedPrivatePost(privateGuideAccount)}
                disabled={refreshNoodle.isPending || (!privateGuideIncludeText && !privateGuideIncludeImage)}
                className="flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refreshNoodle.isPending && <Loader2 size={14} className="animate-spin" />}
                {refreshNoodle.isPending ? "Generating" : "Generate"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmAction && (
        <Modal
          open={Boolean(confirmAction)}
          onClose={() => {
            if (!confirmActionPending) setConfirmAction(null);
          }}
          title={confirmAction.title}
          width="max-w-sm"
          panelClassName={NOODLE_ICON_SCOPE_CLASS}
          panelStyle={{ "--noodle-blue": NOODLE_BLUE } as CSSProperties}
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-[var(--foreground)]">{confirmAction.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={confirmActionPending}
                className="h-9 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] px-4 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmNoodleAction}
                disabled={confirmActionPending}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded-md px-4 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  confirmAction.kind === "reset-timeline"
                    ? "border border-[var(--noodle-blue)]/45 bg-[var(--noodle-blue)] text-[var(--background)] hover:bg-[var(--noodle-blue)]/85"
                    : "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90",
                )}
              >
                {confirmActionPending && <Loader2 size={14} className="animate-spin" />}
                {confirmActionPending ? "Working" : confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <ImagePromptReviewModal
        open={imagePromptReviewItems.length > 0}
        items={imagePromptReviewItems}
        isSubmitting={confirmNoodleImagePrompts.isPending}
        onCancel={() => setImagePromptReviewItems([])}
        onConfirm={confirmReviewedNoodleImagePrompts}
      />
    </div>
  );
}

function NumberSetting({
  label,
  help,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  help?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const draftRef = useRef(String(value));
  const savedValueRef = useRef(value);
  const dirtyRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  const boundsRef = useRef({ min, max });

  onCommitRef.current = onCommit;
  boundsRef.current = { min, max };

  useEffect(() => {
    savedValueRef.current = value;
    if (dirtyRef.current) return;
    const nextDraft = String(value);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, [value]);

  useEffect(
    () => () => {
      if (!dirtyRef.current) return;
      const parsed = Number(draftRef.current);
      if (!Number.isFinite(parsed)) return;
      const bounds = boundsRef.current;
      const normalized = Math.max(bounds.min, Math.min(bounds.max, Math.round(parsed)));
      if (normalized !== savedValueRef.current) onCommitRef.current(normalized);
    },
    [],
  );

  const commitDraft = (rawDraft: string) => {
    const parsed = Number(rawDraft);
    if (!Number.isFinite(parsed)) {
      const savedDraft = String(savedValueRef.current);
      draftRef.current = savedDraft;
      dirtyRef.current = false;
      setDraft(savedDraft);
      return;
    }
    const normalized = Math.max(min, Math.min(max, Math.round(parsed)));
    const normalizedDraft = String(normalized);
    draftRef.current = normalizedDraft;
    dirtyRef.current = false;
    setDraft(normalizedDraft);
    if (normalized === savedValueRef.current) return;
    savedValueRef.current = normalized;
    onCommitRef.current(normalized);
  };

  return (
    <label className="block space-y-1.5">
      <FieldLabel help={help}>{label}</FieldLabel>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => {
          draftRef.current = event.target.value;
          dirtyRef.current = true;
          setDraft(event.target.value);
        }}
        onBlur={(event) => commitDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={fieldClass}
      />
    </label>
  );
}
