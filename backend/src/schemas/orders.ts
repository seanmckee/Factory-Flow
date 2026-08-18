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

export const updateWorkCenterSchema = z.object({
  capacity: positiveInt("capacity"),
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
