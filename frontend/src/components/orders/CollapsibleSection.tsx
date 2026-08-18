import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type CollapsibleSectionProps = {
  title: string;
  count: number;
  children: ReactNode;
};

/** Collapsed by default - the form is the point of the page, the list is reference. */
export default function CollapsibleSection({
  title,
  count,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex gap-2 items-center px-3 py-2 rounded-lg font-medium text-slate-700 hover:bg-slate-200"
      >
        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        {isOpen ? "Hide" : "Show"} {title} ({count})
      </button>

      {isOpen && <div className="mt-3">{children}</div>}
    </div>
  );
}
