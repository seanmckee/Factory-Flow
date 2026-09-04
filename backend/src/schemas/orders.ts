import { string, z } from "zod";

/** Positive integer with messages worth showing to a user - zod's defaults are terse.  */
function positiveInt(label: string) {
  return z
    .int({ error: `${label} must be a whole number` })
    .positive({ error: `${label} must be greater than zero` });
}

/** Non-negative integer with messages worth showing to a user - zod's defaults are terse. */
function nonNegativeInt(label: string) {
  return z
    .int({ error: `${label} must be a whole number` })
    .nonnegative({ error: `${label} must be greater than or equal to zero` });
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
  // calendar day the order is promised by; >= 1, since day 0 ends at tick 0,
  // before anything can finish. Absent or null = no promise.
  dueDay: positiveInt("dueDay").nullish(),
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

/**
 * The per-centre fields both create and update accept, beside the name.
 * `capacity` is machines; `operators` is who stands at them, and effective
 * capacity is the lesser of the two. The three prices are what a capital
 * action costs the run that froze them — a machine can be free to buy and
 * expensive to keep, or the reverse, so none of them is derived from another.
 */
const workCenterFields = {
  // omitted means "take the column default of 1"
  capacity: positiveInt("capacity").optional(),
  // operators may legitimately be zero: a centre nobody staffs runs nothing
  operators: nonNegativeInt("operators").optional(),
  // omitted means "take the column default of 0" — a free machine. Per
  // machine, so a centre's rent is machines × this.
  standingCostCentsPerDay: nonNegativeInt("standingCostCentsPerDay").optional(),
  // per operator per staffed hour; omitted means the default of 0
  wageCentsPerHour: nonNegativeInt("wageCentsPerHour").optional(),
  machinePurchaseCents: nonNegativeInt("machinePurchaseCents").optional(),
  machineSalvageCents: nonNegativeInt("machineSalvageCents").optional(),
  operatorHireCents: nonNegativeInt("operatorHireCents").optional(),
};

export const createWorkCenterSchema = z.object({
  name: workCenterName(),
  ...workCenterFields,
});

/**
 * All fields optional so a rename and a capacity change can arrive separately.
 * The refine keeps an empty body a 400 rather than a no-op 200.
 */
export const updateWorkCenterSchema = z
  .object({
    name: workCenterName().optional(),
    ...workCenterFields,
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error:
      "provide name, capacity, operators, standingCostCentsPerDay, wageCentsPerHour, machinePurchaseCents, machineSalvageCents or operatorHireCents",
  });

// Factory settings

/** The facility-level settings a run freezes at creation; see factory_settings. */
const shiftsInt = z
  .int({ error: "shifts must be a whole number" })
  .min(1, { error: "a day needs at least one shift" })
  .max(3, { error: "a day holds at most three 8-hour shifts" });

export const updateFactorySettingsSchema = z
  .object({
    facilityOverheadCentsPerDay: nonNegativeInt(
      "facilityOverheadCentsPerDay",
    ).optional(),
    wipCarryingBpsPerDay: nonNegativeInt("wipCarryingBpsPerDay").optional(),
    shifts: shiftsInt.optional(),
  })
  .refine(
    (body) =>
      body.facilityOverheadCentsPerDay !== undefined ||
      body.wipCarryingBpsPerDay !== undefined ||
      body.shifts !== undefined,
    { error: "provide facilityOverheadCentsPerDay, wipCarryingBpsPerDay or shifts" },
  );

// Parts

export const createPartSchema = z.object({
  partNumber: string({ error: "partNumber must be text" })
    .trim()
    .min(1, { error: "partNumber is required" })
    .max(255, { error: "partNumber must be 255 characters or fewer" }),
  name: string({ error: "name must be text" })
    .trim()
    .min(1, { error: "name is required" })
    .max(255, { error: "name must be 255 characters or fewer" }),
  materialCostCents: nonNegativeInt("materialCostCents"),
});

export const updatePartSchema = z
  .object({
    partNumber: string({ error: "partNumber must be text" })
      .trim()
      .min(1, { error: "partNumber is required" })
      .max(255, { error: "partNumber must be 255 characters or fewer" })
      .optional(),
    name: string({ error: "name must be text" })
      .trim()
      .min(1, { error: "name is required" })
      .max(255, { error: "name must be 255 characters or fewer" })
      .optional(),
    materialCostCents: nonNegativeInt("materialCostCents").optional(),
  })
  .refine(
    (body) =>
      body.partNumber !== undefined ||
      body.name !== undefined ||
      body.materialCostCents !== undefined,
    {
      error: "provide partNumber, name, or materialCostCents",
    },
  );

// Routings

function boundedText(label: string) {
  return z
    .string({ error: `${label} must be text` })
    .trim()
    .min(1, { error: `${label} is required` })
    .max(255, { error: `${label} must be 255 characters or fewer` });
}

/**
 * One operation. `sequence` is deliberately absent: position comes from the
 * array index, so the client never has to keep sequence numbers consistent
 * against UNIQUE(routing_id, sequence).
 */
const routingStepSchema = z.object({
  workCenterId: positiveInt("workCenterId"),
  processTimeSeconds: positiveInt("processTimeSeconds"),
  // zero is a legitimate setup time - see the seeded Raw Material step
  setupTimeSeconds: nonNegativeInt("setupTimeSeconds"),
  // basis points, 10000 = every unit ruined; defaulted rather than required
  // so step payloads predating 6C stay valid
  scrapBps: nonNegativeInt("scrapBps")
    .max(10_000, { error: "scrapBps must be at most 10000 (100%)" })
    .default(0),
});

const stepListSchema = z
  .array(routingStepSchema)
  .min(1, { error: "a routing needs at least one step" })
  .max(50, { error: "a routing can have at most 50 steps" });

export const createRoutingSchema = z.object({
  partId: positiveInt("partId"),
  name: boundedText("name"),
  // omitted takes the column default of "A"
  revision: boundedText("revision").optional(),
  steps: stepListSchema,
});

export const updateRoutingSchema = z
  .object({
    name: boundedText("name").optional(),
    revision: boundedText("revision").optional(),
  })
  .refine((body) => body.name !== undefined || body.revision !== undefined, {
    error: "provide name or revision",
  });

/** Whole-list replace - see PUT /api/routings/:id/steps. */
export const replaceStepsSchema = z.object({ steps: stepListSchema });

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
export type CreateRoutingBody = z.infer<typeof createRoutingSchema>;

/**
 * A run's seed. Any int the column holds will do — it is hashed with the work
 * order, unit and step to produce a draw — and it is optional on create so a
 * caller that does not care gets a random one and can read it back to replay.
 */
const seedInt = z
  .int({ error: "rngSeed must be a whole number" })
  .nonnegative({ error: "rngSeed must be greater than or equal to zero" })
  .max(2147483647, { error: "rngSeed must fit in a 32-bit integer" });

export const createRunSchema = z.object({
  name: boundedText("name"),
  rngSeed: seedInt.optional(),
  // facility-level rate overrides; omitted means "freeze the live settings".
  // Per-centre standing costs are deliberately not overridable here — editing
  // a run's own frozen config is 6E's capital-actions mechanism.
  facilityOverheadCentsPerDay: nonNegativeInt(
    "facilityOverheadCentsPerDay",
  ).optional(),
  wipCarryingBpsPerDay: nonNegativeInt("wipCarryingBpsPerDay").optional(),
  // one-shift vs two-shift is exactly the comparison a fork wants to run
  shifts: shiftsInt.optional(),
});

export const releaseWorkOrderSchema = z.object({
  workOrderId: positiveInt("workOrderId"),
});

/**
 * A capital action against a run's own frozen config. One endpoint with a
 * discriminating `kind` rather than four routes: Track 8's tool layer wants
 * one verb it can parameterise, and the four share their whole shape.
 *
 * The action carries no money — what it costs is the run's frozen price, not
 * the caller's opinion of it.
 */
export const capitalActionSchema = z.object({
  kind: z.enum(
    ["buy_machine", "retire_machine", "hire_operator", "fire_operator"],
    {
      error:
        "kind must be buy_machine, retire_machine, hire_operator or fire_operator",
    },
  ),
  workCenterId: positiveInt("workCenterId"),
});

/**
 * How many ticks one request advances. Capped because advancing is synchronous
 * and roughly 500 ticks per second — an uncapped request would hold a
 * connection for minutes with nothing to show until it finished. An agent that
 * wants more calls again; the run is resumable by construction.
 */
export const MAX_TICKS_PER_REQUEST = 20000;

export const advanceRunSchema = z.object({
  ticks: positiveInt("ticks").max(MAX_TICKS_PER_REQUEST, {
    error: `ticks must be ${MAX_TICKS_PER_REQUEST} or fewer per request`,
  }),
});

/** Optional tick window for reading a run's metrics, from the query string. */
export const metricsWindowSchema = z.object({
  fromTick: z.coerce
    .number({ error: "fromTick must be a number" })
    .int({ error: "fromTick must be a whole number" })
    .positive({ error: "fromTick must be greater than zero" })
    .optional(),
  toTick: z.coerce
    .number({ error: "toTick must be a number" })
    .int({ error: "toTick must be a whole number" })
    .positive({ error: "toTick must be greater than zero" })
    .optional(),
});

/**
 * `/ticks` takes the window plus an optional bucket: rows grouped per `bucket`
 * ticks, money summed, WIP read at bucket end. 1 (the default) is the raw
 * series; the chart asks in simulated minutes or hours once a run outgrows
 * per-second resolution.
 */
export const ticksQuerySchema = metricsWindowSchema.extend({
  bucket: z.coerce
    .number({ error: "bucket must be a number" })
    .int({ error: "bucket must be a whole number" })
    .positive({ error: "bucket must be greater than zero" })
    .max(86_400, { error: "bucket must be at most 86400 ticks" })
    .optional(),
});
