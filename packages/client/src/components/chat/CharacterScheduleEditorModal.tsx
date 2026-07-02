import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import {
  CONVERSATION_SCHEDULE_DAYS,
  type ConversationPresenceStatus,
  type ScheduleBlock,
  type WeekSchedule,
} from "@marinara-engine/shared";
import { Modal } from "../ui/Modal";
import { cn } from "../../lib/utils";

type CharacterScheduleEditorModalProps = {
  open: boolean;
  characterId: string;
  characterName: string;
  schedule?: WeekSchedule;
  initialDay?: string | null;
  onClose: () => void;
  onSave: (characterId: string, schedule: WeekSchedule) => void;
};

type DraftSchedule = {
  days: Record<string, ScheduleBlock[]>;
  inactivityThresholdMinutes: string;
  idleResponseDelayMinutes: string;
  dndResponseDelayMinutes: string;
  autonomousDailyCapOverride: string;
  weekStart: string;
  talkativeness: number;
};

const STATUS_OPTIONS: Array<{ value: ConversationPresenceStatus; label: string; className: string }> = [
  { value: "online", label: "Online", className: "bg-green-500" },
  { value: "idle", label: "Away", className: "bg-yellow-500" },
  { value: "dnd", label: "Busy", className: "bg-red-500" },
  { value: "offline", label: "Offline", className: "bg-gray-400" },
];

const STATUS_COLORS: Record<ConversationPresenceStatus, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-gray-400",
};

const STATUS_LABELS: Record<ConversationPresenceStatus, string> = {
  online: "Online",
  idle: "Away",
  dnd: "Busy",
  offline: "Offline",
};

function getCurrentMondayIso(): string {
  const date = new Date();
  const diff = date.getDate() - date.getDay() + (date.getDay() === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function cloneDays(schedule?: WeekSchedule): Record<string, ScheduleBlock[]> {
  const days: Record<string, ScheduleBlock[]> = {};
  for (const day of CONVERSATION_SCHEDULE_DAYS) {
    days[day] = (schedule?.days?.[day] ?? []).map((block) => ({
      time: block.time ?? "",
      activity: block.activity ?? "",
      status: block.status ?? "online",
    }));
  }
  return days;
}

function createDraft(schedule?: WeekSchedule): DraftSchedule {
  return {
    days: cloneDays(schedule),
    inactivityThresholdMinutes: String(schedule?.inactivityThresholdMinutes ?? 120),
    idleResponseDelayMinutes:
      typeof schedule?.idleResponseDelayMinutes === "number" ? String(schedule.idleResponseDelayMinutes) : "",
    dndResponseDelayMinutes:
      typeof schedule?.dndResponseDelayMinutes === "number" ? String(schedule.dndResponseDelayMinutes) : "",
    autonomousDailyCapOverride:
      typeof schedule?.autonomousDailyCapOverride === "number" ? String(schedule.autonomousDailyCapOverride) : "",
    weekStart: schedule?.weekStart ?? getCurrentMondayIso(),
    talkativeness: schedule?.talkativeness ?? 50,
  };
}

function parseNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseOptionalNumber(value: string, min: number, max: number): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, parsed));
}

function parseOptionalCap(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

function parseClock(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
}

function parseTimeRange(value: string): { start: number; end: number } | null {
  const [startRaw, endRaw] = value.split("-");
  const start = parseClock(startRaw);
  const end = parseClock(endRaw);
  if (start == null || end == null || start === end) return null;
  return { start, end: end === 0 ? 1440 : end };
}

function blockSegments(block: ScheduleBlock): Array<{ left: number; width: number; status: ConversationPresenceStatus }> {
  const range = parseTimeRange(block.time);
  if (!range) return [];
  const status = block.status ?? "online";
  const toSegment = (start: number, end: number) => ({
    left: (start / 1440) * 100,
    width: Math.max(0.4, ((end - start) / 1440) * 100),
    status,
  });
  if (range.start > range.end) return [toSegment(range.start, 1440), toSegment(0, range.end)];
  return [toSegment(range.start, range.end)];
}

function countScheduledDays(days: Record<string, ScheduleBlock[]>): number {
  return CONVERSATION_SCHEDULE_DAYS.filter((day) => (days[day] ?? []).length > 0).length;
}

function countBlocks(days: Record<string, ScheduleBlock[]>): number {
  return CONVERSATION_SCHEDULE_DAYS.reduce((total, day) => total + (days[day] ?? []).length, 0);
}

function ScheduleTimeline({ day, blocks }: { day: string; blocks: ScheduleBlock[] }) {
  const now = new Date();
  const todayName = CONVERSATION_SCHEDULE_DAYS[(now.getDay() + 6) % 7];
  const nowLeft = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;

  return (
    <div className="space-y-1.5">
      <div className="relative h-10 overflow-hidden rounded-md bg-[var(--background)] ring-1 ring-[var(--border)]">
        {[0, 6, 12, 18, 24].map((hour) => (
          <div key={hour} className="absolute inset-y-0 w-px bg-[var(--border)]/70" style={{ left: `${(hour / 24) * 100}%` }} />
        ))}
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} className="absolute inset-y-2 w-px bg-[var(--border)]/25" style={{ left: `${(hour / 24) * 100}%` }} />
        ))}
        {blocks.flatMap((block, index) =>
          blockSegments(block).map((segment, segmentIndex) => (
            <div
              key={`${index}-${segmentIndex}`}
              className={cn("absolute top-2 h-6 rounded-sm opacity-80 ring-1 ring-black/10", STATUS_COLORS[segment.status])}
              style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
              title={`${block.time} ${block.activity || STATUS_LABELS[segment.status]}`}
            />
          )),
        )}
        {day === todayName && <div className="absolute inset-y-1 w-0.5 bg-[var(--primary)]" style={{ left: `${nowLeft}%` }} />}
      </div>
      <div className="grid grid-cols-5 text-[0.5625rem] tabular-nums text-[var(--muted-foreground)]/70">
        <span>00</span>
        <span className="text-center">06</span>
        <span className="text-center">12</span>
        <span className="text-center">18</span>
        <span className="text-right">24</span>
      </div>
    </div>
  );
}

export function CharacterScheduleEditorModal({
  open,
  characterId,
  characterName,
  schedule,
  initialDay,
  onClose,
  onSave,
}: CharacterScheduleEditorModalProps) {
  const [draft, setDraft] = useState<DraftSchedule>(() => createDraft(schedule));
  const [expandedDay, setExpandedDay] = useState<string | null>(initialDay ?? CONVERSATION_SCHEDULE_DAYS[0] ?? null);

  useEffect(() => {
    if (!open) return;
    setDraft(createDraft(schedule));
    setExpandedDay(initialDay && CONVERSATION_SCHEDULE_DAYS.includes(initialDay) ? initialDay : CONVERSATION_SCHEDULE_DAYS[0] ?? null);
  }, [characterId, initialDay, open, schedule]);

  const scheduledDays = useMemo(() => countScheduledDays(draft.days), [draft.days]);
  const totalBlocks = useMemo(() => countBlocks(draft.days), [draft.days]);

  const updateSetting = (field: keyof Omit<DraftSchedule, "days" | "weekStart" | "talkativeness">, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const updateBlock = (day: string, index: number, patch: Partial<ScheduleBlock>) => {
    setDraft((current) => {
      const blocks = [...(current.days[day] ?? [])];
      blocks[index] = { ...blocks[index]!, ...patch };
      return { ...current, days: { ...current.days, [day]: blocks } };
    });
  };

  const addBlock = (day: string) => {
    setDraft((current) => ({
      ...current,
      days: {
        ...current.days,
        [day]: [...(current.days[day] ?? []), { time: "09:00-10:00", activity: "Free time", status: "online" }],
      },
    }));
    setExpandedDay(day);
  };

  const removeBlock = (day: string, index: number) => {
    setDraft((current) => ({
      ...current,
      days: { ...current.days, [day]: (current.days[day] ?? []).filter((_, blockIndex) => blockIndex !== index) },
    }));
  };

  const save = () => {
    const next: WeekSchedule = {
      weekStart: draft.weekStart,
      days: draft.days,
      inactivityThresholdMinutes: parseNumber(draft.inactivityThresholdMinutes, schedule?.inactivityThresholdMinutes ?? 120, 15, 360),
      talkativeness: Math.max(0, Math.min(100, draft.talkativeness)),
    };
    const idleDelay = parseOptionalNumber(draft.idleResponseDelayMinutes, 0, 120);
    const dndDelay = parseOptionalNumber(draft.dndResponseDelayMinutes, 0, 120);
    if (idleDelay !== undefined) next.idleResponseDelayMinutes = idleDelay;
    if (dndDelay !== undefined) next.dndResponseDelayMinutes = dndDelay;
    next.autonomousDailyCapOverride = parseOptionalCap(draft.autonomousDailyCapOverride);
    onSave(characterId, next);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${characterName} Schedule`} width="max-w-5xl" chatFloatingPanel>
      <div className="space-y-4">
        <div className="grid gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 ring-1 ring-[var(--border)]">
            <div className="text-[0.625rem] text-[var(--muted-foreground)]">Scheduled days</div>
            <div className="mt-1 text-base font-semibold">{scheduledDays}</div>
          </div>
          <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 ring-1 ring-[var(--border)]">
            <div className="text-[0.625rem] text-[var(--muted-foreground)]">Routine blocks</div>
            <div className="mt-1 text-base font-semibold">{totalBlocks}</div>
          </div>
          <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 ring-1 ring-[var(--border)]">
            <div className="text-[0.625rem] text-[var(--muted-foreground)]">Character cap</div>
            <div className="mt-1 text-base font-semibold">{draft.autonomousDailyCapOverride || "Default"}</div>
          </div>
          <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 ring-1 ring-[var(--border)]">
            <div className="text-[0.625rem] text-[var(--muted-foreground)]">Follow-up threshold</div>
            <div className="mt-1 text-base font-semibold">{draft.inactivityThresholdMinutes || 120}m</div>
          </div>
        </div>

        <div className="rounded-lg bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)]">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CalendarDays size="0.875rem" /> Global settings
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1.5 text-xs">
              <span className="font-medium">Inactivity Threshold</span>
              <input
                type="number"
                min={15}
                max={360}
                step={5}
                value={draft.inactivityThresholdMinutes}
                onChange={(event) => updateSetting("inactivityThresholdMinutes", event.target.value)}
                className="w-full rounded-md bg-[var(--background)] px-3 py-2 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]/50"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="font-medium">Idle Delay</span>
              <input
                type="number"
                min={0}
                max={120}
                step={1}
                value={draft.idleResponseDelayMinutes}
                placeholder="Default"
                onChange={(event) => updateSetting("idleResponseDelayMinutes", event.target.value)}
                className="w-full rounded-md bg-[var(--background)] px-3 py-2 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]/50"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="font-medium">DND Delay</span>
              <input
                type="number"
                min={0}
                max={120}
                step={1}
                value={draft.dndResponseDelayMinutes}
                placeholder="Default"
                onChange={(event) => updateSetting("dndResponseDelayMinutes", event.target.value)}
                className="w-full rounded-md bg-[var(--background)] px-3 py-2 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]/50"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="font-medium">Character Check-In Cap</span>
              <select
                value={draft.autonomousDailyCapOverride}
                onChange={(event) => updateSetting("autonomousDailyCapOverride", event.target.value)}
                className="w-full rounded-md bg-[var(--background)] px-3 py-2 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]/50"
              >
                <option value="">Default</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((cap) => (
                  <option key={cap} value={cap}>
                    {cap} / day
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          {CONVERSATION_SCHEDULE_DAYS.map((day) => {
            const blocks = draft.days[day] ?? [];
            const expanded = expandedDay === day;
            return (
              <section key={day} className="rounded-lg bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setExpandedDay(expanded ? null : day)}
                  className="grid w-full gap-3 text-left md:grid-cols-[8rem_minmax(0,1fr)_5rem] md:items-center"
                >
                  <div>
                    <div className="text-sm font-semibold">{day}</div>
                    <div className="text-[0.625rem] text-[var(--muted-foreground)]">
                      {blocks.length} block{blocks.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <ScheduleTimeline day={day} blocks={blocks} />
                  <span className="text-right text-[0.6875rem] font-medium text-[var(--muted-foreground)] max-md:text-left">
                    {expanded ? "Close" : "Edit"}
                  </span>
                </button>

                {expanded && (
                  <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                    {blocks.length === 0 && <p className="text-xs text-[var(--muted-foreground)]">No blocks scheduled for this day.</p>}
                    {blocks.map((block, index) => (
                      <div key={index} className="grid gap-2 rounded-md bg-[var(--background)] p-2 ring-1 ring-[var(--border)] md:grid-cols-[9rem_minmax(8rem,12rem)_minmax(0,1fr)_2.5rem]">
                        <label className="space-y-1 text-xs">
                          <span className="font-medium">Status</span>
                          <select
                            value={block.status}
                            onChange={(event) => updateBlock(day, index, { status: event.target.value as ConversationPresenceStatus })}
                            className="w-full rounded-md bg-[var(--secondary)] px-2 py-2 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]/50"
                          >
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 text-xs">
                          <span className="font-medium">Time Range</span>
                          <input
                            value={block.time}
                            onChange={(event) => updateBlock(day, index, { time: event.target.value })}
                            placeholder="09:00-11:30"
                            className="w-full rounded-md bg-[var(--secondary)] px-2 py-2 font-mono text-xs outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]/50"
                          />
                        </label>
                        <label className="space-y-1 text-xs">
                          <span className="font-medium">Activity</span>
                          <input
                            value={block.activity}
                            onChange={(event) => updateBlock(day, index, { activity: event.target.value })}
                            placeholder="Activity"
                            className="w-full rounded-md bg-[var(--secondary)] px-2 py-2 outline-none ring-1 ring-[var(--border)] focus:ring-[var(--primary)]/50"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeBlock(day, index)}
                          className="flex h-10 w-10 items-center justify-center self-end rounded-md text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10"
                          title="Remove block"
                        >
                          <Trash2 size="0.875rem" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addBlock(day)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                    >
                      <Plus size="0.75rem" /> Add block
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            Save schedule
          </button>
        </div>
      </div>
    </Modal>
  );
}
