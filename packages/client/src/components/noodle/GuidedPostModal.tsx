// ──────────────────────────────────────────────
// Noodle: guided (AI-assisted) post generation modal
// ──────────────────────────────────────────────
import { Loader2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { NoodleAccount, NoodlePostAccess } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { Modal } from "../ui/Modal";
import { NOODLE_BLUE, NOODLE_ICON_SCOPE_CLASS, fieldClass, labelClass, textareaClass } from "./noodle-shared";

export interface GuidedPostModalProps {
  account: NoodleAccount;
  mode: "noodle" | "noodler";
  access: NoodlePostAccess;
  onAccessChange: (access: NoodlePostAccess) => void;
  ppvPrice: string;
  onPpvPriceChange: (price: string) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  includeText: boolean;
  onIncludeTextChange: (includeText: boolean) => void;
  includeImage: boolean;
  onIncludeImageChange: (includeImage: boolean) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onCancel: () => void;
  onGenerate: (account: NoodleAccount) => void;
  isPending: boolean;
}

export function GuidedPostModal(props: GuidedPostModalProps) {
  const {
    account,
    mode,
    access,
    onAccessChange,
    ppvPrice,
    onPpvPriceChange,
    theme,
    onThemeChange,
    includeText,
    onIncludeTextChange,
    includeImage,
    onIncludeImageChange,
    prompt,
    onPromptChange,
    onCancel,
    onGenerate,
    isPending,
  } = props;

  return (
    <Modal
      open
      onClose={() => {
        if (!isPending) onCancel();
      }}
      title={`Generate post as @${account.handle}`}
      width="max-w-lg"
      panelClassName={NOODLE_ICON_SCOPE_CLASS}
      panelStyle={{ "--noodle-blue": NOODLE_BLUE } as CSSProperties}
    >
      <div className="space-y-4">
        <div className={cn("grid gap-3", mode === "noodler" && "sm:grid-cols-2")}>
          {mode === "noodler" && (
            <label className="block space-y-1.5">
              <span className={labelClass}>Who can view</span>
              <select
                value={access}
                onChange={(event) => onAccessChange(event.target.value as NoodlePostAccess)}
                className={fieldClass}
              >
                <option value="public">Public</option>
                <option value="subscriber">Subscribers only</option>
                <option value="ppv">Pay-per-view</option>
              </select>
            </label>
          )}
          <label className="block space-y-1.5">
            <span className={labelClass}>Post theme</span>
            <input
              value={theme}
              onChange={(event) => onThemeChange(event.target.value)}
              placeholder="Behind the scenes, outfit drop, flirt, teaser"
              className={fieldClass}
            />
          </label>
        </div>
        {mode === "noodler" && access === "ppv" && (
          <label className="block space-y-1.5 sm:max-w-xs">
            <span className={labelClass}>Pay-per-view price</span>
            <input
              type="number"
              min={0}
              max={999999}
              step="0.01"
              inputMode="decimal"
              value={ppvPrice}
              onChange={(event) => onPpvPriceChange(event.target.value)}
              placeholder="9.99"
              className={fieldClass}
            />
          </label>
        )}
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-[var(--foreground)]">
          <label className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--noodle-divider)] px-3">
            <input
              type="checkbox"
              checked={includeText}
              onChange={(event) => onIncludeTextChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--noodle-blue)]"
            />
            Text
          </label>
          <label className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--noodle-divider)] px-3">
            <input
              type="checkbox"
              checked={includeImage}
              onChange={(event) => onIncludeImageChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--noodle-blue)]"
            />
            Image
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className={labelClass}>Direction</span>
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Describe what this post should say, show, or imply."
            className={cn(textareaClass, "min-h-28 resize-none")}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="h-9 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] px-4 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onGenerate(account)}
            disabled={isPending || (!includeText && !includeImage)}
            className="flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {isPending ? "Generating..." : "Generate post"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
