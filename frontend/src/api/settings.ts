import { getJson, patchJson } from "./client";

/** The live facility-level cost rates; a run freezes its own copy at creation. */
export type FactorySettings = {
  id: number;
  facilityOverheadCentsPerDay: number;
  /** basis points of on-floor material value per day (100 = 1%/day) */
  wipCarryingBpsPerDay: number;
  /** staffed 8-hour shifts per calendar day (1-3); a run freezes day_ticks from it */
  shifts: number;
};

export const getSettings = () => getJson<FactorySettings>("/api/settings");

export const patchSettings = (
  updates: Partial<Omit<FactorySettings, "id">>,
) => patchJson<FactorySettings>("/api/settings", updates);
