import { z } from "zod";
import { failure, isFailure, type ToolResult } from "./errors";
import { tool } from "./tool";
import type { Tool, ToolContext } from "./types";

/** Connector 1: generic HTTP. One wrapper beats twenty bespoke integrations. */
export type HttpToolConfig = {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

const httpRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  path: z.string().describe("Absolute URL or path appended to baseUrl."),
  query: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
});

export type HttpRequestInput = z.infer<typeof httpRequestSchema>;

export type HttpResponse = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
};

export function http(config: HttpToolConfig = {}): Tool<HttpRequestInput, ToolResult<HttpResponse>> {
  return tool({
    name: "http_request",
    description: "Make an HTTP request and return status, headers, and parsed JSON body.",
    schema: httpRequestSchema,
    execute: async (input, ctx) => {
      const url = buildUrl(config.baseUrl, input.path, input.query);
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...config.headers,
        ...input.headers,
      };
      let body: string | undefined;
      if (input.body !== undefined) {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
        body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
      }
      try {
        const res = await fetch(url, {
          method: input.method,
          headers,
          body,
          signal: mergeSignal(ctx.signal, config.timeoutMs),
        });
        const text = await res.text();
        let parsed: unknown = text;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          /* keep raw text */
        }
        const response: HttpResponse = {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries()),
          body: parsed,
        };
        if (!res.ok) {
          return failure("UPSTREAM_ERROR", `HTTP ${res.status} from ${url}`, {
            retryable: res.status === 429 || res.status >= 500,
            details: response,
          });
        }
        return response;
      } catch (err) {
        const anyErr = err as { name?: string; message?: string };
        if (anyErr?.name === "TimeoutError" || anyErr?.name === "AbortError") {
          return failure("TIMEOUT", `Request to ${url} timed out.`, { retryable: true });
        }
        return failure("UPSTREAM_ERROR", anyErr?.message ?? `Request to ${url} failed.`, {
          retryable: true,
        });
      }
    },
  });
}

/** fetchJson(): convenience wrapper returning just the parsed JSON body. */
export function fetchJson(config: HttpToolConfig = {}): Tool<HttpRequestInput, ToolResult<unknown>> {
  const base = http(config);
  return tool({
    name: "fetch_json",
    description: "Fetch a URL and return the parsed JSON body.",
    schema: httpRequestSchema,
    execute: async (input, ctx): Promise<ToolResult<unknown>> => {
      const result = await base.execute(input, ctx);
      if (isFailure(result)) return result;
      return result.body;
    },
  });
}

/** Connector 2-style record CRUD tools built on any HTTP-ish backend. */
export type RecordStore = {
  insert(table: string, data: unknown): Promise<unknown>;
  update(table: string, id: string, data: unknown): Promise<unknown>;
  find(table: string, filters: Record<string, unknown>): Promise<unknown>;
  delete(table: string, id: string): Promise<unknown>;
};

export function createRecord(store: RecordStore): Tool<unknown, unknown> {
  return tool({
    name: "create_record",
    description: "Insert a new record into a table/collection.",
    schema: z.object({ table: z.string(), data: z.unknown() }),
    execute: ({ table, data }) => store.insert(table, data),
  });
}

export function updateRecord(store: RecordStore): Tool<unknown, unknown> {
  return tool({
    name: "update_record",
    description: "Update an existing record by id.",
    schema: z.object({ table: z.string(), id: z.string(), data: z.unknown() }),
    execute: ({ table, id, data }) => store.update(table, id, data),
  });
}

export function deleteRecord(store: RecordStore): Tool<unknown, unknown> {
  return tool({
    name: "delete_record",
    description: "Delete a record by id.",
    schema: z.object({ table: z.string(), id: z.string() }),
    execute: ({ table, id }) => store.delete(table, id),
  });
}

/** Connector 3: normalized email sender. */
export type EmailSender = (message: {
  to: string;
  subject: string;
  body: string;
}) => Promise<unknown>;

export function sendEmail(send: EmailSender): Tool<unknown, unknown> {
  return tool({
    name: "send_email",
    description: "Send an email with a recipient, subject, and body.",
    schema: z.object({
      to: z.string().describe("Recipient email address."),
      subject: z.string(),
      body: z.string(),
    }),
    execute: (message) => send(message),
  });
}

/** Connector 5: normalized file access. */
export type FileBackend = {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(path: string): Promise<unknown[]>;
  search(query: string): Promise<unknown[]>;
};

export function readFile(files: FileBackend): Tool<unknown, string> {
  return tool({
    name: "read_file",
    description: "Read a file and return its contents as text.",
    schema: z.object({ path: z.string() }),
    execute: ({ path }) => files.read(path),
  });
}

export function writeFile(files: FileBackend): Tool<unknown, unknown> {
  return tool({
    name: "write_file",
    description: "Write text content to a file.",
    schema: z.object({ path: z.string(), content: z.string() }),
    execute: ({ path, content }) => files.write(path, content),
  });
}

export function listFiles(files: FileBackend): Tool<unknown, unknown[]> {
  return tool({
    name: "list_files",
    description: "List files under a directory.",
    schema: z.object({ path: z.string().default(".") }),
    execute: ({ path }) => files.list(path),
  });
}

export function searchFiles(files: FileBackend): Tool<unknown, unknown[]> {
  return tool({
    name: "search_files",
    description: "Search file contents for a query string.",
    schema: z.object({ query: z.string() }),
    execute: ({ query }) => files.search(query),
  });
}

/** Shell access (local or via an Agent 37 sandbox). */
export type ShellRunner = (command: string, ctx: ToolContext) => Promise<unknown>;

export function runCommand(run: ShellRunner): Tool<unknown, unknown> {
  return tool({
    name: "run_command",
    description: "Run a shell command and return its output.",
    schema: z.object({ command: z.string() }),
    execute: ({ command }, ctx) => run(command, ctx),
  });
}

/** Web search backend (bring your own provider). */
export type WebSearcher = (query: string, ctx: ToolContext) => Promise<unknown>;

export function searchWeb(search: WebSearcher): Tool<unknown, unknown> {
  return tool({
    name: "search_web",
    description: "Search the web and return results.",
    schema: z.object({ query: z.string() }),
    execute: ({ query }, ctx) => search(query, ctx),
  });
}

/** Memory hooks — wired to agent-memory at composition time. */
export type MemoryHooks = {
  search(args: { userId?: string; query: string; limit?: number }): Promise<unknown>;
  save(args: { userId?: string; text: string; metadata?: Record<string, unknown> }): Promise<unknown>;
};

export function searchMemory(memory: MemoryHooks): Tool<unknown, unknown> {
  return tool({
    name: "search_memory",
    description: "Search long-term memory for relevant past knowledge.",
    schema: z.object({
      query: z.string(),
      userId: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(5),
    }),
    execute: ({ query, userId, limit }) => memory.search({ userId, query, limit }),
  });
}

export function saveMemory(memory: MemoryHooks): Tool<unknown, unknown> {
  return tool({
    name: "save_memory",
    description: "Save a fact or preference to long-term memory.",
    schema: z.object({
      text: z.string(),
      userId: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
    execute: ({ text, userId, metadata }) => memory.save({ userId, text, metadata }),
  });
}

/** Approval hook — wired to agent-approval at composition time. */
export type ApprovalHook = (req: {
  action: string;
  description: string;
  payload?: unknown;
}) => Promise<{ approved: boolean; reason?: string }>;

export function requestApproval(approve: ApprovalHook): Tool<unknown, unknown> {
  return tool({
    name: "request_approval",
    description: "Ask a human to approve an action before it is executed.",
    schema: z.object({
      action: z.string(),
      description: z.string(),
      payload: z.unknown().optional(),
    }),
    execute: (req) => approve(req),
  });
}

function buildUrl(baseUrl: string | undefined, path: string, query?: Record<string, string>): string {
  const absolute = /^https?:\/\//i.test(path);
  const joined = absolute
    ? path
    : `${(baseUrl ?? "").replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const url = new URL(joined);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

function mergeSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  // note: kept local to avoid clashing with globalThis.fetch typings
  const signals: AbortSignal[] = [];
  if (signal) signals.push(signal);
  if (timeoutMs && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  // AbortSignal.any is not in ES2021 lib; fall back to manual wiring.
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}