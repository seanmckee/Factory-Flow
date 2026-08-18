import { createContext, useContext } from "react";
import type { Part } from "../types/Part";
import type { RoutingSummary } from "../types/Routing";
import type { SalesOrder } from "../types/SalesOrder";
import type { WorkOrder } from "../types/WorkOrder";

export type OrdersDataValue = {
  parts: Part[];
  routings: RoutingSummary[];
  salesOrders: SalesOrder[];
  workOrders: WorkOrder[];
  loading: boolean;
  error: string | null;
  refetchSalesOrders: () => Promise<void>;
  refetchWorkOrders: () => Promise<void>;
};

export const OrdersDataContext = createContext<OrdersDataValue | null>(null);

export function useOrdersData() {
  const value = useContext(OrdersDataContext);
  if (!value) {
    throw new Error("useOrdersData must be used inside an OrdersDataProvider");
  }
  return value;
}
