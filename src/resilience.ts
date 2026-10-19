import { isRetryable, type ToolFailure, type ToolResult } from "./errors";
import { runTool } from "./tool";
import type { Tool, ToolContext } from "./types";

/**
 * Resilience helpers:
 *   retry(tool, { attempts: 3, backoff: "exponential" })
 *   timeout(tool, 15_000)
 *   fallback(primaryTool, backupTool)
 */

export type RetryOptions = {
  attempts?: number;
  backoff?: "none" | "fixed" | "exponential";
  baseDelayMs?: number;
  /** Decide whether a failed outcome should be retried (default: error.retryable). */
  shouldRetry?: (failure: ToolFailure) => boolean;
};

export function retry<I, O>(t: Tool<I, O>, options: RetryOptions = {}): Tool<I, ToolResult<O>> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoff = options.backoff ?? "exponential";
  const baseDelayMs = options.baseDelayMs ?? 250;
  const shouldRetry = options.shouldRetry ?? isRetryable;

  return {
    name: t.name,
    description: t.description,
    schema: t.schema,
    ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
    async execute(input: I, ctx: ToolContext): Promise<ToolResult<O>> {
      let last: ToolFailure | undefined;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const outcome = await runTool(t, input, ctx);
        if (outcome.ok) return outcome.value;
        last = outcome;
        const isLast = attempt === attempts;
        if (isLast || !shouldRetry(last)) return last;
        const delay =
          backoff === "none" ? 0 : backoff === "fixed" ? baseDelayMs : baseDelayMs * 2 ** (attempt - 1);
        if (delay > 0) await sleep(delay, ctx.signal);
      }
      return last!;
    },
  };
}

export function timeout<I, O>(t: Tool<I, O>, ms: number): Tool<I, ToolResult<O>> {
  return {
    name: t.name,
    description: t.description,
    schema: t.schema,
    ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
    async execute(input: I, ctx: ToolContext): Promise<ToolResult<O>> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${ms}ms`)), ms);
      const outer = ctx.signal;
      const onAbort = () => controller.abort(outer?.reason);
      if (outer) {
        if (outer.aborted) controller.abort(outer.reason);
        else outer.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const raced = await Promise.race([
          runTool(t, input, { ...ctx, signal: controller.signal }),
          sleep(ms + 1, controller.signal).then(
            (): ToolFailure => ({
              ok: false,
              error: { code: "TIMEOUT", message: `Tool ${t.name} timed out after ${ms}ms.`, retryable: true },
            })
          ),
        ]);
        return raced.ok ? raced.value : raced;
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onAbort);
      }
    },
  };
}

export function fallback<I, O>(primary: Tool<I, O>, backup: Tool<I, O>): Tool<I, ToolResult<O>> {
  return {
    name: primary.name,
    description: primary.description,
    schema: primary.schema,
    ...(primary.inputSchema ? { inputSchema: primary.inputSchema } : {}),
    async execute(input: I, ctx: ToolContext): Promise<ToolResult<O>> {
      const first = await runTool(primary, input, ctx);
      if (first.ok) return first.value;
      const second = await runTool(backup, input, ctx);
      return second.ok ? second.value : second;
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}