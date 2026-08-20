import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import App from "./App";
import SimulationPage from "./pages/SimulationPage";
import OrdersLayout from "./pages/orders/OrdersLayout";
import SalesOrdersPage from "./pages/orders/SalesOrdersPage";
import WorkOrdersPage from "./pages/orders/WorkOrdersPage";
import SetupLayout from "./pages/setup/SetupLayout";
import WorkCentersPage from "./pages/setup/WorkCentersPage";
import "./index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <SimulationPage /> },
      {
        path: "orders",
        element: <OrdersLayout />,
        children: [
          { index: true, element: <Navigate to="sales" replace /> },
          { path: "sales", element: <SalesOrdersPage /> },
          { path: "work", element: <WorkOrdersPage /> },
        ],
      },
      {
        path: "setup",
        element: <SetupLayout />,
        children: [
          { index: true, element: <Navigate to="work-centers" replace /> },
          { path: "work-centers", element: <WorkCentersPage /> },
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
