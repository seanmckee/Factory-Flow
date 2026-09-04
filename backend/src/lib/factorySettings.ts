import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { factorySettings } from "../db/schema.js";

export type FactorySettingsRow = typeof factorySettings.$inferSelect;

/** The singleton's one row id — the app never addresses another. */
const SETTINGS_ID = 1;

/**
 * Reads the settings singleton, creating the id=1 row from the column defaults
 * the first time anything asks. Upsert-then-select rather than a fallback
 * object, so a run created before any settings edit still freezes a row that
 * exists — the same explicit-copy rule as `run_work_centers`.
 */
export async function getFactorySettings(): Promise<FactorySettingsRow> {
  await db
    .insert(factorySettings)
    .values({ id: SETTINGS_ID })
    .onConflictDoNothing();

  const [settings] = await db
    .select()
    .from(factorySettings)
    .where(eq(factorySettings.id, SETTINGS_ID));
  if (!settings) throw new Error("Factory settings upsert failed");
  return settings;
}

export async function updateFactorySettings(updates: {
  facilityOverheadCentsPerDay?: number;
  wipCarryingBpsPerDay?: number;
  shifts?: number;
}): Promise<FactorySettingsRow> {
  // ensure the row exists so the first PATCH isn't a silent no-op
  await getFactorySettings();

  const [updated] = await db
    .update(factorySettings)
    .set(updates)
    .where(eq(factorySettings.id, SETTINGS_ID))
    .returning();
  if (!updated) throw new Error("Factory settings update failed");
  return updated;
}
