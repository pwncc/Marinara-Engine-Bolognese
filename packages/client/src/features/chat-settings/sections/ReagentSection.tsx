import { useEffect, useState } from "react";
import { Bot, FolderOpen, NotebookPen } from "lucide-react";
import { useTranslation as useUiTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  REAGENT_MEMORY_FILE,
  supportsNativeToolCalls,
  type ReagentSettings,
  type ReagentShellPolicy,
  type ReagentToolFamily,
} from "@marinara-engine/shared";
import { SettingsSwitch } from "../../../components/panels/settings/SettingControls";
import { Modal } from "../../../components/ui/Modal";
import { useReagentWorkspace, useUpdateReagentMemory } from "../../../hooks/use-reagent";
import { ChatSettingsSection } from "../ChatSettingsSection";

const FAMILIES: Array<{ id: ReagentToolFamily; labelKey: string; descriptionKey: string }> = [
  { id: "files", labelKey: "ui.chat.reagent.family.files", descriptionKey: "ui.chat.reagent.family.filesDescription" },
  {
    id: "memory",
    labelKey: "ui.chat.reagent.family.memory",
    descriptionKey: "ui.chat.reagent.family.memoryDescription",
  },
  {
    id: "recall",
    labelKey: "ui.chat.reagent.family.recall",
    descriptionKey: "ui.chat.reagent.family.recallDescription",
  },
  {
    id: "status",
    labelKey: "ui.chat.reagent.family.status",
    descriptionKey: "ui.chat.reagent.family.statusDescription",
  },
  {
    id: "lorebook",
    labelKey: "ui.chat.reagent.family.lorebook",
    descriptionKey: "ui.chat.reagent.family.lorebookDescription",
  },
  { id: "web", labelKey: "ui.chat.reagent.family.web", descriptionKey: "ui.chat.reagent.family.webDescription" },
  { id: "shell", labelKey: "ui.chat.reagent.family.shell", descriptionKey: "ui.chat.reagent.family.shellDescription" },
];

const SHELL_POLICIES: ReagentShellPolicy[] = ["allowlist", "ask", "bypass"];

const INPUT_CLASS =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50";
const TEXTAREA_CLASS =
  "min-h-[4rem] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2.5 font-mono text-[0.6875rem] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 placeholder:text-[var(--muted-foreground)]/40";
const BUTTON_CLASS =
  "mari-chrome-control mari-chrome-control--small inline-flex items-center gap-1.5 px-3 text-[0.6875rem]";

interface ReagentSectionProps {
  chatId: string;
  settings: ReagentSettings;
  provider?: string;
  style?: React.CSSProperties;
  onChange: (next: ReagentSettings) => void;
}

function linesToList(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function ReagentSection({ chatId, settings, provider, style, onChange }: ReagentSectionProps) {
  const { t: localizeUi } = useUiTranslation();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [allowDraft, setAllowDraft] = useState(settings.shellAllow.join("\n"));
  const [denyDraft, setDenyDraft] = useState(settings.shellDeny.join("\n"));
  const [rootsDraft, setRootsDraft] = useState(settings.writableRoots.join("\n"));
  const workspace = useReagentWorkspace(chatId, settings.enabled);
  const nativeTools = provider ? supportsNativeToolCalls(provider) : true;

  useEffect(() => setAllowDraft(settings.shellAllow.join("\n")), [settings.shellAllow]);
  useEffect(() => setDenyDraft(settings.shellDeny.join("\n")), [settings.shellDeny]);
  useEffect(() => setRootsDraft(settings.writableRoots.join("\n")), [settings.writableRoots]);

  const patch = (next: Partial<ReagentSettings>) => onChange({ ...settings, ...next });
  const setFamily = (family: ReagentToolFamily, enabled: boolean) =>
    patch({ tools: { ...settings.tools, [family]: enabled } });

  return (
    <ChatSettingsSection
      id="reagent"
      label={localizeUi("ui.chat.reagent.title")}
      icon={<Bot size="0.875rem" />}
      help={localizeUi("ui.chat.reagent.help")}
      style={style}
    >
      <div className="space-y-3">
        <SettingsSwitch
          label={localizeUi("ui.chat.reagent.enable")}
          description={localizeUi("ui.chat.reagent.enableDescription")}
          checked={settings.enabled}
          onChange={(enabled) => patch({ enabled })}
        />
        {settings.enabled && !nativeTools && (
          <p className="text-[0.6875rem] text-[var(--destructive)]">{localizeUi("ui.chat.reagent.noNativeTools")}</p>
        )}
        {settings.enabled && (
          <>
            <div className="space-y-2 rounded-lg bg-[var(--background)]/45 p-2 ring-1 ring-[var(--border)]">
              {FAMILIES.map((family) => (
                <SettingsSwitch
                  key={family.id}
                  label={localizeUi(family.labelKey)}
                  description={localizeUi(family.descriptionKey)}
                  checked={settings.tools[family.id]}
                  onChange={(enabled) => setFamily(family.id, enabled)}
                />
              ))}
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={BUTTON_CLASS} onClick={() => setMemoryOpen(true)}>
                  <NotebookPen size="0.75rem" />
                  {localizeUi("ui.chat.reagent.editMemory")}
                </button>
                {workspace.data?.workspaceDir && (
                  <span
                    className="inline-flex min-w-0 items-center gap-1 truncate text-[0.625rem] text-[var(--muted-foreground)]"
                    title={workspace.data.workspaceDir}
                  >
                    <FolderOpen size="0.7rem" className="shrink-0" />
                    <span className="truncate">{workspace.data.workspaceDir}</span>
                  </span>
                )}
              </div>
              <SettingsSwitch
                label={localizeUi("ui.chat.reagent.restrictReads")}
                description={localizeUi("ui.chat.reagent.restrictReadsDescription")}
                checked={settings.restrictReadsToWorkspace}
                onChange={(restrictReadsToWorkspace) => patch({ restrictReadsToWorkspace })}
              />
              <label className="block space-y-1">
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                  {localizeUi("ui.chat.reagent.writableRoots")}
                </span>
                <textarea
                  value={rootsDraft}
                  onChange={(event) => setRootsDraft(event.target.value)}
                  onBlur={() => patch({ writableRoots: linesToList(rootsDraft) })}
                  placeholder={localizeUi("ui.chat.reagent.writableRootsPlaceholder")}
                  className={TEXTAREA_CLASS}
                />
              </label>
            </div>

            {settings.tools.shell && (
              <div className="space-y-1.5 rounded-lg bg-[var(--background)]/45 p-2 ring-1 ring-[var(--border)]">
                <label className="block space-y-1">
                  <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                    {localizeUi("ui.chat.reagent.shellPolicy")}
                  </span>
                  <select
                    value={settings.shellPolicy}
                    onChange={(event) => patch({ shellPolicy: event.target.value as ReagentShellPolicy })}
                    className={INPUT_CLASS}
                  >
                    {SHELL_POLICIES.map((policy) => (
                      <option key={policy} value={policy}>
                        {localizeUi(`ui.chat.reagent.shellPolicy.${policy}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                  {localizeUi("ui.chat.reagent.shellPolicyDescription")}
                </p>
                <label className="block space-y-1">
                  <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                    {localizeUi("ui.chat.reagent.shellAllow")}
                  </span>
                  <textarea
                    value={allowDraft}
                    onChange={(event) => setAllowDraft(event.target.value)}
                    onBlur={() => patch({ shellAllow: linesToList(allowDraft) })}
                    placeholder={localizeUi("ui.chatSettings.reagentsection.gitStatusBLsB")}
                    className={TEXTAREA_CLASS}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                    {localizeUi("ui.chat.reagent.shellDeny")}
                  </span>
                  <textarea
                    value={denyDraft}
                    onChange={(event) => setDenyDraft(event.target.value)}
                    onBlur={() => patch({ shellDeny: linesToList(denyDraft) })}
                    placeholder={localizeUi("ui.chatSettings.reagentsection.brmSRfBFormatS")}
                    className={TEXTAREA_CLASS}
                  />
                </label>
              </div>
            )}
          </>
        )}
      </div>
      {memoryOpen && (
        <ReagentMemoryModal
          chatId={chatId}
          initial={workspace.data?.memory ?? ""}
          onClose={() => setMemoryOpen(false)}
        />
      )}
    </ChatSettingsSection>
  );
}

function ReagentMemoryModal({ chatId, initial, onClose }: { chatId: string; initial: string; onClose: () => void }) {
  const { t: localizeUi } = useUiTranslation();
  const [draft, setDraft] = useState(initial);
  const update = useUpdateReagentMemory(chatId);
  useEffect(() => setDraft(initial), [initial]);

  return (
    <Modal open onClose={onClose} title={REAGENT_MEMORY_FILE} width="max-w-2xl" chatFloatingPanel>
      <div className="space-y-2">
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">{localizeUi("ui.chat.reagent.memoryHint")}</p>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={`${TEXTAREA_CLASS} min-h-[16rem]`}
          spellCheck={false}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON_CLASS} onClick={onClose}>
            {localizeUi("ui.chat.reagent.cancel")}
          </button>
          <button
            type="button"
            className={BUTTON_CLASS}
            disabled={update.isPending || draft === initial}
            onClick={() =>
              update.mutate(draft, {
                onSuccess: () => {
                  toast.success(localizeUi("ui.chat.reagent.memorySaved"));
                  onClose();
                },
                onError: (error) =>
                  toast.error(error instanceof Error ? error.message : localizeUi("ui.chat.reagent.memorySaveFailed")),
              })
            }
          >
            {update.isPending ? localizeUi("ui.chat.reagent.saving") : localizeUi("ui.chat.reagent.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
