/* eslint-disable react-refresh/only-export-components -- route-level lazy imports live at the router boundary */
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import App from "./App";
import SimulationPage from "./pages/SimulationPage";
import "./index.css";

const OrdersLayout = lazy(() => import("./pages/orders/OrdersLayout"));
const SalesOrdersPage = lazy(() => import("./pages/orders/SalesOrdersPage"));
const WorkOrdersPage = lazy(() => import("./pages/orders/WorkOrdersPage"));
const SetupLayout = lazy(() => import("./pages/setup/SetupLayout"));
const WorkCentersPage = lazy(() => import("./pages/setup/WorkCentersPage"));
const PartsPage = lazy(() => import("./pages/setup/PartsPage"));
const RoutingsPage = lazy(() => import("./pages/setup/RoutingsPage"));
const FactorySettingsPage = lazy(
  () => import("./pages/setup/FactorySettingsPage"),
);

function deferred(page: React.ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading page…
        </div>
      }
    >
      {page}
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <SimulationPage /> },
      {
        path: "orders",
        element: deferred(<OrdersLayout />),
        children: [
          { index: true, element: <Navigate to="sales" replace /> },
          { path: "sales", element: deferred(<SalesOrdersPage />) },
          { path: "work", element: deferred(<WorkOrdersPage />) },
        ],
      },
      {
        path: "setup",
        element: deferred(<SetupLayout />),
        children: [
          { index: true, element: <Navigate to="work-centers" replace /> },
          { path: "work-centers", element: deferred(<WorkCentersPage />) },
          { path: "parts", element: deferred(<PartsPage />) },
          { path: "routings", element: deferred(<RoutingsPage />) },
          { path: "settings", element: deferred(<FactorySettingsPage />) },
        ],
      },
      // /create was the old stub page
      { path: "create", element: <Navigate to="/orders/sales" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
