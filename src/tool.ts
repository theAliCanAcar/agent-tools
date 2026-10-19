import { z } from "zod";
import { failure, isFailure, ok, type ToolFailure, type ToolOutcome } from "./errors";
import { zodToJsonSchema } from "./schema";
import type { JsonSchema, Tool, ToolContext } from "./types";

export type ToolDef<S extends z.ZodTypeAny, O> = {
  name: string;
  description: string;
  /** Zod input schema — validated at call time and rendered as JSON Schema for the model. */
  schema: S;
  /** Optional JSON Schema for the output. */
  output?: JsonSchema;
  execute: (input: z.infer<S>, ctx: ToolContext) => Promise<O>;
};

/**
 * Define a tool from a Zod schema:
 *
 *   tool({
 *     name: "search_customers",
 *     description: "Find customers by name or email.",
 *     schema: z.object({ query: z.string() }),
 *     execute: async ({ query }, ctx) => db.customers.search(query),
 *   });
 */
export function tool<S extends z.ZodTypeAny, O>(def: ToolDef<S, O>): Tool<z.infer<S>, O> {
  return {
    name: def.name,
    description: def.description,
    schema: zodToJsonSchema(def.schema),
    inputSchema: def.schema,
    ...(def.output ? { output: def.output } : {}),
    execute: def.execute,
  };
}

/**
 * Run a tool and always produce a structured outcome:
 * - invalid arguments  -> { ok: false, error: { code: "INVALID_INPUT" } }
 * - thrown errors      -> mapped to a structured error (never a bare throw)
 * - returned failures  -> passed through unchanged
 */
export async function runTool<I, O>(
  t: Tool<I, O>,
  input: unknown,
  ctx: ToolContext = {}
): Promise<ToolOutcome<O>> {
  let parsed: I;
  if (t.inputSchema) {
    const result = t.inputSchema.safeParse(input);
    if (!result.success) {
      return failure("INVALID_INPUT", `Invalid arguments for ${t.name}: ${result.error.message}`, {
        retryable: false,
        details: result.error.issues,
      });
    }
    parsed = result.data as I;
  } else {
    parsed = input as I;
  }

  try {
    const value = await t.execute(parsed, ctx);
    if (isFailure(value)) return value as unknown as ToolFailure;
    return ok(value as O);
  } catch (err) {
    return toFailure(err);
  }
}

export function toFailure(err: unknown): ToolFailure {
  if (isFailure(err)) return err;
  if (err instanceof z.ZodError) {
    return failure("INVALID_INPUT", err.message, { retryable: false, details: err.issues });
  }
  const anyErr = err as { name?: string; message?: string; code?: string; retryable?: boolean };
  if (anyErr?.name === "AbortError" || anyErr?.code === "ABORT_ERR") {
    return failure("TIMEOUT", anyErr.message ?? "Operation aborted.", { retryable: true });
  }
  return failure(anyErr?.code ?? "UPSTREAM_ERROR", anyErr?.message ?? "Tool failed.", {
    retryable: anyErr?.retryable ?? true,
  });
}

export type MockToolSpec<O> = {
  /** Value returned on each call (or a function of the input). */
  result?: O | ((input: unknown, ctx: ToolContext) => O | Promise<O>);
  /** Structured failure returned on each call. */
  error?: ToolFailure["error"];
  schema?: JsonSchema;
  description?: string;
};

export type MockTool<I = unknown, O = unknown> = Tool<I, O> & {
  calls: Array<{ input: unknown; ctx: ToolContext }>;
};

/** Fake tool for tests: records calls and returns canned results. */
export function mockTool<I = unknown, O = unknown>(
  name: string,
  spec: MockToolSpec<O> = {}
): MockTool<I, O> {
  const calls: Array<{ input: unknown; ctx: ToolContext }> = [];
  return {
    name,
    description: spec.description ?? `Mock tool ${name}`,
    schema: spec.schema ?? { type: "object", properties: {}, additionalProperties: false },
    calls,
    async execute(input: I, ctx: ToolContext): Promise<O> {
      calls.push({ input, ctx });
      if (spec.error) return { ok: false, error: spec.error } as unknown as O;
      const result = spec.result;
      return (typeof result === "function"
        ? await (result as (input: unknown, ctx: ToolContext) => O | Promise<O>)(input, ctx)
        : (result as O)) as O;
    },
  };
}