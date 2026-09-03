import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  Factory,
  Gauge,
  Package,
  Route,
  ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";

function Item({
  to,
  end,
  icon: Icon,
  children,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  children: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {children}
    </NavLink>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
      {children}
    </p>
  );
}

function Navbar() {
  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4">
      <div className="flex items-center gap-2 px-3 pb-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Factory className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">Factory Flow</span>
      </div>

      <Item to="/" end icon={Gauge}>
        Simulator
      </Item>

      <SectionLabel>Orders</SectionLabel>
      <Item to="/orders/sales" icon={ShoppingCart}>
        Sales Orders
      </Item>
      <Item to="/orders/work" icon={ClipboardList}>
        Work Orders
      </Item>

      <SectionLabel>Setup</SectionLabel>
      <Item to="/setup/work-centers" icon={Factory}>
        Work Centers
      </Item>
      <Item to="/setup/parts" icon={Package}>
        Parts
      </Item>
      <Item to="/setup/routings" icon={Route}>
        Routings
      </Item>
    </nav>
  );
}

export default Navbar;
