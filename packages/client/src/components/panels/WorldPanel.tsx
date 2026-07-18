// ──────────────────────────────────────────────
// Panel: Living World — watch character life unfold
// ──────────────────────────────────────────────
// Status (queued moments, last narration), config (connection, pacing,
// budgets), the live world timeline, and the bonds browser with per-pair
// history ("how they met").
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Brain,
  CalendarCheck2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Heart,
  HeartHandshake,
  Lightbulb,
  Loader2,
  MapPin,
  MessageCircle,
  PenSquare,
  Play,
  Reply,
  Settings2,
  Sparkles,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import type { WorldEngineConfig, WorldEventRecord } from "@marinara-engine/shared";
import { DEFAULT_WORLD_ENGINE_CONFIG } from "@marinara-engine/shared";
import {
  useResetWorld,
  useRunWorldTick,
  useUpdateWorldConfig,
  useWorldFeed,
  useWorldPair,
  useWorldRelationships,
  useWorldStatus,
} from "../../hooks/use-world";
import { useConnections } from "../../hooks/use-connections";
import { useCharacters } from "../../hooks/use-characters";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { cn } from "../../lib/utils";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1.5 text-xs outline-none transition-colors focus:border-[var(--primary)]";

function parseCharacterRowName(data: unknown): string {
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    const name = (parsed as { name?: unknown } | null)?.name;
    return typeof name === "string" && name.trim() ? name.trim() : "Unnamed";
  } catch {
    return "Unnamed";
  }
}

const KIND_FILTERS: Array<{ key: string; label: string; kinds: string[] | null }> = [
  { key: "all", label: "All", kinds: null },
  { key: "thoughts", label: "Thoughts", kinds: ["thought", "say"] },
  { key: "living", label: "Living", kinds: ["activity", "hangout"] },
  { key: "noodle", label: "Noodle", kinds: ["noodle_post", "noodle_reply", "noodle_like", "noodle_follow"] },
  { key: "messages", label: "Messages", kinds: ["dm", "group"] },
  { key: "bonds", label: "Bonds", kinds: ["relationship", "milestone"] },
  { key: "memories", label: "Memories", kinds: ["memory"] },
  { key: "plans", label: "Plans", kinds: ["plan", "plan_completed"] },
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const ahead = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  const text =
    mins < 1 ? "now" : mins < 60 ? `${mins}m` : mins < 60 * 24 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / (60 * 24))}d`;
  if (text === "now") return ahead ? "any moment" : "just now";
  return ahead ? `in ${text}` : `${text} ago`;
}

function eventIcon(kind: string) {
  switch (kind) {
    case "thought":
      return <Lightbulb size="0.8rem" className="text-amber-300" />;
    case "say":
      return <MessageCircle size="0.8rem" className="text-amber-400" />;
    case "hangout":
      return <MapPin size="0.8rem" className="text-emerald-400" />;
    case "group":
      return <UsersRound size="0.8rem" className="text-sky-400" />;
    case "dm":
      return <MessageCircle size="0.8rem" className="text-sky-400" />;
    case "noodle_post":
      return <PenSquare size="0.8rem" className="text-emerald-400" />;
    case "noodle_reply":
      return <Reply size="0.8rem" className="text-emerald-400" />;
    case "noodle_like":
      return <Heart size="0.8rem" className="text-rose-400" />;
    case "noodle_follow":
      return <UserPlus size="0.8rem" className="text-emerald-400" />;
    case "plan":
      return <CalendarClock size="0.8rem" className="text-amber-400" />;
    case "plan_completed":
      return <CalendarCheck2 size="0.8rem" className="text-amber-400" />;
    case "milestone":
      return <Sparkles size="0.8rem" className="text-violet-400" />;
    case "relationship":
      return <HeartHandshake size="0.8rem" className="text-violet-400" />;
    case "memory":
      return <Brain size="0.8rem" className="text-indigo-400" />;
    default:
      return <Activity size="0.8rem" className="text-[var(--muted-foreground)]" />;
  }
}

function openWorldChat(event: WorldEventRecord) {
  const chatId = typeof event.detail.chatId === "string" ? event.detail.chatId : null;
  if (!chatId) return;
  useUIStore.getState().closeNoodle();
  useChatStore.getState().setActiveChatId(chatId);
  useUIStore.getState().closeRightPanel();
}

// ── Event row ──

function EventRow({ event }: { event: WorldEventRecord }) {
  const clickable = typeof event.detail.chatId === "string";
  const openLabel =
    event.kind === "thought" || event.kind === "say"
      ? "Open their life chat — you can write to them there"
      : event.kind === "group"
        ? "Open this group thread"
        : "Open this DM thread";
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => openWorldChat(event)}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border border-[var(--border)]/50 bg-[var(--card)]/50 px-2.5 py-2 text-left",
        clickable && "transition-colors hover:border-[var(--primary)]/50 hover:bg-[var(--accent)]/30",
      )}
      title={clickable ? openLabel : undefined}
    >
      <span className="mt-0.5 shrink-0">{eventIcon(event.kind)}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-xs leading-snug", event.kind === "thought" && "italic text-[var(--muted-foreground)]")}>
          {event.summary}
        </span>
        <span className="mt-0.5 block text-[0.65rem] text-[var(--muted-foreground)]">
          {relativeTime(event.createdAt)}
        </span>
      </span>
    </button>
  );
}

// ── Bonds ──

function scoreColor(score: number): string {
  if (score >= 45) return "bg-emerald-400";
  if (score >= 15) return "bg-sky-400";
  if (score > -15) return "bg-[var(--muted-foreground)]";
  return "bg-rose-400";
}

function BondCard({
  aName,
  bName,
  aId,
  bId,
  stageLabel,
  score,
  romance,
  summary,
}: {
  aName: string;
  bName: string;
  aId: string;
  bId: string;
  stageLabel: string;
  score: number;
  romance: boolean;
  summary: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: pair, isLoading } = useWorldPair(expanded ? aId : null, expanded ? bId : null);

  return (
    <div className="rounded-lg border border-[var(--border)]/50 bg-[var(--card)]/50">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <span className="shrink-0 text-[var(--muted-foreground)]">
          {expanded ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <span className="truncate">
              {aName} &amp; {bName}
            </span>
            {romance ? <Heart size="0.7rem" className="shrink-0 fill-rose-400 text-rose-400" /> : null}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1 w-24 overflow-hidden rounded-full bg-[var(--border)]/70">
              <span
                className={cn("block h-full rounded-full", scoreColor(score))}
                style={{ width: `${Math.round(((score + 100) / 200) * 100)}%` }}
              />
            </span>
            <span className="text-[0.65rem] capitalize text-[var(--muted-foreground)]">
              {stageLabel} · {score > 0 ? `+${score}` : score}
            </span>
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-[var(--border)]/50 px-2.5 py-2">
          {summary ? <p className="text-[0.7rem] italic leading-snug text-[var(--muted-foreground)]">{summary}</p> : null}
          {isLoading ? (
            <Loader2 size="0.85rem" className="animate-spin text-[var(--muted-foreground)]" />
          ) : (
            <>
              {pair?.relationship?.milestones.length ? (
                <div className="space-y-1">
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Milestones
                  </span>
                  {pair.relationship.milestones.map((milestone, idx) => (
                    <div key={`${milestone.at}-${idx}`} className="flex items-start gap-1.5">
                      <Sparkles size="0.7rem" className="mt-0.5 shrink-0 text-violet-400" />
                      <span className="min-w-0 text-[0.7rem] leading-snug">
                        <span className="font-medium">{milestone.title}</span>
                        {milestone.description ? (
                          <span className="text-[var(--muted-foreground)]"> — {milestone.description}</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {pair?.events.length ? (
                <div className="space-y-1">
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Their story
                  </span>
                  {pair.events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </div>
              ) : (
                <p className="text-[0.7rem] text-[var(--muted-foreground)]">No shared history recorded yet.</p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Config ──

function WorldConfigForm({
  config,
  onSaved,
}: {
  config: WorldEngineConfig;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<WorldEngineConfig>(config);
  const { data: connections } = useConnections();
  const { data: characters } = useCharacters();
  const updateConfig = useUpdateWorldConfig();
  const resetWorld = useResetWorld();

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const characterRows = useMemo(
    () =>
      ((characters ?? []) as Array<{ id?: unknown; data?: unknown }>)
        .filter((row): row is { id: string; data: unknown } => typeof row.id === "string")
        .map((row) => ({ id: row.id, name: parseCharacterRowName(row.data) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [characters],
  );
  const everyone = draft.memberCharacterIds === null;
  const memberSet = useMemo(() => new Set(draft.memberCharacterIds ?? []), [draft.memberCharacterIds]);

  const toggleMember = (id: string) => {
    const next = new Set(memberSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDraft({ ...draft, memberCharacterIds: [...next] });
  };

  const connectionOptions = useMemo(
    () =>
      ((connections ?? []) as Array<{ id?: unknown; name?: unknown; model?: unknown }>)
        .filter((conn): conn is { id: string; name?: string; model?: string } => typeof conn.id === "string")
        .map((conn) => ({
          id: conn.id,
          label: `${typeof conn.name === "string" && conn.name ? conn.name : conn.id}${typeof conn.model === "string" && conn.model ? ` — ${conn.model}` : ""}`,
        })),
    [connections],
  );

  const save = async () => {
    try {
      await updateConfig.mutateAsync(draft);
      toast.success(draft.enabled ? "World is live — it'll keep simmering on its own" : "World config saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save world config");
    }
  };

  const setNum = (key: keyof WorldEngineConfig, value: string, fallback: number) => {
    const parsed = Number.parseFloat(value);
    setDraft({ ...draft, [key]: Number.isFinite(parsed) ? parsed : fallback });
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/30 p-2.5">
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">World enabled</span>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          className="h-4 w-4 accent-[var(--primary)]"
        />
      </label>

      <label className="block space-y-0.5">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">Simulation style</span>
        <select
          className={inputClass}
          value={draft.mode}
          onChange={(e) => setDraft({ ...draft, mode: e.target.value === "director" ? "director" : "minds" })}
        >
          <option value="minds">Character minds — every character is its own AI (natural, emergent)</option>
          <option value="director">Director — one cheap planning call writes a timeline</option>
        </select>
      </label>

      {draft.mode === "minds" ? (
        <label className="block space-y-0.5">
          <span className="text-[0.65rem] text-[var(--muted-foreground)]">World pace</span>
          <select
            className={inputClass}
            value={String(
              [2, 5, 15, 45, 90].includes(draft.wakeIntervalMinutes) ? draft.wakeIntervalMinutes : "custom",
            )}
            onChange={(e) => {
              if (e.target.value !== "custom") {
                setDraft({ ...draft, wakeIntervalMinutes: Number.parseInt(e.target.value, 10) });
              }
            }}
          >
            <option value="2">Bustling — everyone acts every couple of minutes</option>
            <option value="5">Lively — turns every ~5 minutes</option>
            <option value="15">Casual — turns every ~15 minutes</option>
            <option value="45">Relaxed — a slower day-to-day drift</option>
            <option value="90">Slow life — hours between check-ins</option>
            <option value="custom">Custom (set below)</option>
          </select>
        </label>
      ) : null}

      <label className="block space-y-0.5">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">
          Connection ({draft.mode === "minds" ? "each mind thinks with this" : "the director plans with this"})
        </span>
        <select
          className={inputClass}
          value={draft.connectionId ?? ""}
          onChange={(e) => setDraft({ ...draft, connectionId: e.target.value || null })}
        >
          <option value="">Not configured</option>
          <option value="local">Local sidecar (free)</option>
          {connectionOptions.map((conn) => (
            <option key={conn.id} value={conn.id}>
              {conn.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-3 gap-1.5">
        {draft.mode === "minds" ? (
          <label className="block space-y-0.5">
            <span className="text-[0.65rem] text-[var(--muted-foreground)]">Check-in avg (min)</span>
            <input
              type="number"
              min={1}
              max={1440}
              className={inputClass}
              value={draft.wakeIntervalMinutes}
              onChange={(e) =>
                setNum("wakeIntervalMinutes", e.target.value, DEFAULT_WORLD_ENGINE_CONFIG.wakeIntervalMinutes)
              }
            />
          </label>
        ) : (
          <>
            <label className="block space-y-0.5">
              <span className="text-[0.65rem] text-[var(--muted-foreground)]">Window (min)</span>
              <input
                type="number"
                min={5}
                max={1440}
                className={inputClass}
                value={draft.cadenceMinutes}
                onChange={(e) => setNum("cadenceMinutes", e.target.value, DEFAULT_WORLD_ENGINE_CONFIG.cadenceMinutes)}
              />
            </label>
            <label className="block space-y-0.5">
              <span className="text-[0.65rem] text-[var(--muted-foreground)]">Moments / window</span>
              <input
                type="number"
                min={1}
                max={12}
                className={inputClass}
                value={draft.maxActionsPerTick}
                onChange={(e) =>
                  setNum("maxActionsPerTick", e.target.value, DEFAULT_WORLD_ENGINE_CONFIG.maxActionsPerTick)
                }
              />
            </label>
          </>
        )}
        <label className="block space-y-0.5">
          <span className="text-[0.65rem] text-[var(--muted-foreground)]">Daily cap (0 = off)</span>
          <input
            type="number"
            min={0}
            max={100000}
            className={inputClass}
            value={draft.dailyActionCap}
            onChange={(e) => setNum("dailyActionCap", e.target.value, DEFAULT_WORLD_ENGINE_CONFIG.dailyActionCap)}
          />
        </label>
      </div>
      {draft.mode === "minds" ? (
        <p className="text-[0.6rem] leading-snug text-[var(--muted-foreground)]">
          Everyone gets a turn roughly every {Math.max(1, draft.wakeIntervalMinutes)} min, at offset times — pings
          (DMs, your messages) answer faster. Budget honesty:{" "}
          <span className="text-[var(--foreground)]">
            {(everyone ? characterRows.length : memberSet.size) || 0} characters ×{" "}
            {Math.max(1, Math.round((24 * 60) / Math.max(1, draft.wakeIntervalMinutes)))} check-ins/day ≈{" "}
            {(
              ((everyone ? characterRows.length : memberSet.size) || 0) *
              Math.max(1, Math.round((24 * 60) / Math.max(1, draft.wakeIntervalMinutes)))
            ).toLocaleString()}{" "}
            model calls/day
          </span>{" "}
          (daily cap still applies).
        </p>
      ) : null}

      <div className="space-y-1">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">Who lives in this world</span>
        <label className="flex items-center gap-1.5 text-[0.7rem]">
          <input
            type="checkbox"
            checked={everyone}
            onChange={(e) =>
              setDraft({ ...draft, memberCharacterIds: e.target.checked ? null : characterRows.map((row) => row.id) })
            }
            className="h-3.5 w-3.5 accent-[var(--primary)]"
          />
          Everyone ({characterRows.length} characters)
        </label>
        {!everyone ? (
          <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-[var(--border)]/60 bg-[var(--card)]/40 p-1.5 [scrollbar-width:thin]">
            {characterRows.map((row) => (
              <label
                key={row.id}
                className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[0.7rem] transition-colors hover:bg-[var(--accent)]/30"
              >
                <input
                  type="checkbox"
                  checked={memberSet.has(row.id)}
                  onChange={() => toggleMember(row.id)}
                  className="h-3.5 w-3.5 accent-[var(--primary)]"
                />
                <span className="truncate">{row.name}</span>
              </label>
            ))}
            {!characterRows.length ? (
              <p className="px-1 py-0.5 text-[0.65rem] text-[var(--muted-foreground)]">No characters yet.</p>
            ) : null}
            <p className="px-1 pt-1 text-[0.6rem] leading-snug text-[var(--muted-foreground)]">
              {memberSet.size < 2 ? "Pick at least two — a world needs company." : `${memberSet.size} in the world.`}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(
          [
            ["allowNoodle", "Noodle activity"],
            ["allowDms", "Character DMs"],
            ["allowMemories", "Memories"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-[0.7rem]">
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--primary)]"
            />
            {label}
          </label>
        ))}
      </div>

      <label className="block space-y-0.5">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">
          Standing directive (optional — e.g. &quot;slow-burn romances only&quot;)
        </span>
        <textarea
          className={cn(inputClass, "min-h-[2.5rem] resize-y")}
          rows={2}
          value={draft.userDirective}
          onChange={(e) => setDraft({ ...draft, userDirective: e.target.value })}
        />
      </label>

      <button
        type="button"
        disabled={updateConfig.isPending}
        onClick={() => void save()}
        className="w-full rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
      >
        {updateConfig.isPending ? "Saving…" : "Save world settings"}
      </button>

      <button
        type="button"
        disabled={resetWorld.isPending}
        onClick={() => {
          if (
            !window.confirm(
              "Reset the world? This permanently deletes all world events, relationships, memories, minds, and every life/DM/group/hangout chat, and clears the Noodle timeline. Characters and settings are kept.",
            )
          ) {
            return;
          }
          resetWorld
            .mutateAsync(true)
            .then((result) => toast.success(`World reset — removed ${result.removedChats} world chats`))
            .catch((err) => toast.error(err instanceof Error ? err.message : "Reset failed"));
        }}
        className="w-full rounded-md border border-[var(--destructive)]/50 px-3 py-1.5 text-xs font-medium text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:opacity-40"
      >
        {resetWorld.isPending ? "Resetting…" : "Reset world (wipe everything)"}
      </button>
    </div>
  );
}

// ── Panel ──

export function WorldPanel() {
  const { data: status } = useWorldStatus();
  const runTick = useRunWorldTick();
  const [tab, setTab] = useState<"timeline" | "bonds">("timeline");
  const [configOpen, setConfigOpen] = useState(false);
  const [filterCharacterId, setFilterCharacterId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState("all");

  const { data: feed, isLoading: feedLoading } = useWorldFeed(filterCharacterId);
  const filteredEvents = useMemo(() => {
    const kinds = KIND_FILTERS.find((filter) => filter.key === kindFilter)?.kinds ?? null;
    const events = feed?.events ?? [];
    return kinds ? events.filter((event) => kinds.includes(event.kind)) : events;
  }, [feed?.events, kindFilter]);
  const { data: bonds, isLoading: bondsLoading } = useWorldRelationships();

  const needsSetup = !!status && (!status.config.connectionId || !status.config.enabled);
  const showConfig = configOpen || (needsSetup && !status?.config.connectionId);

  const characterOptions = useMemo(() => {
    const names = feed?.names ?? {};
    return Object.entries(names)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [feed?.names]);

  const advance = async () => {
    try {
      const result = await runTick.mutateAsync();
      if (result.error) {
        toast.error(result.error);
      } else if (result.ran) {
        const parts: string[] = [];
        if (result.queued > 0) parts.push(`${result.queued} moment${result.queued === 1 ? "" : "s"} planned`);
        if (result.executedNow > 0) parts.push(`${result.executedNow} action${result.executedNow === 1 ? "" : "s"} happened`);
        const headline = result.narration
          ? result.narration.length > 90
            ? `${result.narration.slice(0, 89)}…`
            : result.narration
          : "The world moved";
        toast.success(parts.length ? `${headline} (${parts.join(", ")})` : headline);
      } else {
        toast.info(result.skippedReason ?? "Nothing to do right now");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "World advance failed");
    }
  };

  return (
    <div className="space-y-3 p-3">
      {/* ── Status ── */}
      <div className="space-y-1.5 rounded-lg border border-[var(--border)]/60 bg-[var(--card)]/60 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                status?.config.enabled ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60" : "bg-[var(--border)]",
              )}
            />
            {status?.config.enabled ? "World is live" : "World is paused"}
          </span>
          <span className="text-[0.65rem] text-[var(--muted-foreground)]">
            {status?.provider.ok ? status.provider.label : "no connection"}
          </span>
        </div>
        {status?.state.lastNarration ? (
          <p className="text-[0.7rem] italic leading-snug text-[var(--muted-foreground)]">
            “{status.state.lastNarration}”
          </p>
        ) : null}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.65rem] text-[var(--muted-foreground)]">
          {status?.config.mode === "minds" ? (
            <span>
              {status.minds.count} mind{status.minds.count === 1 ? "" : "s"}
              {status.minds.nextWakeAt ? ` · next check-in ${relativeTime(status.minds.nextWakeAt)}` : ""}
            </span>
          ) : (
            <span>
              {status?.timeline.count ?? 0} moment{(status?.timeline.count ?? 0) === 1 ? "" : "s"} queued
              {status?.timeline.nextRunAt ? ` · next ${relativeTime(status.timeline.nextRunAt)}` : ""}
            </span>
          )}
          <span>
            today {status?.state.dailyCount ?? 0}/
            {(status?.config.dailyActionCap ?? 0) > 0 ? status!.config.dailyActionCap : "∞"}
          </span>
          {status?.state.lastError ? <span className="text-rose-400">last error: {status.state.lastError}</span> : null}
        </div>
        <div className="flex gap-1.5 pt-0.5">
          <button
            type="button"
            disabled={runTick.isPending || !status?.provider.ok}
            onClick={() => void advance()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
            title={status?.provider.ok ? "Plan and start the next stretch of world time" : "Configure a connection first"}
          >
            {runTick.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Play size="0.75rem" />}
            Advance the world
          </button>
          <button
            type="button"
            onClick={() => setConfigOpen((prev) => !prev)}
            className={cn(
              "rounded-md border border-[var(--border)] px-2.5 py-1.5 transition-colors hover:bg-[var(--accent)]/40",
              showConfig && "border-[var(--primary)]/60 bg-[var(--primary)]/10",
            )}
            title="World settings"
            aria-label="World settings"
          >
            <Settings2 size="0.8rem" />
          </button>
        </div>
      </div>

      {/* ── Config ── */}
      {showConfig && status ? <WorldConfigForm config={status.config} onSaved={() => setConfigOpen(false)} /> : null}

      {/* ── Tabs ── */}
      <div className="flex gap-1 rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/40 p-0.5">
        {(
          [
            ["timeline", "Timeline"],
            ["bonds", "Bonds"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              tab === key ? "bg-[var(--card)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "timeline" ? (
        <div className="space-y-1.5">
          <div className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
            {KIND_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setKindFilter(filter.key)}
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[0.65rem] transition-colors",
                  kindFilter === filter.key
                    ? "border-[var(--primary)]/70 bg-[var(--primary)]/15 font-medium"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {characterOptions.length > 1 ? (
            <select
              className={inputClass}
              value={filterCharacterId ?? ""}
              onChange={(e) => setFilterCharacterId(e.target.value || null)}
              aria-label="Filter timeline by character"
            >
              <option value="">Everyone</option>
              {characterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          ) : null}
          {feedLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 size="1rem" className="animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : filteredEvents.length ? (
            filteredEvents.map((event) => <EventRow key={event.id} event={event} />)
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[0.7rem] leading-relaxed text-[var(--muted-foreground)]">
              Nothing has happened yet. Enable the world (or tap Advance) and life will start trickling in —
              posts, DMs, plans, and slowly, relationships.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {bondsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 size="1rem" className="animate-spin text-[var(--muted-foreground)]" />
            </div>
          ) : bonds?.relationships.length ? (
            bonds.relationships.map((rel) => (
              <BondCard
                key={rel.id}
                aId={rel.aCharacterId}
                bId={rel.bCharacterId}
                aName={bonds.names[rel.aCharacterId] ?? "Unknown"}
                bName={bonds.names[rel.bCharacterId] ?? "Unknown"}
                stageLabel={rel.label ?? rel.stage}
                score={rel.score}
                romance={rel.romance}
                summary={rel.summary}
              />
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[0.7rem] leading-relaxed text-[var(--muted-foreground)]">
              Nobody has really met anybody yet. Bonds form on their own as characters cross paths.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
