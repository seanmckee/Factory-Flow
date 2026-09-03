import { Outlet } from "react-router-dom";
import Navbar from "./components/NavBar";
import ToastProvider from "./toast/ToastProvider";

/**
 * The app owns exactly one viewport: pages never scroll the window. Each page
 * lays out `h-full` and scrolls its own regions (the convention CLAUDE.md
 * documents), so controls are always on screen.
 */
function App() {
  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        <Navbar />
        {/* min-w-0 keeps wide children (the chart, tables) from overflowing */}
        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
