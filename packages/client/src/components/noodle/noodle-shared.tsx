// ──────────────────────────────────────────────
// Noodle: types, constants, and small presentational
// primitives shared between NoodleView (shell),
// NoodleHome (public feed), and NoodlerHome (private hub).
// ──────────────────────────────────────────────
import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  ListChecks,
  Loader2,
  Lock,
  MapPin,
  RefreshCw,
  Search,
  Smile,
  X,
  Home,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  type CSSProperties,
} from "react";
import type {
  NoodleAccount,
  NoodleInteraction,
  NoodleInteractionType,
  NoodlePost,
  NoodlePrivateIdentityDisclosure,
  NoodleTextMention,
} from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import type { AvatarCropValue } from "../../lib/utils";
import { getAvatarCropStyle } from "../../lib/utils";
import { renderInlineWithCustomEmojis } from "../../lib/custom-emoji-render";
import type { ChatImage } from "../../hooks/use-gallery";

export type ComposerTool = "image" | "poll" | "media";
export type ReplyComposerTool = "image" | "media";
export type ProfileTab = "posts" | "likes" | "media";
export type ProfileConnectionTab = "followers" | "following";
export type NotificationTab = "likes" | "follows" | "replies";
export type TimelineTab = "main" | "following";
export type NoodlerHubTab = "timeline" | "subscriptions" | "discover" | "owned";
export type NoodleMode = "noodle" | "noodler";
export type NoodleViewId = "home" | "search" | "notifications" | "profile" | "settings" | "noodler" | "noodler-verification";
export type NoodleNotificationFocusTarget = {
  postId: string;
  interactionId: string | null;
};
export type ActiveComposerMention = NoodleTextMention & { query: string };
export type NoodlerTimelineItem =
  | { id: string; kind: "post"; createdAt: string; post: NoodlePost }
  | {
      id: string;
      kind: "subscription" | "unlock" | "reply";
      createdAt: string;
      creatorAccount: NoodleAccount | null;
      actorAccount: NoodleAccount | null;
      post: NoodlePost | null;
      interaction?: NoodleInteraction;
    };

export const fieldClass =
  "mari-chrome-field h-9 w-full min-w-0 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--noodle-blue)]";
export const textareaClass =
  "mari-chrome-field min-h-24 w-full min-w-0 resize-y rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] p-3 text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--noodle-blue)]";
export const labelClass =
  "text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--marinara-chat-chrome-panel-muted)]";
export const iconButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium !text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:!text-[var(--noodle-blue)]";
export const NOODLE_BLUE = "#7EA7FF";
export const NOODLER_BLUE = "#FF6FAE";
export const NOODLE_GLOBAL_PERSONA_ID = "__global__";
export const NOODLE_ICON_SCOPE_CLASS = "[&_svg]:!text-[var(--noodle-blue)]";
export const NOODLE_LOGO_SRC = "/noodle-klusek.png";

export const PROFILE_TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: "posts", label: "Posts" },
  { id: "likes", label: "Likes" },
  { id: "media", label: "Media" },
];

export const NOODLE_MODE_META: Record<NoodleMode, { label: string; url: string; tagline: string }> = {
  noodle: {
    label: "Noodle",
    url: "https://noodle.local",
    tagline: "Public social timeline",
  },
  noodler: {
    label: "NoodleR",
    url: "https://noodler.local",
    tagline: "Private creator network",
  },
};

export function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function privateStageProfileFromAccount(account: NoodleAccount | null) {
  return parseRecord(account?.settings?.stageProfile);
}

export function readPrivateStageSetting(account: NoodleAccount | null, key: string) {
  return readString(privateStageProfileFromAccount(account)[key]).trim();
}

export function readPrivateIdentityDisclosure(account: NoodleAccount | null): NoodlePrivateIdentityDisclosure {
  const value = readPrivateStageSetting(account, "identityDisclosure");
  return value === "open" || value === "secret" ? value : "hinted";
}

export function fanActivitySettingsFromAccount(account: NoodleAccount | null | undefined) {
  return parseRecord(account?.settings?.fanActivity);
}

export function readFanActivityEnabled(account: NoodleAccount | null | undefined) {
  return fanActivitySettingsFromAccount(account).enabled === true;
}

export function readFanActivityIntensity(account: NoodleAccount | null | undefined): "low" | "medium" | "high" {
  const value = fanActivitySettingsFromAccount(account).intensity;
  return value === "medium" || value === "high" ? value : "low";
}

export function readFanActivityAutoSchedule(account: NoodleAccount | null | undefined) {
  return fanActivitySettingsFromAccount(account).autoSchedule === true;
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "N"
  );
}

export function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function countInteractions(interactions: NoodleInteraction[], type: NoodleInteractionType) {
  return interactions.filter((interaction) => interaction.type === type).length;
}

// Display-only simulated pricing — no real payment is ever processed. Falls
// back to a plain label when the creator hasn't set a subscriptionPrice.
export function subscribeLabel(account: Pick<NoodleAccount, "settings">, subscribed: boolean) {
  if (subscribed) return "Subscribed";
  const price = account.settings?.subscriptionPrice;
  return typeof price === "number" ? `Subscribe · $${price.toFixed(2)}/mo` : "Subscribe";
}

export function unlockLabel(post: Pick<NoodlePost, "access" | "metadata">) {
  if (post.access !== "ppv") return "Subscribers only";
  const price = post.metadata?.ppvPrice;
  return typeof price === "number" ? `Unlock · $${price.toFixed(2)}` : "Pay-per-post";
}

export function createNoodleLightboxImage(id: string, url: string, prompt = ""): ChatImage {
  const filename = url.split("?")[0]?.split("/").pop();
  const safeFilename = filename && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(filename) ? filename : `noodle-${id}.png`;
  return {
    id,
    chatId: "noodle",
    filePath: safeFilename,
    prompt,
    provider: "",
    model: "",
    width: null,
    height: null,
    createdAt: "",
    url,
  };
}

export function Avatar({
  account,
  size = "md",
}: {
  account: Pick<NoodleAccount, "displayName" | "avatarUrl"> & { avatarCrop?: AvatarCropValue | null };
  size?: "sm" | "md" | "lg";
}) {
  const dimension = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-24 w-24" : "h-11 w-11";
  if (account.avatarUrl) {
    return (
      <div
        className={cn(
          dimension,
          "relative aspect-square flex-none overflow-hidden rounded-full border border-[var(--noodle-blue)]/30",
        )}
      >
        <img
          src={account.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          style={getAvatarCropStyle(account.avatarCrop)}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        dimension,
        "flex aspect-square flex-none items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 text-xs font-bold text-[var(--noodle-blue)] ring-1 ring-[var(--noodle-blue)]/25",
      )}
    >
      {initials(account.displayName)}
    </div>
  );
}

export function NoodleLogo({ className }: { className?: string }) {
  return <img src={NOODLE_LOGO_SRC} alt="" className={cn("object-contain", className)} />;
}

/** NoodleR's mark: a bold "R" glyph, used everywhere Noodle uses an icon for NoodleR-branded chrome. */
export function NoodlerMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center font-black leading-none", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.82) }}
    >
      R
    </span>
  );
}

export function NoodlerBadge({ className }: { className?: string }) {
  return (
    <span
      title="Has a NoodleR page"
      aria-label="Has a NoodleR page"
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 text-[var(--noodle-blue)]",
        className,
      )}
    >
      <NoodlerMark size={10} />
    </span>
  );
}

export function NoodlerPrivateBadge({ className }: { className?: string }) {
  return (
    <span
      title="Private NoodleR account"
      aria-label="Private NoodleR account"
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--noodle-blue)] text-zinc-950",
        className,
      )}
    >
      <NoodlerMark size={12} />
    </span>
  );
}

export function MobileTimelineBackButton({
  label = "Back to Noodle timeline",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 lg:hidden"
      title={label}
      aria-label={label}
    >
      <ChevronLeft size={22} />
    </button>
  );
}

export function NoodleModeSwitcher({
  activeMode,
  onOpenNoodle,
  onOpenNoodler,
}: {
  activeMode: NoodleMode;
  onOpenNoodle: () => void;
  onOpenNoodler: () => void;
}) {
  const modes: Array<{
    id: NoodleMode;
    icon: (props: { size?: number; className?: string }) => ReactNode;
    onClick: () => void;
  }> = [
    { id: "noodle", icon: Home, onClick: onOpenNoodle },
    { id: "noodler", icon: NoodlerMark, onClick: onOpenNoodler },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--noodle-divider)] bg-[var(--card)] p-1">
      {modes.map((mode) => {
        const Icon = mode.icon;
        const active = activeMode === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={mode.onClick}
            aria-pressed={active}
            className={cn(
              "flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              active && "bg-[var(--noodle-blue)]/15 text-[var(--foreground)] ring-1 ring-[var(--noodle-blue)]/30",
            )}
          >
            <Icon size={14} className={cn(active && "!text-[var(--noodle-blue)]")} />
            <span className="truncate">{NOODLE_MODE_META[mode.id].label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function BrowserChrome({ mode, path }: { mode: NoodleMode; path: string }) {
  const meta = NOODLE_MODE_META[mode];
  const host = mode === "noodler" ? "noodler.local" : "noodle.local";
  return (
    <div className="hidden h-11 shrink-0 items-center gap-2 border-b border-[var(--noodle-divider)] bg-[var(--background)] px-3 lg:flex">
      <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--noodle-blue)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--muted-foreground)]/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--muted-foreground)]/25" />
      </div>
      <div className="hidden items-center gap-0.5 sm:flex" aria-hidden="true">
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)] opacity-70">
          <ChevronLeft size={15} />
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)] opacity-50">
          <ChevronRight size={15} />
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)]">
          <RefreshCw size={14} />
        </span>
      </div>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--card)] px-3 text-xs shadow-sm">
        <Lock size={13} className="hidden shrink-0 text-[var(--noodle-blue)] sm:block" />
        <Search size={14} className="shrink-0 text-[var(--noodle-blue)] sm:hidden" />
        <span className="truncate text-[var(--foreground)] sm:hidden">{`${host}${path}`}</span>
        <span className="hidden truncate text-[var(--foreground)] sm:inline">{`${meta.url}${path}`}</span>
        <span className="hidden rounded-full bg-[var(--noodle-blue)]/15 px-2 py-0.5 font-semibold text-[var(--noodle-blue)] sm:inline-flex">
          {meta.label}
        </span>
      </div>
    </div>
  );
}

export function NoodleAnchoredPopover({
  anchorRef,
  children,
  wide,
  className,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const panelWidth = panelRef.current?.offsetWidth ?? (wide ? 384 : 304);
      const padding = 16;
      const maxLeft = Math.max(padding, window.innerWidth - panelWidth - padding);
      const centeredLeft = anchorRect.left + anchorRect.width / 2 - panelWidth / 2;
      setPosition({
        left: Math.min(Math.max(centeredLeft, padding), maxLeft),
        top: anchorRect.bottom + 12,
      });
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, wide]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        "fixed z-[80] max-w-[calc(100vw-2rem)]",
        NOODLE_ICON_SCOPE_CLASS,
        wide ? "w-[18rem] sm:w-[24rem]" : "w-[19rem]",
        className,
      )}
      style={
        {
          "--noodle-blue": NOODLE_BLUE,
          "--noodle-divider": "var(--marinara-chat-chrome-panel-divider)",
          left: position?.left ?? -9999,
          top: position?.top ?? -9999,
          opacity: position ? 1 : 0,
        } as CSSProperties
      }
    >
      {children}
    </div>,
    document.body,
  );
}

export function NoodleToolPopover({
  title,
  onClose,
  children,
  wide,
  anchorRef,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  return (
    <NoodleAnchoredPopover anchorRef={anchorRef} wide={wide}>
      <div className="marinara-chat-popover flex h-[22rem] max-h-[60vh] flex-col overflow-hidden rounded-xl border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] text-[var(--foreground)] shadow-2xl shadow-black/35">
        <div className="flex shrink-0 items-center gap-1 border-b border-foreground/10 px-2 py-1.5">
          <span className="flex-1 rounded-md bg-foreground/10 px-2 py-1 text-center text-xs font-medium text-foreground/80 ring-1 ring-foreground/15">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--noodle-blue)] transition-colors hover:bg-foreground/10"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </div>
    </NoodleAnchoredPopover>
  );
}

export function NoodleToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 !text-[var(--noodle-blue)] transition-colors active:scale-95 [&_svg]:!text-[var(--noodle-blue)]",
        active ? "bg-[var(--noodle-blue)]/15 ring-1 ring-[var(--noodle-blue)]/25" : "hover:bg-[var(--noodle-blue)]/10",
      )}
    >
      {children}
    </button>
  );
}

export interface InlineComposerProps {
  personaAccount: NoodleAccount | null;
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
  renderComposerMentionSuggestions: (listboxId: string) => ReactNode;
  renderDraftPoll: () => ReactNode;
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
  }) => ReactNode;
  mentionListboxId: string;
  dataComponent?: string;
}

export function InlineComposer(props: InlineComposerProps) {
  const {
    personaAccount,
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
    mentionListboxId,
    dataComponent = "InlineComposer",
  } = props;

  if (composeOpen) return null;

  return (
    <div className="border-b border-[var(--noodle-divider)] px-4 py-3" data-component={dataComponent}>
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
            aria-controls={activeMention ? mentionListboxId : undefined}
            aria-expanded={Boolean(activeMention)}
            aria-activedescendant={
              activeMention && mentionSuggestionsCount > 0
                ? `${mentionListboxId}-option-${Math.min(activeMentionIndex, mentionSuggestionsCount - 1)}`
                : undefined
            }
            className="min-h-20 w-full resize-none border-0 bg-transparent py-2 text-[1rem] leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:opacity-60"
          />
          {renderComposerMentionSuggestions(mentionListboxId)}
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
        {renderComposerToolPopovers({ imageRef: imageToolRef, pollRef: pollToolRef, mediaRef: mediaToolRef })}
      </div>
    </div>
  );
}

export function RefreshTimelineButton({
  onTriggerRefresh,
  refreshNoodlePending,
  disabled = false,
}: {
  onTriggerRefresh: () => void;
  refreshNoodlePending: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="border-b border-[var(--noodle-divider)] px-4 py-2">
      <button
        type="button"
        onClick={onTriggerRefresh}
        disabled={refreshNoodlePending || disabled}
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
  );
}

export function NoodleCustomEmojiText({
  text,
  emojiMap,
  keyPrefix,
}: {
  text: string;
  emojiMap: Map<string, string>;
  keyPrefix: string;
}) {
  return (
    <>
      {renderInlineWithCustomEmojis(text, keyPrefix, emojiMap, (segment, key) => [
        <Fragment key={key}>{segment}</Fragment>,
      ])}
    </>
  );
}

// ──────────────────────────────────────────────
// Profile view chrome shared between the public profile
// (rendered by NoodleHome's PublicProfileView) and the private
// profile (rendered by NoodlerHome's PrivateProfileView). Purely
// presentational: which mode-specific actions/panels render around
// this chrome is decided by the caller via slots, not by this
// component reading account visibility itself.
// ──────────────────────────────────────────────
export interface ProfileHeaderChromeProps {
  onBackToHome: () => void;
  profileDisplayHandle: string;
  canEditViewedProfile: boolean;
  hasViewedProfileAccount: boolean;
  profileUploadTarget: "avatar" | "banner" | null;
  onBannerClick: () => void;
  onAvatarClick: () => void;
  profileBannerPreview: string;
  profilePreviewAccount: { displayName: string; avatarUrl: string | null; avatarCrop: AvatarCropValue | null };
  bannerFileRef: RefObject<HTMLInputElement | null>;
  avatarFileRef: RefObject<HTMLInputElement | null>;
  onProfileImageFile: (target: "avatar" | "banner", event: ChangeEvent<HTMLInputElement>) => void;
  isEditingProfile: boolean;
  onEditToggle: () => void;
  canSaveProfile: boolean;
  updateAccountPending: boolean;
  /** Rendered instead of the Edit button when the viewer can't edit this profile — e.g. Follow or Subscribe. */
  nonEditAction: ReactNode;
  /** Extra buttons after the primary action — e.g. Create/Open NoodleR, Delete NoodleR profile. */
  extraActionButtons?: ReactNode;
  profileName: string;
  onProfileNameChange: (value: string) => void;
  profileHandle: string;
  onProfileHandleChange: (value: string) => void;
  profileBio: string;
  onProfileBioChange: (value: string) => void;
  profileLocation: string;
  onProfileLocationChange: (value: string) => void;
  /** e.g. NoodlerBadge / NoodlerPrivateBadge next to the display name. */
  badge?: ReactNode;
  profileBioPreview: string;
  noodleCustomEmojiMap: Map<string, string>;
  emojiKeyPrefix: string;
  profileLocationPreview: string;
  /** Mode-specific chips rendered below the location line — e.g. identity/dynamic chips on private profiles. */
  belowBioContent?: ReactNode;
  profileFollowingCount: number;
  profileFollowerCount: number;
  onOpenFollowing: () => void;
  onOpenFollowers: () => void;
}

export function ProfileHeaderChrome(props: ProfileHeaderChromeProps) {
  const {
    onBackToHome,
    profileDisplayHandle,
    canEditViewedProfile,
    hasViewedProfileAccount,
    profileUploadTarget,
    onBannerClick,
    onAvatarClick,
    profileBannerPreview,
    profilePreviewAccount,
    bannerFileRef,
    avatarFileRef,
    onProfileImageFile,
    isEditingProfile,
    onEditToggle,
    canSaveProfile,
    updateAccountPending,
    nonEditAction,
    extraActionButtons,
    profileName,
    onProfileNameChange,
    profileHandle,
    onProfileHandleChange,
    profileBio,
    onProfileBioChange,
    profileLocation,
    onProfileLocationChange,
    badge,
    profileBioPreview,
    noodleCustomEmojiMap,
    emojiKeyPrefix,
    profileLocationPreview,
    belowBioContent,
    profileFollowingCount,
    profileFollowerCount,
    onOpenFollowing,
    onOpenFollowers,
  } = props;

  return (
    <>
      <div className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 px-2 py-2 backdrop-blur lg:hidden">
        <MobileTimelineBackButton onClick={onBackToHome} />
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">Profile</h2>
          <p className="truncate text-xs text-[var(--muted-foreground)]">@{profileDisplayHandle || "noodle"}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onBannerClick}
        disabled={!canEditViewedProfile || profileUploadTarget === "banner"}
        className={cn(
          "relative block h-40 w-full overflow-hidden bg-[var(--noodle-blue)]/15 text-left disabled:cursor-default",
          profileUploadTarget === "banner" && "cursor-wait opacity-80",
        )}
        title={canEditViewedProfile ? "Upload banner" : undefined}
      >
        {profileBannerPreview ? (
          <img src={profileBannerPreview} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center bg-[var(--noodle-blue)]/10">
            <NoodleLogo className="h-20 w-32 opacity-70" />
          </div>
        )}
        {profileUploadTarget === "banner" && (
          <span className="absolute bottom-3 right-3 rounded-full bg-[var(--marinara-chat-chrome-panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--noodle-blue)] shadow-lg ring-1 ring-[var(--marinara-chat-chrome-panel-border)]">
            Uploading...
          </span>
        )}
      </button>
      <input
        ref={bannerFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => onProfileImageFile("banner", event)}
      />

      <div className="px-4 pb-5">
        <div className="-mt-10 flex items-end justify-between gap-3">
          <button
            type="button"
            onClick={onAvatarClick}
            disabled={!canEditViewedProfile || profileUploadTarget === "avatar"}
            className={cn(
              "relative rounded-full bg-[var(--background)] p-1 text-left disabled:cursor-default",
              profileUploadTarget === "avatar" && "cursor-wait opacity-80",
            )}
            title={canEditViewedProfile ? "Upload avatar" : undefined}
          >
            <Avatar account={profilePreviewAccount} size="lg" />
            {profileUploadTarget === "avatar" && (
              <span className="absolute inset-1 flex items-center justify-center rounded-full bg-black/50 text-[0.625rem] font-semibold text-white">
                Uploading
              </span>
            )}
          </button>
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => onProfileImageFile("avatar", event)}
          />
          {canEditViewedProfile ? (
            <button
              type="button"
              onClick={onEditToggle}
              disabled={isEditingProfile ? !canSaveProfile || updateAccountPending : !hasViewedProfileAccount}
              className="mb-1 h-9 rounded-full bg-[var(--noodle-blue)] px-5 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEditingProfile ? (updateAccountPending ? "Saving" : "Save") : "Edit Profile"}
            </button>
          ) : (
            nonEditAction
          )}
          {extraActionButtons}
        </div>

        {isEditingProfile ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className={labelClass}>Display name</span>
                <input
                  value={profileName}
                  onChange={(event) => onProfileNameChange(event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="block space-y-1.5">
                <span className={labelClass}>@name</span>
                <input
                  value={profileHandle}
                  onChange={(event) => onProfileHandleChange(event.target.value)}
                  className={fieldClass}
                  placeholder="@mari"
                />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className={labelClass}>Bio</span>
              <textarea
                value={profileBio}
                onChange={(event) => onProfileBioChange(event.target.value)}
                className={cn(fieldClass, "h-24 resize-none py-2")}
              />
            </label>
            <label className="block space-y-1.5">
              <span className={labelClass}>Location</span>
              <input
                value={profileLocation}
                onChange={(event) => onProfileLocationChange(event.target.value)}
                className={fieldClass}
                placeholder="Somewhere cozy"
              />
            </label>
          </div>
        ) : (
          <div className="mt-3">
            <h3 className="flex items-center gap-1.5 text-xl font-bold leading-tight">
              {profilePreviewAccount.displayName}
              {badge}
            </h3>
            <p className="text-sm text-[var(--muted-foreground)]">@{profileDisplayHandle || "noodle"}</p>
            {profileBioPreview && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                <NoodleCustomEmojiText text={profileBioPreview} emojiMap={noodleCustomEmojiMap} keyPrefix={emojiKeyPrefix} />
              </p>
            )}
            {profileLocationPreview && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                <MapPin size={15} className="text-[var(--noodle-blue)]" />
                {profileLocationPreview}
              </p>
            )}
            {belowBioContent}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--muted-foreground)]">
              <button type="button" onClick={onOpenFollowing} className="transition-colors hover:text-[var(--noodle-blue)]">
                <span className="font-bold text-[var(--foreground)]">{profileFollowingCount}</span> Following
              </button>
              <button type="button" onClick={onOpenFollowers} className="transition-colors hover:text-[var(--noodle-blue)]">
                <span className="font-bold text-[var(--foreground)]">{profileFollowerCount}</span> Followers
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export interface ProfileTabsAndGridProps {
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  posts: NoodlePost[];
  isGridLayout: boolean;
  renderPostGrid: (posts: NoodlePost[]) => ReactNode;
  renderPostArticle: (post: NoodlePost) => ReactNode;
}

export function ProfileTabsAndGrid({
  activeTab,
  onTabChange,
  posts,
  isGridLayout,
  renderPostGrid,
  renderPostArticle,
}: ProfileTabsAndGridProps) {
  return (
    <div className="border-t border-[var(--noodle-divider)]">
      <div className="grid grid-cols-3 border-b border-[var(--noodle-divider)]">
        {PROFILE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative flex h-12 items-center justify-center text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              activeTab === tab.id && "text-[var(--foreground)]",
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
            )}
          </button>
        ))}
      </div>
      {posts.length > 0 ? (
        isGridLayout ? (
          renderPostGrid(posts)
        ) : (
          <div>{posts.map(renderPostArticle)}</div>
        )
      ) : (
        <div className="px-8 py-14 text-center">
          <p className="text-sm font-semibold text-[var(--muted-foreground)]">Nothing boiling here yet.</p>
        </div>
      )}
    </div>
  );
}
