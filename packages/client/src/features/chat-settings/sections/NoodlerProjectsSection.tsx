import { useState } from "react";
import { AtSign, CalendarClock, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { NoodleAccount, NoodlerCreatorProject, NoodlerProjectMilestone } from "@marinara-engine/shared";
import { useCreateNoodlerMilestone, useNoodlerCreatorPages } from "../../../hooks/use-noodler";
import { useUIStore } from "../../../stores/ui.store";
import { ChatSettingsSection } from "../ChatSettingsSection";

export function NoodlerProjectsSection({
  characterIds,
  characterNames,
}: {
  characterIds: string[];
  characterNames: ReadonlyMap<string, string>;
}) {
  const pages = useNoodlerCreatorPages(characterIds);
  const openNoodle = useUIStore((state) => state.openNoodle);

  return (
    <ChatSettingsSection
      label="NoodleR Posting"
      icon={<AtSign size="0.875rem" />}
      help="Review each character's creator page, automatic-post status, active project, and next planned beat. Posting schedules remain separate from Conversation presence schedules."
    >
      <div className="space-y-2">
        {pages.isLoading && <Loader2 size={14} className="animate-spin text-[var(--primary)]" />}
        {characterIds.map((characterId) => {
          const page = pages.data?.find((item) => item.account.entityId === characterId);
          return (
            <CreatorPageRow
              key={characterId}
              characterName={characterNames.get(characterId) ?? "Character"}
              page={page}
              onOpenNoodle={openNoodle}
            />
          );
        })}
      </div>
    </ChatSettingsSection>
  );
}

function CreatorPageRow({
  characterName,
  page,
  onOpenNoodle,
}: {
  characterName: string;
  page:
    | {
        account: NoodleAccount;
        activeProject: NoodlerCreatorProject | null;
        nextMilestone: NoodlerProjectMilestone | null;
      }
    | undefined;
  onOpenNoodle: () => void;
}) {
  const accountId = page?.account.id;
  const addMilestone = useCreateNoodlerMilestone(accountId);
  const [idea, setIdea] = useState("");
  const account = page?.account;
  const stageProfile = account?.settings.stageProfile as Record<string, unknown> | undefined;
  const autoPost = account?.settings.autoPost as Record<string, unknown> | undefined;

  return (
    <div className="rounded-lg bg-[var(--secondary)] px-3 py-2.5 ring-1 ring-[var(--border)]/70">
      <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{characterName}</p>
                  <p className="mt-0.5 text-[0.625rem] leading-4 text-[var(--muted-foreground)]">
                    {!account
                      ? "No NoodleR creator page yet."
                      : `${stageProfile?.postingMode === "passive" ? "Passive" : "Active"} page · automatic posting ${autoPost?.enabled === true ? "on" : "off"}`}
                  </p>
                  {page?.activeProject && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                      <CalendarClock size={11} /> {page.activeProject.title}
                      {page.nextMilestone ? ` · Next: ${page.nextMilestone.title}` : " · No remaining beats"}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onOpenNoodle}
                  className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-[0.625rem] font-semibold hover:bg-[var(--accent)]"
                >
                  Open NoodleR
                </button>
      </div>
      {page?.activeProject && (
        <div className="mt-2 flex gap-1.5">
          <input
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            placeholder="Add a posting idea from this conversation"
            maxLength={240}
            className="h-8 min-w-0 flex-1 rounded-md bg-[var(--background)] px-2.5 text-[0.625rem] ring-1 ring-[var(--border)]"
          />
          <button
            type="button"
            disabled={!idea.trim() || addMilestone.isPending}
            onClick={() =>
              addMilestone.mutate(
                {
                  projectId: page.activeProject!.id,
                  input: {
                    title: idea.trim(),
                    notes: "Added deliberately from Conversation Chat Settings.",
                    status: "planned",
                    notBefore: null,
                    dueAt: null,
                    access: "subscriber",
                    ppvPrice: null,
                    mediaPreference: "model_choice",
                  },
                },
                {
                  onSuccess: () => {
                    setIdea("");
                    toast.success("Posting idea added to the creator project.");
                  },
                },
              )
            }
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[0.625rem] font-semibold disabled:opacity-45"
          >
            <Plus size={11} /> Add idea
          </button>
        </div>
      )}
    </div>
  );
}
