import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getJson } from "../api/client";
import { OrdersDataContext } from "./OrdersDataContext";
import type { Part } from "../types/Part";
import type { RoutingSummary } from "../types/Routing";
import type { SalesOrder } from "../types/SalesOrder";
import type { WorkOrder } from "../types/WorkOrder";

/**
 * Shared across the order entry pages. Creating a work order changes sales order
 * allocation totals, so both lists have to refetch together - keeping them in one
 * provider avoids cross-page cache invalidation.
 */
export default function OrdersDataProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [parts, setParts] = useState<Part[]>([]);
  const [routings, setRoutings] = useState<RoutingSummary[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetchSalesOrders = useCallback(async () => {
    setSalesOrders(await getJson<SalesOrder[]>("/api/sales-orders"));
  }, []);

  const refetchWorkOrders = useCallback(async () => {
    setWorkOrders(await getJson<WorkOrder[]>("/api/work-orders"));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const [partsData, routingsData, salesOrderData, workOrderData] =
          await Promise.all([
            getJson<Part[]>("/api/parts"),
            getJson<RoutingSummary[]>("/api/routings"),
            getJson<SalesOrder[]>("/api/sales-orders"),
            getJson<WorkOrder[]>("/api/work-orders"),
          ]);

        if (cancelled) return;
        setParts(partsData);
        setRoutings(routingsData);
        setSalesOrders(salesOrderData);
        setWorkOrders(workOrderData);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load order data", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load order data",
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
      parts,
      routings,
      salesOrders,
      workOrders,
      loading,
      error,
      refetchSalesOrders,
      refetchWorkOrders,
    }),
    [
      parts,
      routings,
      salesOrders,
      workOrders,
      loading,
      error,
      refetchSalesOrders,
      refetchWorkOrders,
    ],
  );

  return <OrdersDataContext value={value}>{children}</OrdersDataContext>;
}
