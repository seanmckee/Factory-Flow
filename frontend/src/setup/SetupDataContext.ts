import { createContext, useContext } from "react";
import type { Part } from "../types/Part";
import type { RoutingSummary } from "../types/Routing";
import type { WorkCenter } from "../types/WorkCenter";

export type SetupDataValue = {
  workCenters: WorkCenter[];
  parts: Part[];
  routings: RoutingSummary[];
  loading: boolean;
  error: string | null;
  refetchWorkCenters: () => Promise<void>;
  refetchParts: () => Promise<void>;
  refetchRoutings: () => Promise<void>;
};

export const SetupDataContext = createContext<SetupDataValue | null>(null);

export function useSetupData() {
  const value = useContext(SetupDataContext);
  if (!value) {
    throw new Error("useSetupData must be used inside a SetupDataProvider");
  }
  return value;
}
