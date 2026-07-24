import { NavLink } from "react-router-dom";

function Navbar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "px-3 py-2 rounded-md font-medium bg-slate-200 text-slate-900"
      : "px-3 py-2 rounded-md font-medium text-slate-600 hover:bg-slate-100";

  return (
    <nav className="flex gap-2 items-center border-b border-slate-300 px-6 py-3">
      <span className="font-bold mr-4">Factory Flow</span>
      <NavLink to="/" className={linkClass}>
        Simulator
      </NavLink>
      <NavLink to="/create" className={linkClass}>
        Create
      </NavLink>
    </nav>
  );
}

export default Navbar;
