// ──────────────────────────────────────────────
// Panel: Living World — watch character life unfold
// ──────────────────────────────────────────────
// Status (queued moments, last narration), config (connection, pacing,
// budgets), the live world timeline, and the bonds browser with per-pair
// history ("how they met").
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Brain,
  Building2,
  CalendarCheck2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Coins,
  Compass,
  Footprints,
  Heart,
  HeartHandshake,
  Lightbulb,
  Loader2,
  MapPin,
  MessageCircle,
  PartyPopper,
  PenSquare,
  Play,
  Reply,
  Settings2,
  Sparkles,
  UserPlus,
  UsersRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import type { WorldEngineConfig, WorldEventRecord } from "@marinara-engine/shared";
import { DEFAULT_WORLD_ENGINE_CONFIG } from "@marinara-engine/shared";
import {
  useCreatePlace,
  useCreateWorldGroup,
  useCreateWorldUserDm,
  useGoToPlace,
  useResetWorld,
  useRunWorldTick,
  useUpdateWorldConfig,
  useWorldCity,
  useWorldFeed,
  useWorldPair,
  useWorldRelationships,
  useWorldStatus,
} from "../../hooks/use-world";
import { useConnections } from "../../hooks/use-connections";
import { useCharacters, usePersonas } from "../../hooks/use-characters";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { cn } from "../../lib/utils";
import { useTranslation as useUiTranslation } from "react-i18next";

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
  { key: "messages", label: "Messages", kinds: ["dm", "group", "scene"] },
  { key: "city", label: "City", kinds: ["moved", "discovered", "place_detail", "worked", "spent"] },
  { key: "events", label: "Events", kinds: ["event"] },
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
    mins < 1
      ? "now"
      : mins < 60
        ? `${mins}m`
        : mins < 60 * 24
          ? `${Math.round(mins / 60)}h`
          : `${Math.round(mins / (60 * 24))}d`;
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
    case "scene":
      return <MapPin size="0.8rem" className="text-emerald-400" />;
    case "moved":
      return <Footprints size="0.8rem" className="text-teal-400" />;
    case "discovered":
      return <Compass size="0.8rem" className="text-teal-400" />;
    case "place_detail":
      return <Building2 size="0.8rem" className="text-teal-400" />;
    case "worked":
      return <Wrench size="0.8rem" className="text-lime-400" />;
    case "spent":
      return <Coins size="0.8rem" className="text-yellow-400" />;
    case "event":
      return <PartyPopper size="0.8rem" className="text-pink-400" />;
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
        <span
          className={cn(
            "block text-xs leading-snug",
            event.kind === "thought" && "italic text-[var(--muted-foreground)]",
          )}
        >
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
  const { t: localizeUi } = useUiTranslation();
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
              {stageLabel} · {score > 0 ? localizeUi("ui.panels.bondcard.value1", { value1: score }) : score}
            </span>
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-[var(--border)]/50 px-2.5 py-2">
          {summary ? (
            <p className="text-[0.7rem] italic leading-snug text-[var(--muted-foreground)]">{summary}</p>
          ) : null}
          {isLoading ? (
            <Loader2 size="0.85rem" className="animate-spin text-[var(--muted-foreground)]" />
          ) : (
            <>
              {pair?.relationship?.milestones.length ? (
                <div className="space-y-1">
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    {localizeUi("ui.panels.bondcard.milestones")}
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
                    {localizeUi("ui.panels.bondcard.theirStory")}
                  </span>
                  {pair.events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </div>
              ) : (
                <p className="text-[0.7rem] text-[var(--muted-foreground)]">
                  {localizeUi("ui.panels.bondcard.noSharedHistoryRecordedYet")}
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Config ──

function WorldConfigForm({ config, onSaved }: { config: WorldEngineConfig; onSaved: () => void }) {
  const { t: localizeUi } = useUiTranslation();
  const [draft, setDraft] = useState<WorldEngineConfig>(config);
  const { data: connections } = useConnections();
  const { data: characters } = useCharacters();
  const { data: personas } = usePersonas();
  const updateConfig = useUpdateWorldConfig();
  const resetWorld = useResetWorld();

  // Only re-sync the form when the server config MEANINGFULLY changed — the
  // status poll returns a fresh object every 15s, and syncing on identity
  // wiped in-progress edits (the persona picker kept "defaulting to none").
  const lastSyncedConfig = useRef<string>("");
  useEffect(() => {
    const serialized = JSON.stringify(config);
    if (serialized !== lastSyncedConfig.current) {
      lastSyncedConfig.current = serialized;
      setDraft(config);
    }
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
      toast.success(
        draft.enabled
          ? localizeUi("ui.panels.worldconfigform.worldIsLiveItLlKeepSimmeringOnIts")
          : localizeUi("ui.panels.worldconfigform.worldConfigSaved"),
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : localizeUi("ui.panels.worldconfigform.failedToSaveWorldConfig"));
    }
  };

  const setNum = (key: keyof WorldEngineConfig, value: string, fallback: number) => {
    const parsed = Number.parseFloat(value);
    setDraft({ ...draft, [key]: Number.isFinite(parsed) ? parsed : fallback });
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)]/30 p-2.5">
      <label className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{localizeUi("ui.panels.worldconfigform.worldEnabled")}</span>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          className="h-4 w-4 accent-[var(--primary)]"
        />
      </label>

      <label className="block space-y-0.5">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">
          {localizeUi("ui.panels.worldconfigform.simulationStyle")}
        </span>
        <select
          className={inputClass}
          value={draft.mode}
          onChange={(e) => setDraft({ ...draft, mode: e.target.value === "director" ? "director" : "minds" })}
        >
          <option value="minds">
            {localizeUi("ui.panels.worldconfigform.characterMindsEveryCharacterIsItsOwnAiNatural")}
          </option>
          <option value="director">
            {localizeUi("ui.panels.worldconfigform.directorOneCheapPlanningCallWritesATimeline")}
          </option>
        </select>
      </label>

      {draft.mode === "minds" ? (
        <label className="block space-y-0.5">
          <span className="text-[0.65rem] text-[var(--muted-foreground)]">
            {localizeUi("ui.panels.worldconfigform.worldPace")}
          </span>
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
            <option value="2">
              {localizeUi("ui.panels.worldconfigform.bustlingEveryoneActsEveryCoupleOfMinutes")}
            </option>
            <option value="5">{localizeUi("ui.panels.worldconfigform.livelyTurnsEvery5Minutes")}</option>
            <option value="15">{localizeUi("ui.panels.worldconfigform.casualTurnsEvery15Minutes")}</option>
            <option value="45">{localizeUi("ui.panels.worldconfigform.relaxedASlowerDayToDayDrift")}</option>
            <option value="90">{localizeUi("ui.panels.worldconfigform.slowLifeHoursBetweenCheckIns")}</option>
            <option value="custom">{localizeUi("ui.panels.worldconfigform.customSetBelow")}</option>
          </select>
        </label>
      ) : null}

      <label className="block space-y-0.5">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">
          {localizeUi("ui.panels.worldconfigform.connection")}
          {draft.mode === "minds"
            ? localizeUi("ui.panels.worldconfigform.eachMindThinksWithThis")
            : localizeUi("ui.panels.worldconfigform.theDirectorPlansWithThis")}
          )
        </span>
        <select
          className={inputClass}
          value={draft.connectionId ?? ""}
          onChange={(e) => setDraft({ ...draft, connectionId: e.target.value || null })}
        >
          <option value="">{localizeUi("ui.panels.worldconfigform.notConfigured")}</option>
          <option value="local">{localizeUi("ui.panels.worldconfigform.localSidecarFree")}</option>
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
            <span className="text-[0.65rem] text-[var(--muted-foreground)]">
              {localizeUi("ui.panels.worldconfigform.checkInAvgMin")}
            </span>
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
              <span className="text-[0.65rem] text-[var(--muted-foreground)]">
                {localizeUi("ui.panels.worldconfigform.windowMin")}
              </span>
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
              <span className="text-[0.65rem] text-[var(--muted-foreground)]">
                {localizeUi("ui.panels.worldconfigform.momentsWindow")}
              </span>
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
          <span className="text-[0.65rem] text-[var(--muted-foreground)]">
            {localizeUi("ui.panels.worldconfigform.dailyCap0Off")}
          </span>
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
          {localizeUi("ui.panels.worldconfigform.everyoneGetsATurnRoughlyEvery")}{" "}
          {Math.max(1, draft.wakeIntervalMinutes)}{" "}
          {localizeUi("ui.panels.worldconfigform.minAtOffsetTimesPingsDmsYourMessagesAnswer")}{" "}
          <span className="text-[var(--foreground)]">
            {(everyone ? characterRows.length : memberSet.size) || 0}{" "}
            {localizeUi("ui.panels.worldconfigform.characters")}{" "}
            {Math.max(1, Math.round((24 * 60) / Math.max(1, draft.wakeIntervalMinutes)))}{" "}
            {localizeUi("ui.panels.worldconfigform.checkInsDay")}{" "}
            {(
              ((everyone ? characterRows.length : memberSet.size) || 0) *
              Math.max(1, Math.round((24 * 60) / Math.max(1, draft.wakeIntervalMinutes)))
            ).toLocaleString()}{" "}
            {localizeUi("ui.panels.worldconfigform.modelCallsDay")}
          </span>{" "}
          {localizeUi("ui.panels.worldconfigform.dailyCapStillApplies")}
        </p>
      ) : null}

      <div className="space-y-1">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">
          {localizeUi("ui.panels.worldconfigform.whoLivesInThisWorld")}
        </span>
        <label className="flex items-center gap-1.5 text-[0.7rem]">
          <input
            type="checkbox"
            checked={everyone}
            onChange={(e) =>
              setDraft({ ...draft, memberCharacterIds: e.target.checked ? null : characterRows.map((row) => row.id) })
            }
            className="h-3.5 w-3.5 accent-[var(--primary)]"
          />
          {localizeUi("ui.panels.worldconfigform.everyone")}
          {characterRows.length} {localizeUi("ui.panels.worldconfigform.characters_d1a48da")}
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
              <p className="px-1 py-0.5 text-[0.65rem] text-[var(--muted-foreground)]">
                {localizeUi("ui.panels.worldconfigform.noCharactersYet")}
              </p>
            ) : null}
            <p className="px-1 pt-1 text-[0.6rem] leading-snug text-[var(--muted-foreground)]">
              {memberSet.size < 2
                ? localizeUi("ui.panels.worldconfigform.pickAtLeastTwoAWorldNeedsCompany")
                : localizeUi("ui.panels.worldconfigform.value1InTheWorld", { value1: memberSet.size })}
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
          {localizeUi("ui.panels.worldconfigform.youInTheWorldWhichPersonaTheCharactersKnow")}
        </span>
        <select
          className={inputClass}
          value={draft.userPersonaId ?? ""}
          onChange={(e) => setDraft({ ...draft, userPersonaId: e.target.value || null })}
        >
          <option value="">{localizeUi("ui.panels.worldconfigform.useTheGloballyActivePersona")}</option>
          {((personas ?? []) as Array<{ id: string; name: string }>).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-0.5">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">
          {localizeUi("ui.panels.worldconfigform.weatherCityOptionalRealWeatherFromThisCityColors")}
        </span>
        <input
          className={inputClass}
          value={draft.weatherLocation}
          onChange={(e) => setDraft({ ...draft, weatherLocation: e.target.value })}
          placeholder={localizeUi("ui.panels.worldconfigform.eGTokyoReykjavikAustin")}
        />
      </label>

      <label className="block space-y-0.5">
        <span className="text-[0.65rem] text-[var(--muted-foreground)]">
          {localizeUi("ui.panels.worldconfigform.standingDirectiveOptionalEGSlowBurnRomancesOnly")}
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
        {updateConfig.isPending
          ? localizeUi("chat.settings.inlineEditor.saving")
          : localizeUi("ui.panels.worldconfigform.saveWorldSettings")}
      </button>

      <button
        type="button"
        disabled={resetWorld.isPending}
        onClick={() => {
          if (
            !window.confirm(localizeUi("ui.panels.worldconfigform.resetTheWorldThisPermanentlyDeletesAllWorldEvents"))
          ) {
            return;
          }
          resetWorld
            .mutateAsync(true)
            .then((result) =>
              toast.success(
                localizeUi("ui.panels.worldconfigform.worldResetRemovedValue1WorldChats", {
                  value1: result.removedChats,
                }),
              ),
            )
            .catch((err) =>
              toast.error(err instanceof Error ? err.message : localizeUi("ui.panels.worldconfigform.resetFailed")),
            );
        }}
        className="w-full rounded-md border border-[var(--destructive)]/50 px-3 py-1.5 text-xs font-medium text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:opacity-40"
      >
        {resetWorld.isPending
          ? localizeUi("ui.panels.worldconfigform.resetting")
          : localizeUi("ui.panels.worldconfigform.resetWorldWipeEverything")}
      </button>
    </div>
  );
}

// ── City map ──

/** Deterministic 0..1 position from a place id — stable across renders. */
function hashPosition(id: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = (h >>> 0) / 4294967295;
  const b = (Math.imul(h ^ 0x9e3779b9, 2654435761) >>> 0) / 4294967295;
  return { x: 0.1 + a * 0.8, y: 0.12 + b * 0.76 };
}

function openWorldChatById(chatId: string) {
  useUIStore.getState().closeNoodle();
  useChatStore.getState().setActiveChatId(chatId);
  useUIStore.getState().closeRightPanel();
}

function CityMap() {
  const { t: localizeUi } = useUiTranslation();
  const { data: city, isLoading } = useWorldCity();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const nodes = useMemo(() => {
    const places = city?.places ?? [];
    // Homes ring the edge, public places cluster toward the middle.
    return places.map((place) => {
      const base = hashPosition(place.id);
      const here = [...(city?.peopleByPlace[place.id] ?? [])];
      if (city?.userPlaceId === place.id) here.push("You");
      return { place, pos: base, here };
    });
  }, [city]);

  const zoomBy = (factor: number) => setScale((s) => Math.min(4, Math.max(0.6, s * factor)));
  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 size="1rem" className="animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }
  if (!nodes.length) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[0.7rem] leading-relaxed text-[var(--muted-foreground)]">
        {localizeUi("ui.panels.citymap.noMapYetAsCharactersSetUpHomesAnd")}
      </p>
    );
  }
  return (
    <div
      className="relative h-[22rem] w-full touch-none select-none overflow-hidden rounded-lg border border-[var(--border)]/60 bg-[radial-gradient(circle_at_50%_40%,var(--secondary)_0%,var(--background)_100%)]"
      onWheel={(e) => {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.12 : 0.9);
      }}
      onPointerDown={(e) => {
        // Let clicks on place buttons through; drag only on the open map.
        if ((e.target as HTMLElement).closest("[data-place-node]")) return;
        drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        drag.current.moved = true;
        setOffset({
          x: drag.current.ox + (e.clientX - drag.current.x),
          y: drag.current.oy + (e.clientY - drag.current.y),
        });
      }}
      onPointerUp={(e) => {
        drag.current = null;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* capture may already be released */
        }
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {nodes.map(({ place, pos, here }) => (
          <button
            key={place.id}
            type="button"
            data-place-node
            disabled={!place.sceneChatId}
            onClick={() => place.sceneChatId && openWorldChatById(place.sceneChatId)}
            className={cn(
              "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5",
              place.sceneChatId ? "cursor-pointer" : "cursor-default",
            )}
            style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
            title={
              [place.description, place.interior && `Inside: ${place.interior}`].filter(Boolean).join(" — ") ||
              place.name
            }
          >
            <span
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6rem] font-medium shadow-sm backdrop-blur-sm transition-colors",
                here.length ? "border-emerald-400/60 bg-emerald-400/15" : "border-[var(--border)] bg-[var(--card)]/80",
                place.sceneChatId && "hover:border-[var(--primary)]/70",
              )}
            >
              {place.ownerId ? (
                <Building2 size="0.6rem" className="text-indigo-400" />
              ) : (
                <MapPin size="0.6rem" className="text-teal-400" />
              )}
              {place.name}
            </span>
            {here.length ? (
              <span className="max-w-[8rem] truncate text-[0.55rem] text-emerald-400">{here.join(", ")}</span>
            ) : null}
          </button>
        ))}
      </div>
      {/* Zoom controls */}
      <div className="absolute bottom-2 right-2 flex flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)]/90 text-[var(--foreground)] shadow-sm backdrop-blur-sm">
        <button
          type="button"
          onClick={() => zoomBy(1.2)}
          className="px-2 py-1 text-sm leading-none hover:bg-[var(--secondary)]"
          title={localizeUi("ui.game.mapzoomcontrols.zoomIn")}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(0.83)}
          className="border-t border-[var(--border)] px-2 py-1 text-sm leading-none hover:bg-[var(--secondary)]"
          title={localizeUi("ui.game.mapzoomcontrols.zoomOut")}
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          className="border-t border-[var(--border)] px-2 py-1 text-[0.6rem] leading-none hover:bg-[var(--secondary)]"
          title={localizeUi("ui.panels.citymap.resetView")}
        >
          ⟳
        </button>
      </div>
    </div>
  );
}

// ── City ──

function CityView() {
  const { t: localizeUi } = useUiTranslation();
  const { data: city, isLoading } = useWorldCity();
  const homeless = (city?.residents ?? []).filter((resident) => !resident.placeId);
  // Select residents to message one, or start a group with several.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const createDm = useCreateWorldUserDm();
  const createGroup = useCreateWorldGroup();
  const toggleResident = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startChatWithSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const res =
        ids.length === 1 ? await createDm.mutateAsync(ids[0]!) : await createGroup.mutateAsync({ characterIds: ids });
      if (res?.chatId) openWorldChatById(res.chatId);
      setSelected(new Set());
    } catch {
      toast.error(localizeUi("ui.panels.cityview.couldnTStartThatChatIsTheLivingWorld"));
    }
  };
  const startingChat = createDm.isPending || createGroup.isPending;
  // Your own movement + place creation.
  const goTo = useGoToPlace();
  const createPlace = useCreatePlace();
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPlaceKind, setNewPlaceKind] = useState("");
  const goHere = async (placeId: string) => {
    try {
      const res = await goTo.mutateAsync(placeId);
      if (res?.chatId) openWorldChatById(res.chatId);
    } catch {
      toast.error(localizeUi("ui.panels.cityview.couldnTGoThere"));
    }
  };
  const addPlace = async () => {
    const name = newPlaceName.trim();
    if (!name) return;
    try {
      await createPlace.mutateAsync({ name, kind: newPlaceKind.trim() || undefined });
      setNewPlaceName("");
      setNewPlaceKind("");
      toast.success(localizeUi("ui.panels.cityview.value1IsOnTheMap", { value1: name }));
    } catch {
      toast.error(localizeUi("ui.panels.cityview.couldnTCreateThatPlace"));
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 size="1rem" className="animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }
  if (!city?.places.length && !city?.residents.length) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[0.7rem] leading-relaxed text-[var(--muted-foreground)]">
        {localizeUi("ui.panels.cityview.theCityIsEmptyAsCharactersGoPlacesThe")}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {/* Put yourself on the map: make a place of your own */}
      <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)]/60 px-2 py-1.5">
        <input
          value={newPlaceName}
          onChange={(e) => setNewPlaceName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addPlace()}
          placeholder={localizeUi("ui.panels.cityview.newPlaceName")}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
        />
        <input
          value={newPlaceKind}
          onChange={(e) => setNewPlaceKind(e.target.value)}
          placeholder={localizeUi("ui.panels.cityview.kind")}
          className="w-16 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
        />
        <button
          type="button"
          disabled={!newPlaceName.trim() || createPlace.isPending}
          onClick={() => void addPlace()}
          className="rounded-md bg-[var(--primary)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {localizeUi("ui.panels.appearancesettings.add")}
        </button>
      </div>
      {city.places.map((place) => {
        const here = [...(city.peopleByPlace[place.id] ?? [])];
        const youAreHere = city.userPlaceId === place.id;
        return (
          <div key={place.id} className="relative">
            <button
              type="button"
              onClick={() => (youAreHere ? void goTo.mutateAsync(null) : void goHere(place.id))}
              disabled={goTo.isPending}
              title={
                youAreHere
                  ? localizeUi("ui.panels.cityview.leaveThisPlace")
                  : localizeUi("ui.panels.cityview.goHerePeopleWillNoticeYouArrive")
              }
              className={cn(
                "absolute right-1.5 top-1.5 z-10 rounded-md border px-1.5 py-0.5 text-[0.6rem] font-semibold",
                youAreHere
                  ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-400"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/60",
              )}
            >
              {youAreHere ? localizeUi("ui.panels.cityview.youReHereLeave") : localizeUi("ui.panels.cityview.go")}
            </button>
            <button
              type="button"
              disabled={!place.sceneChatId}
              onClick={() => place.sceneChatId && openWorldChatById(place.sceneChatId)}
              className={cn(
                "block w-full rounded-lg border border-[var(--border)]/50 bg-[var(--card)]/50 px-2.5 py-2 text-left",
                place.sceneChatId && "transition-colors hover:border-[var(--primary)]/50 hover:bg-[var(--accent)]/30",
              )}
              title={
                place.sceneChatId
                  ? localizeUi("ui.panels.cityview.openThisPlaceSScene")
                  : place.description || place.name
              }
            >
              <div className="flex items-center gap-1.5">
                {place.ownerId ? (
                  <Building2 size="0.75rem" className="shrink-0 text-indigo-400" />
                ) : (
                  <MapPin size="0.75rem" className="shrink-0 text-teal-400" />
                )}
                <span className="text-xs font-medium">{place.name}</span>
                <span className="text-[0.6rem] text-[var(--muted-foreground)]">
                  {place.ownerId ? localizeUi("ui.panels.cityview.home") : place.kind}
                </span>
                {place.detail > 0 ? (
                  <span className="ml-auto text-[0.55rem] text-[var(--muted-foreground)]">
                    {localizeUi("ui.panels.cityview.detail")} {place.detail}
                  </span>
                ) : null}
              </div>
              {place.description ? (
                <p className="mt-1 text-[0.68rem] leading-snug text-[var(--muted-foreground)]">{place.description}</p>
              ) : null}
              {place.tags.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {place.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[0.55rem] text-[var(--muted-foreground)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {here.length || youAreHere ? (
                <div className="mt-1 flex items-center gap-1 text-[0.65rem] text-emerald-400">
                  <UsersRound size="0.65rem" /> {[...here, ...(youAreHere ? ["You"] : [])].join(", ")}
                </div>
              ) : null}
            </button>
          </div>
        );
      })}

      {city.residents.length ? (
        <div className="mt-2 rounded-lg border border-[var(--border)]/50 bg-[var(--card)]/40 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {localizeUi("ui.panels.cityview.residents")}
            </span>
            <span className="text-[0.55rem] text-[var(--muted-foreground)]">
              {selected.size > 0
                ? localizeUi("ui.agents.regexscripteditor.value1Selected", { value1: selected.size })
                : localizeUi("ui.panels.cityview.tapToMessage")}
            </span>
          </div>
          <div className="mt-1 space-y-0.5">
            {city.residents.map((resident) => {
              const isSel = selected.has(resident.characterId);
              return (
                <button
                  key={resident.characterId}
                  type="button"
                  onClick={() => toggleResident(resident.characterId)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[0.68rem] transition-colors",
                    isSel ? "bg-[var(--primary)]/15" : "hover:bg-[var(--accent)]/30",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3 w-3 shrink-0 items-center justify-center rounded-full border text-[0.5rem] leading-none",
                      isSel
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border-[var(--border)]",
                    )}
                  >
                    {isSel ? "✓" : ""}
                  </span>
                  <span className="font-medium">{resident.name}</span>
                  {resident.job ? (
                    <span className="truncate text-[var(--muted-foreground)]">· {resident.job}</span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-1.5 text-[var(--muted-foreground)]">
                    <span title={localizeUi("ui.panels.cityview.energy")}>⚡{resident.needs.energy}</span>
                    <span title={localizeUi("ui.panels.cityview.hunger")}>🍽{resident.needs.hunger}</span>
                    <span title={localizeUi("ui.panels.cityview.social")}>💬{resident.needs.social}</span>
                    <span className="flex items-center gap-0.5">
                      <Coins size="0.6rem" /> {resident.money}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {selected.size > 0 ? (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                disabled={startingChat}
                onClick={() => void startChatWithSelected()}
                className="flex-1 rounded-md bg-[var(--primary)] px-2 py-1 text-[0.65rem] font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {startingChat
                  ? localizeUi("ui.panels.cityview.opening")
                  : selected.size === 1
                    ? localizeUi("ui.panels.cityview.messageValue1", {
                        value1: city.residents.find((r) => selected.has(r.characterId))?.name ?? "",
                      })
                    : localizeUi("ui.panels.cityview.startGroupValue1", { value1: selected.size })}
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-[0.65rem] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
              >
                {localizeUi("lorebook.editor.batch.clear")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {homeless.length && city.places.length ? (
        <p className="px-1 text-[0.6rem] text-[var(--muted-foreground)]">
          {homeless.map((r) => r.name).join(", ")}{" "}
          {homeless.length === 1 ? localizeUi("ui.panels.cityview.is") : localizeUi("ui.panels.cityview.are")}{" "}
          {localizeUi("ui.panels.cityview.homeNotOutRightNow")}
        </p>
      ) : null}
    </div>
  );
}

// ── Panel ──

export function WorldPanel() {
  const { t: localizeUi } = useUiTranslation();
  const { data: status } = useWorldStatus();
  const runTick = useRunWorldTick();
  const [tab, setTab] = useState<"timeline" | "map" | "city" | "bonds">("timeline");
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
        if (result.executedNow > 0)
          parts.push(`${result.executedNow} action${result.executedNow === 1 ? "" : "s"} happened`);
        const headline = result.narration
          ? result.narration.length > 90
            ? `${result.narration.slice(0, 89)}…`
            : result.narration
          : "The world moved";
        toast.success(
          parts.length
            ? localizeUi("ui.panels.ttsconfigcard.value1Value2", { value1: headline, value2: parts.join(", ") })
            : headline,
        );
      } else {
        toast.info(result.skippedReason ?? localizeUi("ui.panels.worldpanel.nothingToDoRightNow"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : localizeUi("ui.panels.worldpanel.worldAdvanceFailed"));
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
            {status?.config.enabled
              ? localizeUi("ui.panels.worldpanel.worldIsLive")
              : localizeUi("ui.panels.worldpanel.worldIsPaused")}
          </span>
          <span className="text-[0.65rem] text-[var(--muted-foreground)]">
            {status?.provider.ok ? status.provider.label : localizeUi("ui.panels.worldpanel.noConnection")}
          </span>
        </div>
        {status?.atmosphere?.summary ? (
          <p className="text-[0.68rem] leading-snug text-[var(--foreground)]/80">🌤 {status.atmosphere.summary}</p>
        ) : null}
        {status?.state.lastNarration ? (
          <p className="text-[0.7rem] italic leading-snug text-[var(--muted-foreground)]">
            “{status.state.lastNarration}”
          </p>
        ) : null}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.65rem] text-[var(--muted-foreground)]">
          {status?.config.mode === "minds" ? (
            <span>
              {status.minds.count} {localizeUi("ui.panels.worldpanel.mind")}
              {status.minds.count === 1 ? "" : localizeUi("ui.noodle.stageprofileview.s")}
              {status.minds.nextWakeAt
                ? localizeUi("ui.panels.worldpanel.nextCheckInValue1", {
                    value1: relativeTime(status.minds.nextWakeAt),
                  })
                : ""}
            </span>
          ) : (
            <span>
              {status?.timeline.count ?? 0} {localizeUi("ui.panels.worldpanel.moment")}
              {(status?.timeline.count ?? 0) === 1 ? "" : localizeUi("ui.noodle.stageprofileview.s")}{" "}
              {localizeUi("ui.panels.worldpanel.queued")}
              {status?.timeline.nextRunAt
                ? localizeUi("ui.panels.worldpanel.nextValue1", { value1: relativeTime(status.timeline.nextRunAt) })
                : ""}
            </span>
          )}
          <span>
            {localizeUi("ui.panels.worldpanel.today")} {status?.state.dailyCount ?? 0}/
            {(status?.config.dailyActionCap ?? 0) > 0 ? status!.config.dailyActionCap : "∞"}
          </span>
          {status?.state.lastError ? (
            <span className="text-rose-400">
              {localizeUi("ui.panels.worldpanel.lastError")} {status.state.lastError}
            </span>
          ) : null}
        </div>
        <div className="flex gap-1.5 pt-0.5">
          <button
            type="button"
            disabled={runTick.isPending || !status?.provider.ok}
            onClick={() => void advance()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-40"
            title={
              status?.provider.ok
                ? localizeUi("ui.panels.worldpanel.planAndStartTheNextStretchOfWorldTime")
                : localizeUi("ui.panels.worldpanel.configureAConnectionFirst")
            }
          >
            {runTick.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <Play size="0.75rem" />}
            {localizeUi("ui.panels.worldpanel.advanceTheWorld")}
          </button>
          <button
            type="button"
            onClick={() => setConfigOpen((prev) => !prev)}
            className={cn(
              "rounded-md border border-[var(--border)] px-2.5 py-1.5 transition-colors hover:bg-[var(--accent)]/40",
              showConfig && "border-[var(--primary)]/60 bg-[var(--primary)]/10",
            )}
            title={localizeUi("ui.panels.worldpanel.worldSettings")}
            aria-label={localizeUi("ui.panels.worldpanel.worldSettings")}
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
            ["map", "Map"],
            ["city", "City"],
            ["bonds", "Bonds"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              tab === key
                ? "bg-[var(--card)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "map" ? (
        <CityMap />
      ) : tab === "city" ? (
        <CityView />
      ) : tab === "timeline" ? (
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
              aria-label={localizeUi("ui.panels.worldpanel.filterTimelineByCharacter")}
            >
              <option value="">{localizeUi("ui.panels.worldpanel.everyone")}</option>
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
              {localizeUi("ui.panels.worldpanel.nothingHasHappenedYetEnableTheWorldOrTap")}
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
              {localizeUi("ui.panels.worldpanel.nobodyHasReallyMetAnybodyYetBondsFormOn")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
