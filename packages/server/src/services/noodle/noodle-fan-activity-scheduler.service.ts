// ──────────────────────────────────────────────
// Automatic scheduler for NoodleR fan activity.
//
// Deliberately separate from noodle-refresh-scheduler.service.ts: own timer,
// own poll loop, own persisted state (per-account nextRunAt inside
// noodleAccounts.settings.fanActivity, not the public timeline's schedule
// table). Gated by two independent switches — the global
// settings.noodler.enableFanActivityScheduler kill switch, and each account's own
// fanActivity.autoSchedule — so turning one off never depends on the other,
// and a failure or slowdown here can never delay the public refresh
// scheduler (separate lock scope key: the account id, same scope guided
// single-account generation and the manual "Simulate fan activity now"
// trigger already use).
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { createNoodleStorage } from "../storage/noodle.storage.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { parseAutoPostSettings, parseFanActivitySettings, simulateNoodlerFanActivity } from "../../routes/noodle.routes.js";
import { isNoodleRefreshLocked, withNoodleRefreshLock } from "./noodle-refresh-lock.js";
import type { NoodleAccount, NoodleAccountSubscription, NoodleFanActivityIntensity } from "@marinara-engine/shared";

const NOODLE_FAN_ACTIVITY_SCHEDULER_POLL_MS = 60_000;
const NOODLE_FAN_ACTIVITY_SCHEDULER_INITIAL_DELAY_MS = 30_000;
const NOODLE_FAN_ACTIVITY_JITTER_RATIO = 0.2;

// Ceiling on unattended runs/day per intensity dial. Distinct from the
// per-run action cap in noodle.routes.ts — this bounds "how often it runs
// unattended," that bounds "how much happens per run."
const NOODLE_FAN_ACTIVITY_RUNS_PER_DAY: Record<NoodleFanActivityIntensity, number> = {
  low: 1,
  medium: 3,
  high: 6,
};

function jitteredIntervalMs(intensity: NoodleFanActivityIntensity): number {
  const runsPerDay = NOODLE_FAN_ACTIVITY_RUNS_PER_DAY[intensity];
  const baseMs = (24 * 60 * 60 * 1000) / runsPerDay;
  const jitter = baseMs * NOODLE_FAN_ACTIVITY_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(60_000, baseMs + jitter);
}

export function startNoodleFanActivityScheduler(app: FastifyInstance) {
  const noodle = createNoodleStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const characters = createCharactersStorage(app.db);
  let stopped = false;
  let polling = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void poll();
    }, Math.max(1_000, delayMs));
    timer.unref?.();
  };

  const persistFanActivitySettings = async (account: NoodleAccount, nextRunAt: string | null) => {
    const current = parseFanActivitySettings(account);
    await noodle.updateAccount(account.id, {
      settings: {
        ...account.settings,
        fanActivity: { ...current, nextRunAt },
      },
    });
  };

  const persistAutoPostSettings = async (account: NoodleAccount, nextRunAt: string | null) => {
    const current = parseAutoPostSettings(account);
    await noodle.updateAccount(account.id, {
      settings: {
        ...account.settings,
        autoPost: { ...current, nextRunAt },
      },
    });
  };

  // Reuses the manual "generate a post" UI's own route (targetAccountId),
  // rather than duplicating post-generation logic here — the route already
  // owns the per-account refresh lock, so we only need to skip cheaply when
  // it's already held (e.g. a manual generation is in flight).
  const runDueAutoPostAccount = async (account: NoodleAccount, autoPostSettings: ReturnType<typeof parseAutoPostSettings>) => {
    const nextRunAt = new Date(Date.now() + jitteredIntervalMs(autoPostSettings.intensity)).toISOString();
    if (isNoodleRefreshLocked(account.id)) {
      // Manual trigger or guided post in flight; don't burn this slot, try again next tick.
      return;
    }
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/noodle/refresh",
        payload: { targetAccountId: account.id },
      });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        logger.info("[noodle-fan-activity-scheduler] Auto-posted a new NoodleR post for %s", account.displayName);
      } else {
        logger.debug(
          "[noodle-fan-activity-scheduler] Auto-post skipped for %s: HTTP %d %s",
          account.displayName,
          response.statusCode,
          response.body,
        );
      }
    } catch (error) {
      logger.error(error, "[noodle-fan-activity-scheduler] Auto-post failed for %s", account.displayName);
    } finally {
      await persistAutoPostSettings(account, nextRunAt);
    }
  };

  const runDueAccount = async (
    account: NoodleAccount,
    fanSettings: ReturnType<typeof parseFanActivitySettings>,
    shared: { allAccounts: NoodleAccount[]; allSubscriptions: NoodleAccountSubscription[] },
  ) => {
    if (isNoodleRefreshLocked(account.id)) return; // Manual trigger or guided post in flight; try again next tick.
    const result = await withNoodleRefreshLock(account.id, () =>
      simulateNoodlerFanActivity({
        noodle,
        connections,
        characters,
        privateAccount: account,
        allAccounts: shared.allAccounts,
        allSubscriptions: shared.allSubscriptions,
      }),
    );
    const nextRunAt = new Date(Date.now() + jitteredIntervalMs(fanSettings.intensity)).toISOString();
    await persistFanActivitySettings(account, nextRunAt);
    if (result.ok) {
      logger.info(
        "[noodle-fan-activity-scheduler] Scheduled run for %s created %d interaction(s), %d new subscriber(s)",
        account.displayName,
        result.interactionsCreated,
        result.newSubscribers,
      );
    } else {
      logger.debug(
        "[noodle-fan-activity-scheduler] Scheduled run for %s skipped: %s",
        account.displayName,
        result.error,
      );
    }
  };

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const settings = await noodle.getSettings();
      if (!settings.noodler.enableFanActivityScheduler) return;

      const privateAccounts = await noodle.listPrivateAccounts();
      const now = Date.now();
      const dueAccounts: { account: NoodleAccount; fanSettings: ReturnType<typeof parseFanActivitySettings> }[] = [];
      const dueAutoPostAccounts: { account: NoodleAccount; autoPostSettings: ReturnType<typeof parseAutoPostSettings> }[] = [];
      for (const account of privateAccounts) {
        const fanSettings = parseFanActivitySettings(account);
        if (fanSettings.enabled && fanSettings.autoSchedule) {
          if (!fanSettings.nextRunAt) {
            // First time this account is eligible for scheduling — pick a
            // future time instead of running immediately, so flipping the
            // toggle on doesn't itself trigger a burst of fan activity.
            await persistFanActivitySettings(
              account,
              new Date(now + jitteredIntervalMs(fanSettings.intensity)).toISOString(),
            );
          } else if (Date.parse(fanSettings.nextRunAt) <= now) {
            dueAccounts.push({ account, fanSettings });
          }
        }

        const autoPostSettings = parseAutoPostSettings(account);
        if (autoPostSettings.enabled) {
          if (!autoPostSettings.nextRunAt) {
            // Same burst-avoidance as fan activity: don't run immediately
            // the moment auto-post is switched on.
            await persistAutoPostSettings(
              account,
              new Date(now + jitteredIntervalMs(autoPostSettings.intensity)).toISOString(),
            );
          } else if (Date.parse(autoPostSettings.nextRunAt) <= now) {
            dueAutoPostAccounts.push({ account, autoPostSettings });
          }
        }
      }

      for (const { account, autoPostSettings } of dueAutoPostAccounts) {
        await runDueAutoPostAccount(account, autoPostSettings);
      }

      if (dueAccounts.length > 0) {
        // Load once per tick and share across every due account this tick,
        // instead of each simulateNoodlerFanActivity call re-querying the
        // full accounts/subscriptions tables.
        const shared = {
          allAccounts: await noodle.listAccounts(),
          allSubscriptions: await noodle.listSubscriptions(),
        };
        for (const { account, fanSettings } of dueAccounts) {
          await runDueAccount(account, fanSettings, shared);
        }
      }
    } catch (error) {
      logger.error(error, "[noodle-fan-activity-scheduler] Poll failed");
    } finally {
      polling = false;
      scheduleNext(NOODLE_FAN_ACTIVITY_SCHEDULER_POLL_MS);
    }
  };

  scheduleNext(NOODLE_FAN_ACTIVITY_SCHEDULER_INITIAL_DELAY_MS);
  app.addHook("onClose", async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  });

  logger.info("[noodle-fan-activity-scheduler] NoodleR fan-activity scheduler started");
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
