// ──────────────────────────────────────────────
// Noodle: creator tools panel — guided AI post generation, avatar/stage
// identity retry, and manual composer for an account's own profile page.
// `mode="noodler"` enables the NoodleR-only controls (guided AI post,
// access level, pay-per-view pricing); `mode="public"` renders just the
// plain manual composer, so the same panel can back a future guided
// posting flow on public Noodle profiles.
// ──────────────────────────────────────────────
import type { CSSProperties } from "react";
import type { NoodleAccount, NoodlePostAccess } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { fieldClass, textareaClass } from "./noodle-shared";

export interface CreatorToolsPanelProps {
  mode: "noodler" | "public";
  account: NoodleAccount;

  // AI-guided post generation (NoodleR mode only)
  onOpenGuidedPost?: (account: NoodleAccount) => void;
  guidedPostPending?: boolean;

  // Stage identity / avatar generation-failure retry (NoodleR mode only)
  onRetryIdentity?: (accountId: string) => void;
  retryIdentityPending?: boolean;

  // Manual composer
  composerText: string;
  onComposerTextChange: (value: string) => void;
  composerAccess: NoodlePostAccess;
  onComposerAccessChange: (access: NoodlePostAccess) => void;
  composerPpvPrice: string;
  onComposerPpvPriceChange: (value: string) => void;
  composerImageUrl: string;
  onComposerImageUrlChange: (value: string) => void;
  onSubmitPost: () => void;
  createPostPending: boolean;
}

export function CreatorToolsPanel(props: CreatorToolsPanelProps) {
  const {
    mode,
    account,
    onOpenGuidedPost,
    guidedPostPending,
    onRetryIdentity,
    retryIdentityPending,
    composerText,
    onComposerTextChange,
    composerAccess,
    onComposerAccessChange,
    composerPpvPrice,
    onComposerPpvPriceChange,
    composerImageUrl,
    onComposerImageUrlChange,
    onSubmitPost,
    createPostPending,
  } = props;

  const isNoodler = mode === "noodler";

  return (
    <details className="group rounded-lg border border-[var(--noodle-divider)] bg-[var(--card)]/60" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-bold text-[var(--foreground)] marker:hidden [&::-webkit-details-marker]:hidden">
        <span>{isNoodler ? "NoodleR creator tools" : "Creator tools"}</span>
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] group-open:hidden">
          Open
        </span>
        <span className="hidden text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] group-open:inline">
          Hide
        </span>
      </summary>
      <div className="space-y-3 border-t border-[var(--noodle-divider)] p-3 pt-2">
        {isNoodler && (
          <p className="text-xs leading-5 text-[var(--muted-foreground)]">
            Generate a guided post or post manually. Stage identity, pricing, fan activity, and automatic posting
            live in Settings.
          </p>
        )}

        {isNoodler && onOpenGuidedPost && (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--noodle-divider)] p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h5 className="text-xs font-bold text-[var(--foreground)]">Generate with AI</h5>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                One guided post — choose access, theme, and whether to include text and/or an image.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenGuidedPost(account)}
              disabled={guidedPostPending}
              className="h-8 shrink-0 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate guided post
            </button>
          </div>
        )}

        {isNoodler &&
          (account.settings?.stageIdentityGenerationFailed === true ||
            account.settings?.avatarGenerationFailed === true) && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
              <span>
                {account.settings?.stageIdentityGenerationFailed === true
                  ? (account.settings.stageIdentityGenerationError as string | undefined) ||
                    "Stage identity generation failed — this profile is using placeholder defaults."
                  : (account.settings?.avatarGenerationError as string | undefined) ||
                    "Avatar generation failed for this profile."}
              </span>
              <button
                type="button"
                onClick={() => onRetryIdentity?.(account.id)}
                disabled={retryIdentityPending}
                className="h-7 shrink-0 rounded-full border border-[var(--destructive)]/50 px-3 font-bold transition-colors hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retryIdentityPending ? "Retrying…" : "Retry"}
              </button>
            </div>
          )}

        <textarea
          value={composerText}
          onChange={(event) => onComposerTextChange(event.target.value)}
          placeholder={isNoodler ? "Post to your NoodleR…" : "Post to Noodle…"}
          className={cn(textareaClass, "min-h-14 w-full resize-none bg-transparent")}
        />
        {isNoodler && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(
              [
                { value: "public", label: "Public" },
                {
                  value: "subscriber",
                  label:
                    typeof account.settings?.subscriptionPrice === "number"
                      ? `Subscribers · $${(account.settings.subscriptionPrice as number).toFixed(2)}/mo`
                      : "Subscribers only",
                },
                { value: "ppv", label: "Pay-per-view" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onComposerAccessChange(option.value)}
                style={{ "--chip-tint": "var(--noodle-blue)" } as CSSProperties}
                className={cn(
                  "mari-suggestion-chip",
                  composerAccess === option.value && "mari-suggestion-chip--selected",
                )}
              >
                {option.label}
              </button>
            ))}
            {composerAccess === "ppv" && (
              <input
                value={composerPpvPrice}
                onChange={(event) => onComposerPpvPriceChange(event.target.value)}
                placeholder="Price (optional)"
                inputMode="decimal"
                className={cn(fieldClass, "h-7 w-28")}
              />
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={composerImageUrl}
            onChange={(event) => onComposerImageUrlChange(event.target.value)}
            placeholder="Image URL (optional)"
            className={cn(fieldClass, "h-8 flex-1")}
          />
          <button
            type="button"
            onClick={onSubmitPost}
            disabled={createPostPending || (!composerText.trim() && !composerImageUrl.trim())}
            className="ml-auto h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Post
          </button>
        </div>
      </div>
    </details>
  );
}
