import type { Request, Response } from "express";
import type { ZodType, ZodTypeDef } from "zod";

// Parses req.body against the schema; on failure sends a 400 and returns null.
// The input type is `unknown` so schemas with .default() infer their output type.
export function parseBody<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  req: Request,
  res: Response
): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: "Validation failed",
      details: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return null;
  }
  return result.data;
}
