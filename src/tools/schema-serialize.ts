import { z } from "zod";
import type { ZodType } from "zod";

/**
 * Serialize a Zod schema to a JSON Schema suitable for both Anthropic `input_schema` and
 * OpenAI function `parameters`. Zod 4 ships this natively (no zod-to-json-schema shim needed).
 */
export function toInputSchema(schema: ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete json["$schema"];
  return json;
}
