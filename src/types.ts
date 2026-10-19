import type { z } from "zod";

/** Minimal JSON Schema object passed to the model for tool calling. */
export type JsonSchema = Record<string, unknown>;

/**
 * Per-call context handed to every tool. Extend freely via the index signature
 * (memory, approval, audit, db handles, ...).
 */
export type ToolContext = {
  userId?: string;
  sessionId?: string;
  /** Working memory for the current task. */
  state?: Record<string, unknown>;
  signal?: AbortSignal;
  [key: string]: unknown;
};

/**
 * The standard tool contract. The important abstraction is
 * `tool.execute(input, context)` — not the specific service behind it.
 */
export type Tool<I = unknown, O = unknown> = {
  name: string;
  description: string;
  /** JSON Schema shown to the model. */
  schema: JsonSchema;
  /** Optional Zod schema used for runtime validation of tool arguments. */
  inputSchema?: z.ZodTypeAny;
  /** Optional JSON Schema describing the output (agent-schemas requirement). */
  output?: JsonSchema;
  execute(input: I, ctx: ToolContext): Promise<O>;
};