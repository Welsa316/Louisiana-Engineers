import type { ValidationTargets } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import { AppError } from "./errors";

/**
 * Route middleware that parses one part of the request with a zod schema
 * (the JSON body unless `target` says otherwise). Handlers read the parsed
 * value with `c.req.valid(target)`; a failure is answered by the error
 * handler as `400 { code: 'validation', issues }`. A body sent without a JSON
 * content type is treated as empty, so the schema reports what is missing.
 */
export function validate<Schema extends z.ZodTypeAny, Target extends keyof ValidationTargets = "json">(
  schema: Schema,
  target: Target = "json" as Target,
) {
  return validator(target, (value): z.output<Schema> => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new AppError(400, "validation", `invalid ${target}`, { issues: parsed.error.issues });
    }
    return parsed.data;
  });
}
