// ──────────────────────────────────────────────
// Noodle: types, constants, and small presentational
// primitives shared between NoodleView (shell),
// NoodleHome (public feed), and NoodlerHome (private hub).
// ──────────────────────────────────────────────
import { ChevronLeft, ChevronRight, Lock, RefreshCw, Search, X, Home } from "lucide-react";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type {
  NoodleAccount,
  NoodleInteraction,
  NoodleInteractionType,
  NoodlePost,
  NoodleTextMention,
} from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import type { AvatarCropValue } from "../../lib/utils";
import { getAvatarCropStyle } from "../../lib/utils";
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
export const NOODLE_ICON_SCOPE_CLASS = "[&_svg]:!text-[var(--noodle-blue)]";
export const NOODLE_LOGO_SRC = "/noodle-klusek.png";

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
      <Lock size={10} strokeWidth={2.6} />
    </span>
  );
}

export function NoodlerPrivateBadge({ className }: { className?: string }) {
  return (
    <span
      title="Private NoodleR account"
      aria-label="Private NoodleR account"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--noodle-blue)] px-1.5 py-0.5 text-[0.6rem] font-black leading-none text-zinc-950",
        className,
      )}
    >
      <Lock size={9} strokeWidth={3} />
      NoodleR
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
  const modes: Array<{ id: NoodleMode; icon: typeof Home; onClick: () => void }> = [
    { id: "noodle", icon: Home, onClick: onOpenNoodle },
    { id: "noodler", icon: Lock, onClick: onOpenNoodler },
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
