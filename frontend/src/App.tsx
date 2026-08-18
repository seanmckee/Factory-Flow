import { Outlet } from "react-router-dom";
import Navbar from "./components/NavBar";
import ToastProvider from "./toast/ToastProvider";

function App() {
  return (
    <ToastProvider>
      <div className="min-h-screen flex bg-slate-100">
        <Navbar />
        {/* min-w-0 keeps wide children (the chart, the card grid) from overflowing */}
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
