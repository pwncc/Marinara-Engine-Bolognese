import { Sparkles } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { NoodleAccount, NoodlePostAccess } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { fieldClass, InlineComposer, type InlineComposerProps, readPrivatePostingMode } from "./noodle-shared";

export interface PostingToolsProps extends InlineComposerProps {
  account: NoodleAccount;
  mode: "noodle" | "noodler";
  defaultExpanded: boolean;
  access: NoodlePostAccess;
  onAccessChange: (access: NoodlePostAccess) => void;
  ppvPrice: string;
  onPpvPriceChange: (value: string) => void;
  onOpenGuidedPost?: (account: NoodleAccount) => void;
  guidedPostPending?: boolean;
}

export function PostingTools({
  account,
  mode,
  defaultExpanded,
  access,
  onAccessChange,
  ppvPrice,
  onPpvPriceChange,
  onOpenGuidedPost,
  guidedPostPending = false,
  dataComponent = "PostingTools",
  ...composerProps
}: PostingToolsProps) {
  const isNoodler = mode === "noodler";
  const guidedAvailable = isNoodler && readPrivatePostingMode(account) === "active";
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => setExpanded(defaultExpanded), [defaultExpanded]);

  return (
    <details
      className="group border-b border-[var(--noodle-divider)] bg-[var(--background)]"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      data-component={dataComponent}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold marker:hidden [&::-webkit-details-marker]:hidden">
        <span>Posting tools · @{account.handle}</span>
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] group-open:hidden">
          Open
        </span>
        <span className="hidden text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] group-open:inline">
          Hide
        </span>
      </summary>
      <div className="border-t border-[var(--noodle-divider)]">
        {isNoodler && (
          <div className="space-y-2 border-b border-[var(--noodle-divider)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { value: "public", label: "Public" },
                  { value: "subscriber", label: "Subscribers" },
                  { value: "ppv", label: "PPV" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onAccessChange(option.value)}
                  aria-pressed={access === option.value}
                  style={{ "--chip-tint": "var(--noodle-blue)" } as CSSProperties}
                  className={cn("mari-suggestion-chip", access === option.value && "mari-suggestion-chip--selected")}
                >
                  {option.label}
                </button>
              ))}
              {access === "ppv" && (
                <input
                  type="number"
                  min={0}
                  max={999999}
                  step="0.01"
                  inputMode="decimal"
                  value={ppvPrice}
                  onChange={(event) => onPpvPriceChange(event.target.value)}
                  placeholder="PPV price"
                  aria-label="PPV price"
                  className={cn(fieldClass, "h-8 w-28")}
                />
              )}
              {onOpenGuidedPost && (
                <button
                  type="button"
                  onClick={() => onOpenGuidedPost(account)}
                  disabled={!guidedAvailable || guidedPostPending}
                  title={
                    guidedAvailable
                      ? "Generate a guided post with AI"
                      : "Passive profiles cannot generate guided posts."
                  }
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--noodle-blue)]/50 px-3 text-xs font-bold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles size={14} />
                  Guided AI
                </button>
              )}
            </div>
            {!guidedAvailable && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Manual posting is available. Guided AI is unavailable because this profile is passive.
              </p>
            )}
          </div>
        )}
        <InlineComposer {...composerProps} personaAccount={account} dataComponent={`${dataComponent}.Composer`} />
      </div>
    </details>
  );
}
