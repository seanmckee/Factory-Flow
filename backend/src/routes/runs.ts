import { Router, type Response } from "express";
import { isHttpError } from "../lib/httpError.js";
import {
  getRun,
  getRunFloor,
  getRunMetrics,
  getRunTicks,
  listRuns,
} from "../lib/runReads.js";
import {
  advanceRun,
  createRun,
  deleteRun,
  releaseWorkOrder,
  unlockRun,
} from "../lib/runService.js";
import { parseOr400 } from "../lib/validate.js";
import {
  advanceRunSchema,
  createRunSchema,
  idParamSchema,
  metricsWindowSchema,
  ticksQuerySchema,
  releaseWorkOrderSchema,
} from "../schemas/orders.js";

const router = Router();

/**
 * A run is where the simulation actually lives: the factory tables above
 * describe a shop, a run is one experiment on it. Everything here delegates to
 * the service layer — `runService` owns the lock and the batched writes,
 * `runReads` the summaries and series, `runState` the shared loader — and the
 * routes only validate, map an `HttpError` onto its status, and serialise.
 */

/** Every route ends the same way, and `HttpError` carries the status to use. */
function fail(res: Response, error: unknown, context: string) {
  if (isHttpError(error)) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error(context, error);
  res.status(500).json({ message: context });
}

router.get("/", async (_req, res) => {
  try {
    res.json(await listRuns());
  } catch (error) {
    fail(res, error, "Error getting runs");
  }
});

router.post("/", async (req, res) => {
  try {
    const body = parseOr400(createRunSchema, req.body, res);
    if (!body) return;

    // a caller that does not care about the seed gets one and can read it back,
    // which is all replaying the run later needs
    const rngSeed = body.rngSeed ?? Math.floor(Math.random() * 2 ** 31);

    const overrides: {
      facilityOverheadCentsPerDay?: number;
      wipCarryingBpsPerDay?: number;
      shifts?: number;
    } = {};
    if (body.facilityOverheadCentsPerDay !== undefined) {
      overrides.facilityOverheadCentsPerDay = body.facilityOverheadCentsPerDay;
    }
    if (body.wipCarryingBpsPerDay !== undefined) {
      overrides.wipCarryingBpsPerDay = body.wipCarryingBpsPerDay;
    }
    if (body.shifts !== undefined) {
      overrides.shifts = body.shifts;
    }

    res.status(201).json(await createRun(body.name, rngSeed, overrides));
  } catch (error) {
    fail(res, error, "Error creating run");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    res.json(await getRun(params.id));
  } catch (error) {
    fail(res, error, "Error getting run");
  }
});

/**
 * The observations, over an optional tick window. Windowing is the caller's
 * job by the engine's contract, and the two aggregates window on different
 * columns, so this passes the bounds down rather than slicing one series.
 */
router.get("/:id/metrics", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const query = parseOr400(metricsWindowSchema, req.query, res);
    if (!query) return;

    res.json(
      await getRunMetrics(params.id, query.fromTick, query.toTick),
    );
  } catch (error) {
    fail(res, error, "Error getting run metrics");
  }
});

/**
 * The shop floor as it stands: what is at each center and how far along.
 * A snapshot, unlike `/metrics`, which is a rate over a window — the two
 * deliberately answer different questions.
 */
router.get("/:id/floor", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    res.json(await getRunFloor(params.id));
  } catch (error) {
    fail(res, error, "Error getting run floor");
  }
});

/** The raw per-tick series, for charting. Capped, newest kept. */
router.get("/:id/ticks", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const query = parseOr400(ticksQuerySchema, req.query, res);
    if (!query) return;

    res.json(await getRunTicks(params.id, query.fromTick, query.toTick, query.bucket));
  } catch (error) {
    fail(res, error, "Error getting run ticks");
  }
});

/**
 * Releases a work order onto the run's floor. `POST` to a sub-collection
 * rather than a `PUT`, since a release is an event that happens at a tick and
 * happens at most once — the 409 on a repeat is the run's own guard.
 */
router.post("/:id/releases", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const body = parseOr400(releaseWorkOrderSchema, req.body, res);
    if (!body) return;

    res.status(201).json(await releaseWorkOrder(params.id, body.workOrderId));
  } catch (error) {
    fail(res, error, "Error releasing work order");
  }
});

router.post("/:id/advance", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    const body = parseOr400(advanceRunSchema, req.body, res);
    if (!body) return;

    res.json(await advanceRun(params.id, body.ticks));
  } catch (error) {
    fail(res, error, "Error advancing run");
  }
});

/**
 * Clears a lock a dead process left behind. Not a reset: re-creating a run with
 * the same seed reproduces it exactly, so there is nothing to rewind.
 */
router.post("/:id/unlock", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    res.json(await unlockRun(params.id));
  } catch (error) {
    fail(res, error, "Error unlocking run");
  }
});

/**
 * Deletes a run and cascades its history. No `?force=true`: a run owns
 * everything that hangs off it, so nothing outside it is lost. A run another
 * run was forked from is a 409 and stays a 409 — losing the baseline a
 * comparison is against is not something to confirm past.
 */
router.delete("/:id", async (req, res) => {
  try {
    const params = parseOr400(idParamSchema, req.params, res);
    if (!params) return;

    // 200 with the row, as every other delete in the API does — the client's
    // `deleteJson` parses a body
    res.json(await deleteRun(params.id));
  } catch (error) {
    fail(res, error, "Error deleting run");
  }
});

export default router;
