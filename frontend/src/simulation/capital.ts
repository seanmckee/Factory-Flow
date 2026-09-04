import type { CapitalActionKind } from "../api/runs";

/** What each action is called in a toast and in the dashboard's log. */
export const CAPITAL_LABELS: Record<CapitalActionKind, string> = {
  buy_machine: "Bought a machine",
  retire_machine: "Retired a machine",
  hire_operator: "Hired an operator",
  fire_operator: "Let an operator go",
};

/**
 * Capital in words. A purchase costs, a retirement returns (salvage is a
 * negative spend on the server, and the direction is the thing to read at a
 * glance), and letting an operator go is **free** — which is the whole point
 * of the temp lever, so it says so rather than printing $0.00 and leaving the
 * reader to wonder whether the number failed to load.
 */
export function formatSpend(cents: number): string {
  if (cents === 0) return "no cost";
  const amount = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  return cents > 0 ? `${amount} out` : `${amount} back`;
}
