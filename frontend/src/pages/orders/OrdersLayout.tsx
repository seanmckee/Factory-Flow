import { Outlet } from "react-router-dom";
import OrdersDataProvider from "../../orders/OrdersDataProvider";

/**
 * Owns the data shared by the order entry pages. Navigating between sales and
 * work orders keeps this mounted (no refetch); arriving from the simulator
 * remounts it, so the lists are fresh.
 */
export default function OrdersLayout() {
  return (
    <OrdersDataProvider>
      <div className="h-full overflow-hidden p-6">
        <Outlet />
      </div>
    </OrdersDataProvider>
  );
}
