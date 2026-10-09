// ──────────────────────────────────────────────
// REagent shell: run a command line for the model, under the chat's policy.
// ──────────────────────────────────────────────

import { spawn } from "node:child_process";
import type { ReagentSettings } from "@marinara-engine/shared";

export const REAGENT_SHELL_TIMEOUT_MS = 120_000;
export const REAGENT_SHELL_OUTPUT_LIMIT = 24_000;

function compilePatterns(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    try {
      out.push(new RegExp(trimmed, "i"));
    } catch {
      // A broken pattern is treated as a plain substring so a typo never silently opens or closes the gate.
      out.push(new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    }
  }
  return out;
}

export type ShellVerdict = "run" | "ask" | "refuse";

/** Deny patterns always win; then the policy decides what an unmatched command does. */
export function judgeCommand(command: string, settings: ReagentSettings): ShellVerdict {
  if (compilePatterns(settings.shellDeny).some((pattern) => pattern.test(command))) return "refuse";
  if (compilePatterns(settings.shellAllow).some((pattern) => pattern.test(command))) return "run";
  switch (settings.shellPolicy) {
    case "bypass":
      return "run";
    case "ask":
      return "ask";
    default:
      return "refuse";
  }
}

export interface ShellRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}\n…[${text.length - limit} more characters truncated]` : text;
}

export function runShellCommand(
  command: string,
  options: { cwd: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<ShellRunResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? REAGENT_SHELL_TIMEOUT_MS;
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, REAGENT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolvePromise({
        exitCode,
        stdout: clip(stdout, REAGENT_SHELL_OUTPUT_LIMIT),
        stderr: clip(stderr, REAGENT_SHELL_OUTPUT_LIMIT / 2),
        timedOut,
        durationMs: Date.now() - started,
      });
    };
    const kill = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    };
    const onAbort = () => {
      kill();
      finish(null);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < REAGENT_SHELL_OUTPUT_LIMIT * 2) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < REAGENT_SHELL_OUTPUT_LIMIT) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
