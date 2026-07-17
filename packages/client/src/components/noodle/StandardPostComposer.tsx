import { useEffect, useState } from "react";
import type { NoodleAccount, NoodlePostAccess } from "@marinara-engine/shared";
import { InlineComposer, type InlineComposerProps, readPrivatePostingMode } from "./noodle-shared";

export type StandardPostComposerProps = Omit<
  InlineComposerProps,
  | "postAccess"
  | "onPostAccessChange"
  | "ppvPrice"
  | "onPpvPriceChange"
  | "onOpenGuidedPost"
  | "guidedPostDisabled"
  | "guidedPostPending"
  | "onClose"
> & {
  account: NoodleAccount;
  mode: "noodle" | "noodler";
  defaultExpanded: boolean;
  access: NoodlePostAccess;
  onAccessChange: (access: NoodlePostAccess) => void;
  ppvPrice: string;
  onPpvPriceChange: (value: string) => void;
  onOpenGuidedPost?: (account: NoodleAccount) => void;
  guidedPostPending?: boolean;
};

export function StandardPostComposer({
  account,
  mode,
  defaultExpanded,
  access,
  onAccessChange,
  ppvPrice,
  onPpvPriceChange,
  onOpenGuidedPost,
  guidedPostPending = false,
  dataComponent = "InlineComposer",
  ...composerProps
}: StandardPostComposerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isNoodler = mode === "noodler";
  const guidedDisabled = isNoodler && readPrivatePostingMode(account) === "passive";

  useEffect(() => setExpanded(defaultExpanded), [account.id, defaultExpanded]);

  if (!expanded) {
    return (
      <div className="border-b border-[var(--noodle-divider)] px-4 py-2.5" data-component={`${dataComponent}.Prompt`}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={`Open the composer and roleplay as @${account.handle}`}
          className="h-8 rounded-full border border-[var(--noodle-divider)] px-3 text-xs font-semibold text-[var(--muted-foreground)] transition-colors hover:border-[var(--noodle-blue)]/50 hover:bg-[var(--noodle-blue)]/5 hover:text-[var(--foreground)]"
        >
          Post as @{account.handle}
        </button>
      </div>
    );
  }

  return (
    <InlineComposer
      {...composerProps}
      personaAccount={account}
      dataComponent={dataComponent}
      postAccess={isNoodler ? access : undefined}
      onPostAccessChange={isNoodler ? onAccessChange : undefined}
      ppvPrice={ppvPrice}
      onPpvPriceChange={isNoodler ? onPpvPriceChange : undefined}
      onOpenGuidedPost={onOpenGuidedPost ? () => onOpenGuidedPost(account) : undefined}
      guidedPostDisabled={guidedDisabled}
      guidedPostPending={guidedPostPending}
      onClose={defaultExpanded ? undefined : () => setExpanded(false)}
    />
  );
}
