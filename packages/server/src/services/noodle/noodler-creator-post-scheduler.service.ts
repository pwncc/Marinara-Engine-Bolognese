import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";
import { createNoodlerProjectsStorage } from "../storage/noodler-projects.storage.js";
import {
  dueNoodleRefreshTimes,
  markNoodleRefreshAttempt,
  markNoodleRefreshFailure,
  markNoodleRefreshSuccess,
} from "./noodle-refresh-schedule.js";
import { isNoodleRefreshLocked } from "./noodle-refresh-lock.js";
import { eligibleNoodlerCreatorAccounts, selectNoodlerCreator } from "./noodler-creator-selection.js";

const POLL_MS = 60_000;
const INITIAL_DELAY_MS = 35_000;

function retryDelay(statusCode: number, attempts: number): number {
  if (statusCode === 409) return 60_000;
  if (statusCode === 429) return 15 * 60_000;
  return Math.min(60 * 60_000, Math.max(5 * 60_000, 5 * 60_000 * 2 ** Math.min(attempts, 3)));
}

export function startNoodlerCreatorPostScheduler(app: FastifyInstance) {
  const noodle = createNoodleStorage(app.db);
  const projects = createNoodlerProjectsStorage(app.db);
  let stopped = false;
  let polling = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void poll(), Math.max(1_000, delayMs));
    timer.unref?.();
  };

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const now = new Date();
      const settings = await noodle.getSettings();
      const schedule = await noodle.ensureNoodlerCreatorPostSchedule(now, settings);
      if (!settings.enableNoodler || !settings.noodler.creatorPosts.enabled || schedule.refreshesPerDay === 0) return;
      if (schedule.nextAttemptAt && Date.parse(schedule.nextAttemptAt) > now.getTime()) return;
      const dueTimes = dueNoodleRefreshTimes(schedule, now);
      if (dueTimes.length === 0) return;
      const eligibleAccounts = eligibleNoodlerCreatorAccounts(
        (await noodle.listPrivateAccounts()).filter((candidate) => !isNoodleRefreshLocked(candidate.id)),
      );
      const projectWork = (
        await Promise.all(
          eligibleAccounts.map(async (candidate) => ({
            account: candidate,
            work: await projects.automaticMilestone(candidate.id, now),
          })),
        )
      )
        .filter((item) => item.work !== null)
        .sort((left, right) => {
          const leftDue = left.work!.milestone.dueAt ? Date.parse(left.work!.milestone.dueAt) : 0;
          const rightDue = right.work!.milestone.dueAt ? Date.parse(right.work!.milestone.dueAt) : 0;
          return leftDue - rightDue;
        })[0];
      const account = projectWork?.account ?? selectNoodlerCreator(eligibleAccounts);
      if (!account) return;
      await noodle.saveNoodlerCreatorPostSchedule(markNoodleRefreshAttempt(schedule, now));
      const connectionId = settings.noodler.creatorPosts.generationConnectionId ?? settings.generationConnectionId;
      const activeProjectWork = projectWork?.account.id === account.id ? projectWork.work : null;
      const response = await app.inject({
        method: "POST",
        url: activeProjectWork
          ? `/api/noodle/projects/${activeProjectWork.project.id}/generate-next`
          : "/api/noodle/refresh",
        payload: activeProjectWork
          ? { milestoneId: activeProjectWork.milestone.id, ...(connectionId ? { connectionId } : {}) }
          : { targetAccountId: account.id, ...(connectionId ? { connectionId } : {}) },
      });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        await noodle.saveNoodlerCreatorPostSchedule(markNoodleRefreshSuccess(schedule, dueTimes, now));
        const currentAutoPost =
          account.settings.autoPost && typeof account.settings.autoPost === "object"
            ? (account.settings.autoPost as Record<string, unknown>)
            : {};
        await noodle.updateAccount(account.id, {
          settings: {
            ...account.settings,
            autoPost: { ...currentAutoPost, lastAutomaticPostAt: now.toISOString() },
          },
        });
        logger.info("[noodler-creator-post-scheduler] Posted automatically for %s", account.displayName);
      } else {
        if (schedule.failureAttempts >= 2) {
          const consumed = markNoodleRefreshSuccess(schedule, dueTimes, now);
          await noodle.saveNoodlerCreatorPostSchedule({
            ...consumed,
            successfulRefreshes: schedule.successfulRefreshes,
            lastError: response.body || `HTTP ${response.statusCode}`,
          });
        } else {
          await noodle.saveNoodlerCreatorPostSchedule(
            markNoodleRefreshFailure(
              schedule,
              response.body || `HTTP ${response.statusCode}`,
              now,
              retryDelay(response.statusCode, schedule.failureAttempts),
            ),
          );
        }
      }
    } catch (error) {
      logger.error(error, "[noodler-creator-post-scheduler] Poll failed");
    } finally {
      polling = false;
      scheduleNext(POLL_MS);
    }
  };

  scheduleNext(INITIAL_DELAY_MS);
  app.addHook("onClose", async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  });
  logger.info("[noodler-creator-post-scheduler] Scheduler started");
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
