import { useMemo, useState } from "react";
import { CalendarClock, MoreHorizontal, Pencil, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CONVERSATION_SCHEDULE_DAYS,
  type ConversationPresenceStatus,
  type WeekSchedule,
} from "@marinara-engine/shared";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { cn } from "../../lib/utils";

type OpenSettingsOptions = { initialSection?: "autonomous" | null };

type ConversationPresenceScheduleSectionProps = {
  chatId: string;
  chatMeta: Record<string, any>;
  characterId: string;
  schedule?: WeekSchedule;
  schedulesEnabled: boolean;
  hasGeneratedSchedules: boolean;
  lastContactLabel?: string | null;
  onOpenScheduleEditor?: (characterId: string, options?: { initialDay?: string | null }) => void;
  onOpenSettings: (event?: React.MouseEvent<HTMLElement>, options?: OpenSettingsOptions) => void;
};

type UpcomingScheduleBlock = {
  day: string;
  dayOffset: number;
  blockIndex: number;
  time: string;
  activity: string;
  status: ConversationPresenceStatus;
  startsAt: number;
};

const STATUS_COLORS: Record<ConversationPresenceStatus, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-gray-400",
};

function statusLabel(status: ConversationPresenceStatus): string {
  return status === "offline" ? "Offline" : status === "dnd" ? "Busy" : status === "idle" ? "Away" : "Online";
}

function parseClock(value?: string): number | null {
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

function formatScheduleTimeRange(value: string) {
  const [start, end] = value.split("-");
  const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const formatPart = (part?: string) => {
    const minutes = parseClock(part);
    if (minutes == null) return part ?? "";
    const date = new Date();
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return formatter.format(date);
  };
  const formattedStart = formatPart(start);
  const formattedEnd = formatPart(end);
  return formattedStart && formattedEnd ? `${formattedStart} - ${formattedEnd}` : value;
}

function getUpcomingScheduleBlocks(schedule?: WeekSchedule, limit = 4): UpcomingScheduleBlock[] {
  if (!schedule?.days) return [];
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const upcoming: UpcomingScheduleBlock[] = [];

  for (let dayOffset = 0; dayOffset < CONVERSATION_SCHEDULE_DAYS.length; dayOffset += 1) {
    const dayIndex = (todayIndex + dayOffset) % CONVERSATION_SCHEDULE_DAYS.length;
    const day = CONVERSATION_SCHEDULE_DAYS[dayIndex]!;
    const blocks = schedule.days[day] ?? [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex]!;
      const start = parseClock(block.time?.split("-")[0]);
      if (start == null) continue;
      if (dayOffset === 0 && start <= currentMinutes) continue;
      upcoming.push({
        day,
        dayOffset,
        blockIndex,
        time: block.time,
        activity: block.activity || statusLabel(block.status),
        status: block.status,
        startsAt: dayOffset * 1440 + start,
      });
    }
  }

  return upcoming.sort((left, right) => left.startsAt - right.startsAt).slice(0, limit);
}

function getScheduledDayCount(schedule?: WeekSchedule): number {
  if (!schedule?.days) return 0;
  return CONVERSATION_SCHEDULE_DAYS.filter((day) => (schedule.days[day] ?? []).length > 0).length;
}

function getSummaryText(schedulesEnabled: boolean, hasGeneratedSchedules: boolean, schedule?: WeekSchedule): string {
  const dayCount = getScheduledDayCount(schedule);
  if (!schedulesEnabled && !hasGeneratedSchedules) return "Autonomous scheduling is off and no schedule has been generated yet.";
  if (!schedulesEnabled) return "Autonomous scheduling is off.";
  if (!hasGeneratedSchedules || !schedule) return "Autonomous scheduling is on, but no schedule has been generated yet.";
  if (dayCount > 0) return `${dayCount} day${dayCount === 1 ? "" : "s"} scheduled`;
  return "Schedule exists, but nothing is upcoming yet.";
}

function dayLabel(block: UpcomingScheduleBlock): string {
  if (block.dayOffset === 0) return "Today";
  if (block.dayOffset === 1) return "Tomorrow";
  return block.day;
}

export function ConversationPresenceScheduleSection({
  chatId,
  chatMeta,
  characterId,
  schedule,
  schedulesEnabled,
  hasGeneratedSchedules,
  lastContactLabel,
  onOpenScheduleEditor,
  onOpenSettings,
}: ConversationPresenceScheduleSectionProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const updateMeta = useUpdateChatMetadata();
  const dayCount = getScheduledDayCount(schedule);
  const upcomingBlocks = useMemo(() => getUpcomingScheduleBlocks(schedule), [schedule]);
  const badge = schedulesEnabled ? (schedule ? "Active" : "Ready") : "Off";
  const summary = getSummaryText(schedulesEnabled, hasGeneratedSchedules, schedule);

  const openEditor = (day?: string | null) => {
    if (!onOpenScheduleEditor) return;
    onOpenScheduleEditor(characterId, { initialDay: day ?? null });
  };

  const toggleSchedules = () => {
    updateMeta.mutate({ id: chatId, conversationSchedulesEnabled: !schedulesEnabled });
    setMenuOpen(false);
  };

  const removeBlock = async (block: UpcomingScheduleBlock) => {
    if (!schedule) return;
    const currentSchedules = (chatMeta.characterSchedules as Record<string, WeekSchedule> | undefined) ?? {};
    const dayBlocks = schedule.days?.[block.day] ?? [];
    const nextDayBlocks = dayBlocks.filter((_, index) => index !== block.blockIndex);
    try {
      await updateMeta.mutateAsync({
        id: chatId,
        characterSchedules: {
          ...currentSchedules,
          [characterId]: {
            ...schedule,
            days: {
              ...schedule.days,
              [block.day]: nextDayBlocks,
            },
          },
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove schedule block");
    }
  };

  return (
    <div className="mt-2 rounded-lg bg-[var(--background)]/35 px-2.5 py-2 ring-1 ring-[var(--border)]/70">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[0.625rem] font-semibold text-[var(--foreground)]/82">
            <CalendarClock size="0.6875rem" />
            <span>Schedule</span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[0.5625rem] font-medium ring-1",
                schedulesEnabled
                  ? "bg-green-500/10 text-green-500 ring-green-500/25"
                  : "bg-[var(--foreground)]/6 text-[var(--muted-foreground)] ring-[var(--border)]",
              )}
            >
              {badge}
            </span>
          </div>
          <div className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
            {dayCount > 0 ? `${dayCount} day${dayCount === 1 ? "" : "s"} scheduled` : "No schedule"}
          </div>
          <p className="mt-0.5 text-[0.625rem] leading-4 text-[var(--muted-foreground)]/82">{summary}</p>
          {lastContactLabel && (
            <p className="mt-0.5 text-[0.5625rem] text-[var(--muted-foreground)]/70">Last contact {lastContactLabel}</p>
          )}
        </div>

        <div className="relative flex shrink-0 items-center gap-1">
          {onOpenScheduleEditor && (
            <button
              type="button"
              onClick={() => openEditor()}
              className="rounded-md bg-[var(--foreground)]/8 px-2 py-1 text-[0.625rem] font-medium text-[var(--foreground)]/78 ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--foreground)]/12"
            >
              {schedule ? "Edit schedule" : "Create schedule"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Schedule options"
          >
            <MoreHorizontal size="0.8125rem" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-10 w-48 rounded-lg border border-[var(--border)] bg-[var(--popover)] p-1 text-[var(--popover-foreground)] shadow-xl">
              {onOpenScheduleEditor && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    openEditor();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.6875rem] hover:bg-[var(--accent)]"
                >
                  <Pencil size="0.75rem" /> Edit full schedule
                </button>
              )}
              <button
                type="button"
                onClick={toggleSchedules}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.6875rem] hover:bg-[var(--accent)]"
              >
                <CalendarClock size="0.75rem" /> {schedulesEnabled ? "Disable autonomous schedules" : "Enable autonomous schedules"}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  setMenuOpen(false);
                  onOpenSettings(event, { initialSection: "autonomous" });
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.6875rem] hover:bg-[var(--accent)]"
              >
                <Settings2 size="0.75rem" /> Open autonomous settings
              </button>
            </div>
          )}
        </div>
      </div>

      {upcomingBlocks.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {upcomingBlocks.map((block) => (
            <div
              key={`${block.day}-${block.blockIndex}-${block.time}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md bg-[var(--foreground)]/[0.035] px-2 py-1.5 transition-colors hover:bg-[var(--accent)]/20"
            >
              <button
                type="button"
                onClick={() => openEditor(block.day)}
                className="grid min-w-0 grid-cols-[auto_4.75rem_minmax(0,1fr)] items-center gap-2 text-left"
              >
                <span className={cn("h-2 w-2 rounded-full", STATUS_COLORS[block.status])} />
                <span className="text-[0.5625rem] font-medium text-[var(--muted-foreground)]">{dayLabel(block)}</span>
                <span className="min-w-0 text-[0.625rem] text-[var(--muted-foreground)]/86">
                  <span className="tabular-nums">{formatScheduleTimeRange(block.time)}</span>
                  {" · "}
                  <span className="break-words">{block.activity}</span>
                </span>
              </button>
              <span className="flex items-center gap-0.5">
                {onOpenScheduleEditor && (
                  <button
                    type="button"
                    onClick={() => openEditor(block.day)}
                    className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Edit this day"
                  >
                    <Pencil size="0.6875rem" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void removeBlock(block)}
                  className="flex h-6 w-6 items-center justify-center rounded text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                  title="Delete this block"
                >
                  <Trash2 size="0.6875rem" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
