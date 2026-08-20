import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getJson } from "../api/client";
import { SetupDataContext } from "./SetupDataContext";
import type { Part } from "../types/Part";
import type { RoutingSummary } from "../types/Routing";
import type { WorkCenter } from "../types/WorkCenter";

/**
 * Shared across the factory setup pages. Parts and routings are loaded here
 * even though only work centers are edited today: the routing editor needs all
 * three lists at once, and deleting a work center is refused by naming the
 * routings that reference it.
 */
export default function SetupDataProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [routings, setRoutings] = useState<RoutingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchWorkCenters = useCallback(async () => {
    setWorkCenters(await getJson<WorkCenter[]>("/api/work-centers"));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const [workCenterData, partsData, routingsData] = await Promise.all([
          getJson<WorkCenter[]>("/api/work-centers"),
          getJson<Part[]>("/api/parts"),
          getJson<RoutingSummary[]>("/api/routings"),
        ]);

        if (cancelled) return;
        setWorkCenters(workCenterData);
        setParts(partsData);
        setRoutings(routingsData);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load setup data", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load setup data",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      workCenters,
      parts,
      routings,
      loading,
      error,
      refetchWorkCenters,
    }),
    [workCenters, parts, routings, loading, error, refetchWorkCenters],
  );

  return <SetupDataContext value={value}>{children}</SetupDataContext>;
}
