// ──────────────────────────────────────────────
// Living World scheduler — keeps the world simmering
// ──────────────────────────────────────────────
// Every poll: execute any queued moments whose time has arrived (drip).
// On cadence: run the director to plan the next window's timeline.
import type { FastifyInstance } from "fastify";

import { logger } from "../../lib/logger.js";
import {
  drainDueWorldActions,
  loadWorldEngineConfig,
  loadWorldEngineState,
  runWorldCycleExclusive,
  runWorldDirector,
} from "./world-engine.service.js";
import { advanceActiveScenes, wakeDueCharacterMinds } from "./character-mind.service.js";
import { refreshWeather } from "./world-atmosphere.service.js";
import { createWorldStorage } from "../storage/world.storage.js";

let lastWeatherRefreshMs = 0;
let lastEventsPruneMs = 0;

// 15s heartbeat: a live in-person exchange alternates roughly per cycle, so
// replies land in seconds — conversation speed, not queue speed. Idle cycles
// are cheap (cached init, updatedAt-gated scene scan, one config read).
const POLL_MS = 15_000;
const INITIAL_DELAY_MS = 10_000;
/** Director failure backoff: cadence × 2^failures, capped at 6h. */
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

let running = false;

export function startWorldEngineScheduler(app: FastifyInstance): void {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const config = await loadWorldEngineConfig(app.db);
      if (!config.enabled) return;

      if (config.mode === "minds") {
        // Refresh the shared weather at most hourly (non-blocking, best-effort).
        if (config.weatherLocation.trim() && Date.now() - lastWeatherRefreshMs >= 60 * 60_000) {
          lastWeatherRefreshMs = Date.now();
          void refreshWeather(app.db, config.weatherLocation).catch((error) =>
            logger.debug(error, "[world] Weather refresh failed"),
          );
        }
        // Bound the append-only event log at most hourly (non-blocking).
        if (Date.now() - lastEventsPruneMs >= 60 * 60_000) {
          lastEventsPruneMs = Date.now();
          void createWorldStorage(app.db)
            .pruneEvents()
            .then((removed) => {
              if (removed) logger.debug("[world] Pruned %d old world event(s)", removed);
            })
            .catch((error) => logger.debug(error, "[world] Event prune failed"));
        }
        // Exclusive with a manual /tick. Keep live scenes (DMs, hangouts)
        // alternating cleanly, then wake whoever's life-clock is due.
        await runWorldCycleExclusive(async () => {
          await advanceActiveScenes(app.db);
          await wakeDueCharacterMinds(app.db, { app });
        });
        return;
      }

      // Director mode — drip first: moments land on time even when the director
      // isn't due. Exclusive with a manual /tick so nothing double-executes.
      await runWorldCycleExclusive(async () => {
        await drainDueWorldActions(app.db);
        const state = await loadWorldEngineState(app.db);
        const cadenceMs = config.cadenceMinutes * 60_000;
        const backoffMs = Math.min(cadenceMs * 2 ** state.consecutiveFailures, MAX_BACKOFF_MS);
        const dueAt = state.lastRunAt ? new Date(state.lastRunAt).getTime() + backoffMs : 0;
        if (Date.now() >= dueAt) {
          await runWorldDirector(app.db);
        }
      });
    } catch (error) {
      logger.error(error, "[world] Scheduler cycle crashed");
    } finally {
      running = false;
    }
  };

  const start = setTimeout(() => {
    void tick();
    const interval = setInterval(() => void tick(), POLL_MS);
    interval.unref?.();
  }, INITIAL_DELAY_MS);
  start.unref?.();

  logger.info("[world] Living World scheduler armed (drip every %ds)", POLL_MS / 1000);
}
