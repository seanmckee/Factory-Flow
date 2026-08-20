import { z } from "zod";

/** Positive integer with messages worth showing to a user - zod's defaults are terse. */
function positiveInt(label: string) {
  return z
    .int({ error: `${label} must be a whole number` })
    .positive({ error: `${label} must be greater than zero` });
}

/** Numeric path params, e.g. /api/routings/:id */
export const idParamSchema = z.object({
  id: z.coerce
    .number({ error: "id must be a number" })
    .int({ error: "id must be a whole number" })
    .positive({ error: "id must be greater than zero" }),
});

export const createSalesOrderSchema = z.object({
  partId: positiveInt("partId"),
  quantity: positiveInt("quantity"),
  unitPriceCents: positiveInt("unitPriceCents"),
});

export const createWorkOrderSchema = z.object({
  partId: positiveInt("partId"),
  routingId: positiveInt("routingId"),
  quantity: positiveInt("quantity"),
  // null / omitted means "auto-allocate to open demand"
  salesOrderId: positiveInt("salesOrderId").nullish(),
  allocationQuantity: positiveInt("allocationQuantity").nullish(),
});

/** Work center names are unique, so they carry the same trim/length rules everywhere. */
function workCenterName() {
  return z
    .string({ error: "name must be text" })
    .trim()
    .min(1, { error: "name is required" })
    .max(255, { error: "name must be 255 characters or fewer" });
}

export const createWorkCenterSchema = z.object({
  name: workCenterName(),
  // omitted means "take the column default of 1"
  capacity: positiveInt("capacity").optional(),
});

/**
 * Both fields optional so a rename and a capacity change can arrive separately.
 * The refine keeps an empty body a 400 rather than a no-op 200.
 */
export const updateWorkCenterSchema = z
  .object({
    name: workCenterName().optional(),
    capacity: positiveInt("capacity").optional(),
  })
  .refine((body) => body.name !== undefined || body.capacity !== undefined, {
    error: "provide name or capacity",
  });

/**
 * ?force=true on a destructive route.
 *
 * Deliberately not z.coerce.boolean(): that is just Boolean(value), so the
 * string "false" coerces to true and would delete allocated records.
 */
export const forceQuerySchema = z.object({
  force: z
    .enum(["true", "false"], { error: 'force must be "true" or "false"' })
    .optional(),
});

export const routingQuerySchema = z.object({
  partId: z.coerce
    .number({ error: "partId must be a number" })
    .int({ error: "partId must be a whole number" })
    .positive({ error: "partId must be greater than zero" })
    .optional(),
});

export type CreateSalesOrderBody = z.infer<typeof createSalesOrderSchema>;
export type CreateWorkOrderBody = z.infer<typeof createWorkOrderSchema>;
export type CreateWorkCenterBody = z.infer<typeof createWorkCenterSchema>;
