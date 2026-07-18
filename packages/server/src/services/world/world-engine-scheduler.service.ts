// ──────────────────────────────────────────────
// Living World scheduler — keeps the world simmering
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";

import { logger } from "../../lib/logger.js";
import { loadWorldEngineConfig, loadWorldEngineState, runWorldTick } from "./world-engine.service.js";

const POLL_MS = 60_000;
const INITIAL_DELAY_MS = 30_000;
/** Failure backoff: cadence × 2^failures, capped at 6h. */
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

let running = false;

export function startWorldEngineScheduler(app: FastifyInstance): void {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const config = await loadWorldEngineConfig(app.db);
      if (!config.enabled) return;
      const state = await loadWorldEngineState(app.db);

      const cadenceMs = config.cadenceMinutes * 60_000;
      const backoffMs = Math.min(cadenceMs * 2 ** state.consecutiveFailures, MAX_BACKOFF_MS);
      const dueAt = state.lastRunAt ? new Date(state.lastRunAt).getTime() + backoffMs : 0;
      if (Date.now() < dueAt) return;

      await runWorldTick(app.db);
    } catch (error) {
      logger.error(error, "[world] Scheduler tick crashed");
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

  logger.info("[world] Living World scheduler armed (polling every %ds)", POLL_MS / 1000);
}
