import type { Response } from "express";
import type { ZodType } from "zod";

/**
 * Runs `data` through `schema`. On success returns the parsed value; on failure
 * writes a 400 with a readable `message` and returns null, so callers early-return:
 *
 *   const body = parseOr400(createSalesOrderSchema, req.body, res);
 *   if (!body) return;
 *
 * The `{ message }` shape matches every other error response in the API, and the
 * frontend surfaces it verbatim in a toast.
 */
export function parseOr400<T>(
  schema: ZodType<T>,
  data: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const message = result.error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ");

  res.status(400).json({ message });
  return null;
}
