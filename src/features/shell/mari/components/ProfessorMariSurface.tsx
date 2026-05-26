import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronUp,
  CircleUser,
  FileText,
  Link,
  Paperclip,
  Send,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import {
  isMariStagedAction,
  runProfessorMariEntry,
  type MariEntryAction,
  type MariMessage,
  type MariStorageAction,
  type MariTraceEvent,
} from "../../../../engine/mari/mari-entry";
import { mariApi } from "../../../../shared/api/mari-api";
import { useConnections } from "../../../catalog/connections/index";
import { usePersonas } from "../../../catalog/characters/index";
import { filterLanguageGenerationConnections } from "../../../../shared/lib/connection-filters";
import { cn, getAvatarCropStyle, parseAvatarCropJson } from "../../../../shared/lib/utils";
import { useUIStore } from "../../../../shared/stores/ui.store";

const MARI_AVATAR_URL = "/sprites/mari/Mari_profile.png";
const MARI_THINKING_URL = "/sprites/mari/Mari_thinking.png";
const MARI_WAVE_URL = "/sprites/mari/Mari_wave.png";
const MARI_WORKING_URL = "/sprites/mari/Mari_point_down_left.png";

type MariAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string;
};

type MariConnection = {
  id: string;
  name?: string;
  provider?: string;
};

type MariPersona = {
  id: string;
  name: string;
  avatarPath?: string | null;
  avatarCrop?: string;
  comment?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
};

type MariOptionPanel = "connections" | "personas";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDaySeparator(value: string) {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - messageDay.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function getDayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const details = "details" in record ? record.details : record;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

export function ProfessorMariSurface() {
  const queryClient = useQueryClient();
  const { data: rawConnections } = useConnections();
  const { data: rawPersonas } = usePersonas();
  const convoGradient = useUIStore((s) => s.convoGradient);
  const theme = useUIStore((s) => s.theme);
  const [messages, setMessages] = useState<MariMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MariAttachment[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [optionPanel, setOptionPanel] = useState<MariOptionPanel | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendErrorDetails, setSendErrorDetails] = useState<string | null>(null);
  const [liveTrace, setLiveTrace] = useState<MariTraceEvent[]>([]);
  const [pendingAction, setPendingAction] = useState<MariEntryAction | null>(null);
  const [applyingAction, setApplyingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const spriteMeasureRef = useRef<HTMLDivElement>(null);
  const [spriteSafeInset, setSpriteSafeInset] = useState(0);
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !sending && !applyingAction;
  const connections = useMemo(
    () =>
      filterLanguageGenerationConnections((rawConnections ?? []) as MariConnection[]).sort((a, b) =>
        (a.name || a.id).localeCompare(b.name || b.id),
      ),
    [rawConnections],
  );
  const personas = useMemo(
    () => ((rawPersonas ?? []) as MariPersona[]).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [rawPersonas],
  );
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const selectedPersona = personas.find((persona) => persona.id === selectedPersonaId) ?? null;
  const hasToolActivity = liveTrace.some((event) => event.type === "tool_result" || !!event.tool || (Array.isArray(event.toolCalls) && event.toolCalls.length > 0));
  const mariStage = sendError
    ? { src: MARI_THINKING_URL, mood: "thinking" as const }
    : sending
      ? hasToolActivity
        ? { src: MARI_WORKING_URL, mood: "working" as const }
        : { src: MARI_THINKING_URL, mood: "thinking" as const }
      : { src: MARI_WAVE_URL, mood: "idle" as const };
  const gradientStyle = useMemo(() => {
    const gradient = convoGradient[theme];
    const isDefaultDark = convoGradient.dark.from === "#0a0a0e" && convoGradient.dark.to === "#1c2133";
    const isDefaultLight = convoGradient.light.from === "#f2eff7" && convoGradient.light.to === "#eae6f0";
    if ((theme === "dark" && isDefaultDark) || (theme === "light" && isDefaultLight)) {
      return {
        background:
          "radial-gradient(circle at 20% 0%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 22rem), var(--secondary)",
      };
    }
    return {
      background: `radial-gradient(circle at 20% 0%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 22rem), linear-gradient(135deg, ${gradient.from}, ${gradient.to})`,
    };
  }, [convoGradient, theme]);
  const surfaceStyle = useMemo(() => {
    const bubbleOverlap = Math.min(spriteSafeInset * 0.28, 48);
    return {
      ...gradientStyle,
      "--mari-sprite-safe": `${spriteSafeInset}px`,
      "--mari-chat-gutter": `${Math.max(0, spriteSafeInset - bubbleOverlap)}px`,
      "--mari-bubble-overlap": `${bubbleOverlap}px`,
    } as CSSProperties;
  }, [gradientStyle, spriteSafeInset]);

  useEffect(() => {
    const updateSpriteSafeInset = () => {
      const surfaceWidth = surfaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const spriteWidth = spriteMeasureRef.current?.getBoundingClientRect().width ?? 0;
      const roomFactor = Math.max(0, Math.min(1, (surfaceWidth - 520) / 320));
      const visualOverlap = Math.min(spriteWidth * 0.22, 56);
      const nextInset = Math.max(0, Math.round((spriteWidth - visualOverlap) * roomFactor));
      setSpriteSafeInset((current) => (Math.abs(current - nextInset) > 1 ? nextInset : current));
    };

    updateSpriteSafeInset();
    window.addEventListener("resize", updateSpriteSafeInset);
    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSpriteSafeInset);
      if (surfaceRef.current) observer.observe(surfaceRef.current);
      if (spriteMeasureRef.current) observer.observe(spriteMeasureRef.current);
      observers.push(observer);
    }
    return () => {
      window.removeEventListener("resize", updateSpriteSafeInset);
      observers.forEach((observer) => observer.disconnect());
    };
  }, [mariStage.src]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, liveTrace.length]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 148)}px`;
  }, [draft]);

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const nextAttachments = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<MariAttachment>((resolve, reject) => {
            const finish = (content: string) =>
              resolve({
                id: newId("mari-file"),
                name: file.name,
                type: file.type || "application/octet-stream",
                size: file.size,
                content,
              });
            if (file.type.startsWith("image/")) {
              const reader = new FileReader();
              reader.onload = () => finish(String(reader.result ?? ""));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
              return;
            }
            file.text().then(finish).catch(reject);
          }),
      ),
    );
    setAttachments((current) => [...current, ...nextAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const send = async () => {
    const userMessage = draft.trim() || (attachments.length > 0 ? "[attachments]" : "");
    if (!userMessage || sending) return;
    const createdAt = new Date().toISOString();
    const user: MariMessage = {
      id: newId("mari-user"),
      role: "user",
      content: userMessage,
      createdAt,
    };
    const currentMessages = messages;
    const currentAttachments = attachments;
    setMessages((current) => [...current, user]);
    setDraft("");
    setAttachments([]);
    setSendError(null);
    setSendErrorDetails(null);
    setActionError(null);
    setPendingAction(null);
    setLiveTrace([]);
    setSending(true);
    setOptionPanel(null);
    requestAnimationFrame(() => inputRef.current?.focus());
    let response;
    try {
      response = await runProfessorMariEntry(
        {
          userMessage,
          messages: currentMessages,
          connectionId: selectedConnection?.id ?? null,
          persona: selectedPersona
            ? {
                id: selectedPersona.id,
                name: selectedPersona.name,
                comment: selectedPersona.comment ?? null,
                description: selectedPersona.description ?? null,
                personality: selectedPersona.personality ?? null,
                scenario: selectedPersona.scenario ?? null,
                backstory: selectedPersona.backstory ?? null,
                appearance: selectedPersona.appearance ?? null,
              }
            : null,
          attachments: currentAttachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
            content: attachment.content,
          })),
        },
        {
          prompt: (request) =>
            mariApi.prompt(request, (event) => {
              if (event.type === "trace") {
                setLiveTrace((current) => [...current, event.event]);
              }
            }),
        },
      );
    } catch (error) {
      console.error("Professor Mari failed to respond", error);
      setSendError(error instanceof Error ? error.message : "Professor Mari failed to respond.");
      setSendErrorDetails(formatErrorDetails(error));
      setSending(false);
      return;
    }
    const assistant: MariMessage = {
      id: newId("mari-assistant"),
      role: "assistant",
      content: response.content,
      createdAt: response.createdAt,
      trace: response.trace,
    };
    setMessages((current) => [...current, assistant]);
    setPendingAction(isMariStagedAction(response.action) && response.action.changes.length > 0 ? response.action : null);
    setLiveTrace([]);
    setSending(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const approvePendingChanges = async () => {
    if (!isMariStagedAction(pendingAction) || pendingAction.storageActions.length === 0 || applyingAction) return;
    setApplyingAction(true);
    setActionError(null);
    try {
      const result = await mariApi.applyStagedChanges(pendingAction);
      setPendingAction(null);
      await queryClient.invalidateQueries();
      setMessages((current) => [
        ...current,
        {
          id: newId("mari-assistant"),
          role: "assistant",
          content: `Saved ${result.applied} staged change${result.applied === 1 ? "" : "s"} to your library.`,
          createdAt: result.appliedAt ?? new Date().toISOString(),
        },
      ]);
    } catch (error) {
      console.error("Professor Mari failed to apply staged changes", error);
      setActionError(error instanceof Error ? error.message : "Professor Mari failed to apply staged changes.");
    } finally {
      setApplyingAction(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const rejectPendingChanges = () => {
    if (applyingAction) return;
    setPendingAction(null);
    setActionError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <section ref={surfaceRef} className="mari-chat-area relative flex h-full flex-col overflow-hidden text-[var(--foreground)]" style={surfaceStyle}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:linear-gradient(var(--foreground)_1px,transparent_1px),linear-gradient(90deg,var(--foreground)_1px,transparent_1px)] [background-size:26px_26px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-[var(--primary)]/10 to-transparent" />
      <MariStageSprite src={mariStage.src} mood={mariStage.mood} measureRef={spriteMeasureRef} />

      <div className="mari-messages-scroll relative z-10 flex-1 overflow-y-auto overflow-x-hidden">
        <main className="relative flex min-h-full w-full flex-col px-4 pb-4 pt-4 sm:px-6 sm:pt-5 lg:px-8">
          <div className="flex-1 space-y-3 pb-32 sm:pb-40" style={{ width: "calc(100% - var(--mari-chat-gutter))", maxWidth: "100%" }}>
            <MariConversation messages={messages} persona={selectedPersona} />
            {sending && <MariLiveMessage events={liveTrace} />}
            {pendingAction && (
              <MariStagedChangesPanel
                action={pendingAction}
                applying={applyingAction}
                error={actionError}
                onApprove={() => void approvePendingChanges()}
                onReject={rejectPendingChanges}
              />
            )}
            {sendError && <MariErrorMessage message={sendError} details={sendErrorDetails} />}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        </main>
      </div>

      <footer className="relative z-30 px-4 pb-4 sm:px-6 lg:px-8">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.txt,.md,.markdown,.json,.jsonl,.csv,.log,.xml,.yaml,.yml"
          multiple
          className="hidden"
          onChange={(event) => void readFiles(event.target.files)}
        />

        {optionPanel && (
          <MariOptionPanel
            mode={optionPanel}
            connections={connections}
            personas={personas}
            selectedConnectionId={selectedConnectionId}
            selectedPersonaId={selectedPersonaId}
            onModeChange={setOptionPanel}
            onSelectConnection={(id) => {
              setSelectedConnectionId(id);
              setOptionPanel(null);
            }}
            onSelectPersona={(id) => {
              setSelectedPersonaId(id);
              setOptionPanel(null);
            }}
          />
        )}

        <MariAttachmentTray attachments={attachments} onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))} />

        <div className="relative flex flex-wrap items-center gap-1.5 gap-y-2 rounded-2xl border-2 border-[var(--border)] bg-[var(--card)] px-2.5 py-2.5 transition-all duration-200 dark:bg-black/40 sm:flex-nowrap sm:gap-2 sm:px-4">
          <div className="hidden items-center gap-1.5 sm:flex">
            <MariAttachButton count={attachments.length} onClick={() => fileInputRef.current?.click()} />
            <MariConnectionSwitcherButton
              selectedConnection={selectedConnection}
              open={optionPanel === "connections"}
              onClick={() => setOptionPanel((current) => (current === "connections" ? null : "connections"))}
            />
            <MariPersonaSwitcherButton
              selectedPersona={selectedPersona}
              open={optionPanel === "personas"}
              onClick={() => setOptionPanel((current) => (current === "personas" ? null : "personas"))}
            />
          </div>

          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            spellCheck
            autoCorrect="on"
            placeholder="Ask Mari to edit, compare, rewrite, or organize"
            className="max-h-[12.5rem] min-w-0 basis-full resize-none bg-transparent py-0 text-[1rem] leading-normal text-[var(--foreground)] outline-none placeholder:text-foreground/30 sm:flex-1 sm:basis-auto"
          />

          <div className="flex items-center gap-1.5 sm:hidden">
            <MariAttachButton count={attachments.length} onClick={() => fileInputRef.current?.click()} />
            <MariMobileSwitcherButton
              open={!!optionPanel}
              active={!!selectedConnection || !!selectedPersona}
              onClick={() => setOptionPanel((current) => (current ? null : "connections"))}
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0">
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
                canSend ? "text-foreground hover:text-foreground/80 active:scale-90" : "text-foreground/20",
              )}
              title="Send message"
              aria-label="Send message"
            >
              <Send size="0.9375rem" className="translate-x-px" />
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}

function MariStageSprite({ src, mood, measureRef }: { src: string; mood: "idle" | "thinking" | "working"; measureRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div
        ref={measureRef}
        className={cn(
          "absolute bottom-0 right-3 w-[clamp(9rem,26vw,24rem)] origin-bottom-right opacity-70 drop-shadow-2xl transition-all duration-300 sm:right-5 sm:opacity-95",
          mood === "thinking" && "translate-y-2 opacity-90",
          mood === "working" && "sm:translate-x-2",
        )}
      >
        <img
          key={src}
          src={src}
          alt=""
          className={cn("h-auto w-full origin-center object-contain object-bottom", mood === "idle" && "scale-x-[-1]")}
          draggable={false}
        />
      </div>
    </div>
  );
}

function MariWelcomeMessage() {
  return (
    <div className="w-full">
      <div className="flex items-start gap-2.5 sm:gap-3">
        <MariAvatar large />
        <div className="min-w-0 flex-1">
          <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--card)]/88 py-3 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] text-sm leading-6 shadow-sm ring-1 ring-[var(--border)] sm:pl-4 sm:pr-[calc(1rem+var(--mari-bubble-overlap))]">
            <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)] bg-[var(--card)]/88" />
            <p className="font-semibold text-[var(--foreground)]">Welcome to my domain &gt;:D</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Hi! I'm Professor Mari! I can view, edit, and create characters, lorebooks, prompts, and much more! Just ask me anything and I'll do my best to help!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MariConversation({ messages, persona }: { messages: MariMessage[]; persona: MariPersona | null }) {
  return (
    <div className="w-full space-y-3">
      <MariWelcomeMessage />
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const showSeparator = !!previous && getDayKey(previous.createdAt) !== getDayKey(message.createdAt);
        return (
          <div key={message.id}>
            {showSeparator && (
              <div className="my-3 flex items-center justify-center">
                <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
                  {formatDaySeparator(message.createdAt)}
                </span>
              </div>
            )}
            <MariChatMessage message={message} persona={persona} />
          </div>
        );
      })}
    </div>
  );
}

function MariChatMessage({ message, persona }: { message: MariMessage; persona: MariPersona | null }) {
  const isAssistant = message.role === "assistant";
  if (!isAssistant) {
    return (
      <div className="flex w-full items-start gap-2.5 py-1 sm:gap-3">
        <PersonaAvatar persona={persona} />
        <div className="min-w-0 flex-1">
          <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--background)]/62 py-2.5 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] text-sm leading-6 shadow-sm ring-1 ring-[var(--border)]/70">
            <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)]/70 bg-[var(--background)]/62" />
            <div className="whitespace-pre-wrap text-[var(--foreground)]/86">{message.content}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex w-full items-start gap-2.5 sm:gap-3">
      <MariAvatar />
      <div className="min-w-0 flex-1">
        <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--card)]/88 py-3 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] text-sm leading-6 shadow-sm ring-1 ring-[var(--border)] sm:pl-4 sm:pr-[calc(1rem+var(--mari-bubble-overlap))]">
          <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)] bg-[var(--card)]/88" />
          <div className="whitespace-pre-wrap text-[var(--foreground)]">{message.content}</div>
          <time className="mt-2 block text-[0.625rem] text-[var(--muted-foreground)]">{formatTime(message.createdAt)}</time>
        </div>
        {message.trace?.length ? <MariToolDetails events={message.trace} /> : null}
      </div>
    </div>
  );
}

function MariStagedChangesPanel({
  action,
  applying,
  error,
  onApprove,
  onReject,
}: {
  action: MariEntryAction;
  applying: boolean;
  error: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (!isMariStagedAction(action)) return null;
  const storageActions = action.storageActions;
  const visibleActions = storageActions.slice(0, 4);
  const hiddenActionCount = Math.max(0, storageActions.length - visibleActions.length);
  const canApprove = storageActions.length > 0 && !applying;
  return (
    <div className="flex w-full items-start gap-2.5 sm:gap-3">
      <MariAvatar />
      <div className="min-w-0 flex-1">
        <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--card)]/92 py-3 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] text-sm leading-6 shadow-sm ring-1 ring-[var(--primary)]/35 sm:pl-4 sm:pr-[calc(1rem+var(--mari-bubble-overlap))]">
          <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--primary)]/35 bg-[var(--card)]/92" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--primary)]/12 text-[var(--primary)]">
              <FileText size="0.9rem" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[var(--foreground)]">Review Mari's staged changes</div>
              <div className="text-xs text-[var(--muted-foreground)]">
                {storageActions.length} storage action{storageActions.length === 1 ? "" : "s"} from {action.changes.length} file change
                {action.changes.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            {visibleActions.map((item, index) => (
              <div key={`${item.type}-${item.entity}-${index}`} className="rounded-xl bg-[var(--secondary)]/45 px-2.5 py-2">
                <div className="font-semibold text-[var(--foreground)]/90">{describeStorageAction(item)}</div>
                {item.paths?.length ? <div className="mt-0.5 truncate text-[0.6875rem] text-[var(--muted-foreground)]">{item.paths[0]}</div> : null}
              </div>
            ))}
            {hiddenActionCount > 0 && (
              <div className="px-2.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)]">+{hiddenActionCount} more</div>
            )}
            {action.unmappedChanges.length > 0 && (
              <details className="rounded-xl bg-amber-500/10 px-2.5 py-2 text-[0.6875rem] text-amber-600 dark:text-amber-300">
                <summary className="cursor-pointer font-semibold">
                  {action.unmappedChanges.length} file change{action.unmappedChanges.length === 1 ? "" : "s"} cannot be applied automatically
                </summary>
                <div className="mt-2 space-y-1">
                  {action.unmappedChanges.slice(0, 4).map((change) => (
                    <div key={change.path} className="break-words">
                      <span className="font-semibold">{change.path}</span>
                      {change.reason ? <span>: {change.reason}</span> : null}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {error && <div className="mt-3 rounded-xl bg-red-500/10 px-2.5 py-2 text-[0.75rem] text-red-400">{error}</div>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={!canApprove}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold transition",
                canApprove
                  ? "bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 active:scale-95"
                  : "cursor-not-allowed bg-[var(--secondary)] text-[var(--muted-foreground)] opacity-60",
              )}
            >
              <Check size="0.8rem" />
              {applying ? "Saving" : "Approve"}
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={applying}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] transition hover:text-[var(--foreground)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size="0.8rem" />
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function describeStorageAction(action: MariStorageAction) {
  if (action.label) return action.label;
  const entity = action.entity.replace(/-/g, " ");
  if (action.type === "create_record") return `Create ${entity}`;
  return `Edit ${entity}`;
}

function PersonaAvatar({ persona }: { persona: MariPersona | null }) {
  if (persona?.avatarPath) {
    return (
      <span className="mt-1 block h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--secondary)] shadow-sm sm:h-9 sm:w-9">
        <img
          src={persona.avatarPath}
          alt={persona.name}
          className="h-full w-full object-cover"
          style={getAvatarCropStyle(parseAvatarCropJson(persona.avatarCrop))}
          draggable={false}
        />
      </span>
    );
  }
  return (
    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)] shadow-sm sm:h-9 sm:w-9">
      {persona ? <span className="text-xs font-semibold">{(persona.name || "?")[0].toUpperCase()}</span> : <CircleUser size="1rem" />}
    </span>
  );
}

function MariAvatar({ large }: { large?: boolean }) {
  return (
    <span
      className={cn(
        "block shrink-0 overflow-hidden border border-[var(--border)] bg-[var(--secondary)] shadow-sm",
        large ? "h-10 w-10 rounded-2xl sm:h-11 sm:w-11" : "mt-1 h-8 w-8 rounded-full sm:h-9 sm:w-9",
      )}
    >
      <img src={MARI_AVATAR_URL} alt="Professor Mari" className="h-full w-full object-cover" draggable={false} />
    </span>
  );
}

function MariAttachButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <ComposerIconButton onClick={onClick} label="Attach files" active={count > 0}>
      <Paperclip size="1rem" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[0.5625rem] font-semibold text-[var(--primary-foreground)]">
          {count}
        </span>
      )}
    </ComposerIconButton>
  );
}

function MariConnectionSwitcherButton({
  selectedConnection,
  open,
  onClick,
}: {
  selectedConnection: MariConnection | null;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={selectedConnection ? selectedConnection.name || selectedConnection.id : "Quick Connection Switcher"}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
        open ? "bg-foreground/10 text-foreground" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <Link size="1rem" />
    </button>
  );
}

function MariPersonaSwitcherButton({
  selectedPersona,
  open,
  onClick,
}: {
  selectedPersona: MariPersona | null;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={selectedPersona ? selectedPersona.name : "Quick Persona Switcher"}
      className={cn(
        "relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 transition-all",
        open ? "border-foreground/40" : "border-transparent hover:border-foreground/30 hover:opacity-90",
      )}
    >
      {selectedPersona?.avatarPath ? (
        <img
          src={selectedPersona.avatarPath}
          alt=""
          className="h-full w-full rounded-full object-cover"
          style={getAvatarCropStyle(parseAvatarCropJson(selectedPersona.avatarCrop))}
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--secondary)] text-[0.75rem] font-semibold text-[var(--muted-foreground)]">
          {selectedPersona ? (selectedPersona.name || "?")[0].toUpperCase() : "?"}
        </div>
      )}
    </button>
  );
}

function MariMobileSwitcherButton({ open, active, onClick }: { open: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Quick Switcher"
      aria-label="Quick Switcher"
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
        open || active ? "bg-foreground/10 text-foreground" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      <ChevronUp size="1rem" className={cn("transition-transform", open && "rotate-180")} />
    </button>
  );
}

function ComposerIconButton({ children, label, active, onClick }: { children: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all active:scale-90",
        active ? "bg-foreground/10 text-foreground" : "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70",
      )}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function MariAttachmentTray({ attachments, onRemove }: { attachments: MariAttachment[]; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group inline-flex max-w-full items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)]"
        >
          <FileText size="0.8125rem" className="shrink-0" />
          <span className="max-w-[12rem] truncate">{attachment.name}</span>
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="rounded-full p-0.5 transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Remove attachment"
            aria-label={`Remove ${attachment.name}`}
          >
            <X size="0.6875rem" />
          </button>
        </div>
      ))}
    </div>
  );
}

function MariLiveMessage({ events }: { events: MariTraceEvent[] }) {
  const visibleEvents = events.length ? events : [{ type: "status", label: "Opening the workspace", summary: "Mari is getting her notes ready." } as MariTraceEvent];
  const recent = visibleEvents.slice(-3);
  const earlier = visibleEvents.slice(0, -3);
  return (
    <div className="flex w-full items-start gap-2.5 sm:gap-3">
      <MariAvatar />
      <div className="min-w-0 flex-1">
        <div className="relative w-full rounded-2xl rounded-tl-sm bg-[var(--card)]/88 py-3 pl-3.5 pr-[calc(0.875rem+var(--mari-bubble-overlap))] shadow-sm ring-1 ring-[var(--border)] sm:pl-4 sm:pr-[calc(1rem+var(--mari-bubble-overlap))]">
          <span className="absolute -left-1 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)] bg-[var(--card)]/88" />
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" />
            I am checking that now
          </div>
          {earlier.length > 0 && (
            <details className="mb-2 rounded-xl bg-[var(--secondary)]/45 px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
              <summary className="cursor-pointer font-medium">{earlier.length} earlier update{earlier.length === 1 ? "" : "s"}</summary>
              <div className="mt-2 space-y-1.5">
                {earlier.map((event, index) => (
                  <MariToolUpdate key={`${event.type}-earlier-${index}`} event={event} />
                ))}
              </div>
            </details>
          )}
          <div className="space-y-1.5">
            {recent.map((event, index) => (
              <MariToolUpdate key={`${event.type}-recent-${index}`} event={event} active={index === recent.length - 1} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MariToolDetails({ events }: { events: MariTraceEvent[] }) {
  if (!events.length) return null;
  return (
    <details className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--card)]/80 py-2 pl-2.5 pr-[calc(0.625rem+var(--mari-bubble-overlap))] text-xs shadow-sm backdrop-blur-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[var(--muted-foreground)] marker:hidden">
        <Sparkles size="0.8125rem" />
        <span className="font-semibold">Tool details</span>
        <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem]">
          {events.length}
        </span>
      </summary>
      <div className="mt-3 space-y-1.5">
        {events.map((event, index) => (
          <MariToolUpdate key={`${event.type}-${index}`} event={event} expandable />
        ))}
      </div>
    </details>
  );
}

function MariToolUpdate({ event, active, expandable }: { event: MariTraceEvent; active?: boolean; expandable?: boolean }) {
  const isTool = event.type === "tool_result";
  const isError = event.status === "error";
  const details = expandable ? traceDetails(event) : null;
  const Icon = isTool ? Terminal : isError ? AlertTriangle : Wrench;
  const summary = traceSummary(event);
  return (
    <div
      className={cn(
        "rounded-xl px-2.5 py-2",
        active ? "bg-[var(--primary)]/10" : "bg-[var(--secondary)]/45",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon size="0.8125rem" className={cn("mt-0.5 shrink-0", isError ? "text-red-400" : active ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-[var(--foreground)]/90">{traceLabel(event)}</span>
            {active && <span className="rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-[var(--primary)]">now</span>}
            {isTool && event.status && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[0.625rem]", isError ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-500")}>
                {event.status}
              </span>
            )}
          </div>
          {summary && <p className="mt-0.5 text-[0.6875rem] leading-5 text-[var(--muted-foreground)]">{summary}</p>}
          {details && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">Details</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--background)] p-2 text-[0.6875rem] leading-5 text-[var(--foreground)]/75">
                {details}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function traceLabel(event: MariTraceEvent) {
  if (event.type === "model_turn") return event.toolCalls?.length ? "Choosing tools" : "Reading the brief";
  if (event.type === "tool_result") return event.label || event.tool || "Tool finished";
  return event.label || "Workspace update";
}

function traceSummary(event: MariTraceEvent) {
  if (event.summary) return event.summary;
  if (event.type === "model_turn" && event.toolCalls?.length) return `${event.toolCalls.length} action${event.toolCalls.length === 1 ? "" : "s"} queued.`;
  if (event.type === "model_turn") return "Planning the next step.";
  if (event.error) return event.error;
  return null;
}

function MariErrorMessage({ message, details }: { message: string; details: string | null }) {
  return (
    <div className="flex w-full items-start gap-2.5 sm:gap-3">
      <MariAvatar />
      <div className="min-w-0 flex-1">
        <div className="w-full rounded-2xl rounded-tl-sm border border-red-500/25 bg-red-500/10 py-3 pl-3 pr-[calc(0.75rem+var(--mari-bubble-overlap))] text-sm text-red-400">
          <div className="font-semibold">I hit a snag.</div>
          <div className="mt-1">{message}</div>
          {details && (
            <details className="mt-2 text-[0.6875rem]">
              <summary className="cursor-pointer font-semibold">Debug details</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--background)] p-2">{details}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function traceDetails(event: MariTraceEvent) {
  const payload: Record<string, unknown> = {};
  if (event.type !== "model_turn" && event.content?.trim()) payload.content = event.content;
  if (event.toolCalls?.length) payload.toolCalls = event.toolCalls;
  if (event.arguments !== undefined) payload.arguments = event.arguments;
  if (event.result !== undefined) payload.result = event.result;
  if (event.error) payload.error = event.error;
  if (Object.keys(payload).length === 0) return null;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function MariOptionPanel({
  mode,
  connections,
  personas,
  selectedConnectionId,
  selectedPersonaId,
  onModeChange,
  onSelectConnection,
  onSelectPersona,
}: {
  mode: MariOptionPanel;
  connections: MariConnection[];
  personas: MariPersona[];
  selectedConnectionId: string | null;
  selectedPersonaId: string | null;
  onModeChange: (mode: MariOptionPanel) => void;
  onSelectConnection: (id: string | null) => void;
  onSelectPersona: (id: string | null) => void;
}) {
  return (
    <div className="mb-2 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg backdrop-blur-sm sm:w-[22rem]">
      <div className="flex gap-1 border-b border-[var(--border)] p-1">
        <OptionTab active={mode === "connections"} onClick={() => onModeChange("connections")} icon={<Link size="0.8125rem" />}>
          Model
        </OptionTab>
        <OptionTab active={mode === "personas"} onClick={() => onModeChange("personas")} icon={<CircleUser size="0.8125rem" />}>
          Persona
        </OptionTab>
      </div>
      {mode === "connections" ? (
        <div className="max-h-[min(18rem,38dvh)] overflow-y-auto p-1.5">
          <OptionRow active={selectedConnectionId === null} onClick={() => onSelectConnection(null)} title="Use default model" />
          {connections.map((connection) => (
            <OptionRow
              key={connection.id}
              active={connection.id === selectedConnectionId}
              onClick={() => onSelectConnection(connection.id)}
              title={connection.name || connection.id}
              detail={connection.provider}
            />
          ))}
          {connections.length === 0 && <EmptyOption>No models found.</EmptyOption>}
        </div>
      ) : (
        <div className="max-h-[min(18rem,38dvh)] overflow-y-auto p-1.5">
          <OptionRow active={selectedPersonaId === null} onClick={() => onSelectPersona(null)} title="No persona" avatar="?" />
          {personas.map((persona) => (
            <OptionRow
              key={persona.id}
              active={persona.id === selectedPersonaId}
              onClick={() => onSelectPersona(persona.id)}
              title={persona.name || persona.id}
              detail={persona.comment ?? undefined}
              avatar={persona.avatarPath ? { src: persona.avatarPath, crop: persona.avatarCrop } : (persona.name || "?")[0].toUpperCase()}
            />
          ))}
          {personas.length === 0 && <EmptyOption>No personas found.</EmptyOption>}
        </div>
      )}
    </div>
  );
}

function OptionTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
        active ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function OptionRow({
  active,
  onClick,
  title,
  detail,
  avatar,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail?: string;
  avatar?: string | { src: string; crop?: string };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--accent)]",
        active && "bg-[var(--primary)]/10 text-[var(--foreground)]",
      )}
    >
      {avatar !== undefined && (
        typeof avatar === "string" ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--secondary)] text-xs font-semibold text-[var(--muted-foreground)]">
            {avatar}
          </span>
        ) : (
          <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--secondary)]">
            <img
              src={avatar.src}
              alt=""
              className="h-full w-full object-cover"
              style={getAvatarCropStyle(parseAvatarCropJson(avatar.crop))}
              draggable={false}
            />
          </span>
        )
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {detail && <span className="block truncate text-[0.6875rem] text-[var(--muted-foreground)]">{detail}</span>}
      </span>
      {active && <Check size="0.875rem" className="shrink-0" />}
    </button>
  );
}

function EmptyOption({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">{children}</div>;
}
