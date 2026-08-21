import { NavLink } from "react-router-dom";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? "block px-3 py-2 rounded-md font-medium bg-slate-200 text-slate-900"
    : "block px-3 py-2 rounded-md font-medium text-slate-600 hover:bg-slate-100";

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pt-4 pb-1 text-xs uppercase tracking-wide text-slate-400">
      {children}
    </p>
  );
}

function Navbar() {
  return (
    <nav className="w-56 shrink-0 border-r border-slate-300 bg-white px-3 py-4">
      <span className="block px-3 pb-2 font-bold">Factory Flow</span>

      <NavLink to="/" end className={linkClass}>
        Simulator
      </NavLink>

      <SectionLabel>Orders</SectionLabel>
      <NavLink to="/orders/sales" className={linkClass}>
        Sales Orders
      </NavLink>
      <NavLink to="/orders/work" className={linkClass}>
        Work Orders
      </NavLink>

      <SectionLabel>Setup</SectionLabel>
      <NavLink to="/setup/work-centers" className={linkClass}>
        Work Centers
      </NavLink>
      <NavLink to="/setup/parts" className={linkClass}>
        Parts
      </NavLink>
      <NavLink to="/setup/routings" className={linkClass}>
        Routings
      </NavLink>
    </nav>
  );
}

export default Navbar;
