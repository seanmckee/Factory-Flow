import { Outlet } from "react-router-dom";
import SetupDataProvider from "../../setup/SetupDataProvider";

/**
 * Owns the data shared by the factory setup pages. Mirrors OrdersLayout:
 * navigating between setup pages keeps this mounted (no refetch); arriving
 * from elsewhere remounts it, so the lists are fresh.
 */
export default function SetupLayout() {
  return (
    <SetupDataProvider>
      <div className="p-6">
        <Outlet />
      </div>
    </SetupDataProvider>
  );
}
