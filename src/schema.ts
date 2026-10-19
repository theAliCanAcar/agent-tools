import { z } from "zod";
import type { JsonSchema } from "./types";

/**
 * Small Zod -> JSON Schema converter covering the shapes tools actually use.
 * Intentionally minimal: no extra dependency for a solved problem we can keep tiny.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;
  const typeName = String(def?.typeName ?? "");

  switch (typeName) {
    case "ZodObject": {
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      return {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };
    }
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      const checks = (def.checks as Array<{ kind: string; value?: number }> | undefined) ?? [];
      for (const check of checks) {
        if (check.kind === "min" && typeof check.value === "number") out.minLength = check.value;
        if (check.kind === "max" && typeof check.value === "number") out.maxLength = check.value;
      }
      return out;
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: "number" };
      const checks = (def.checks as Array<{ kind: string; value?: number }> | undefined) ?? [];
      for (const check of checks) {
        if (check.kind === "int") out.type = "integer";
        if (check.kind === "min" && typeof check.value === "number") out.minimum = check.value;
        if (check.kind === "max" && typeof check.value === "number") out.maximum = check.value;
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { const: def.value };
    case "ZodEnum":
      return { type: "string", enum: [...(def.values as string[])] };
    case "ZodNativeEnum":
      return { enum: Object.values(def.values as Record<string, unknown>) };
    case "ZodArray": {
      const out: JsonSchema = { type: "array", items: zodToJsonSchema(def.type as z.ZodTypeAny) };
      const minLength = def.minLength as { value: number } | null;
      const maxLength = def.maxLength as { value: number } | null;
      if (minLength) out.minItems = minLength.value;
      if (maxLength) out.maxItems = maxLength.value;
      return out;
    }
    case "ZodRecord":
      return {
        type: "object",
        additionalProperties: zodToJsonSchema((def.valueType ?? def.value) as z.ZodTypeAny),
      };
    case "ZodOptional":
    case "ZodNullable":
      return zodToJsonSchema(def.innerType as z.ZodTypeAny);
    case "ZodDefault": {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      return { ...inner, default: (def.defaultValue as () => unknown)() };
    }
    case "ZodUnion": {
      const options = (def.options as z.ZodTypeAny[]).map(zodToJsonSchema);
      return { anyOf: options };
    }
    case "ZodEffects":
      return zodToJsonSchema(def.schema as z.ZodTypeAny);
    default:
      return {};
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = String((schema as unknown as { _def: { typeName?: string } })._def?.typeName ?? "");
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}