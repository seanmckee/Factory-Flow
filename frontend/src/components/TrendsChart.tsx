import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCents, formatSignedCents } from "../orders/salesOrderMath";
import { formatTickShort, formatTickTime } from "../simulation/simTime";

/** One tick's four vitals, pre-derived by the page from one `/ticks` response. */
export type TrendsPoint = {
  tick: number;
  /** cumulative throughput, cents */
  throughput: number;
  /** cumulative net profit, cents — can be negative */
  net: number;
  /** trailing-hour earning rate, cents per staffed hour */
  rate: number;
  /** parts on the floor at this tick */
  wip: number;
};

type SeriesKey = "throughput" | "net" | "rate" | "wip";

/**
 * The relationships are the point, so the four series share one clock: money
 * on the left axis (cumulative and per-hour magnitudes sit within a decade of
 * each other in practice), parts on the right. What doesn't share is hidden by
 * clicking its legend entry — WIP rising against a flat rate, or net sagging
 * under a climbing throughput, is exactly the read three separate cards made
 * the viewer assemble by eye.
 */
const SERIES: {
  key: SeriesKey;
  label: string;
  axis: "money" | "parts";
  stroke: string;
  /** stepAfter for integer series — parts don't move fractionally */
  type: "monotone" | "stepAfter";
  format: (value: number) => string;
}[] = [
  {
    key: "throughput",
    label: "Throughput ($)",
    axis: "money",
    stroke: "var(--chart-1)",
    type: "monotone",
    format: formatSignedCents,
  },
  {
    key: "net",
    label: "Net profit ($)",
    axis: "money",
    stroke: "var(--chart-4)",
    type: "monotone",
    format: formatSignedCents,
  },
  {
    key: "rate",
    label: "Rate ($/hr)",
    axis: "money",
    stroke: "var(--chart-2)",
    type: "monotone",
    format: (value) => `${formatCents(value)}/hr`,
  },
  {
    key: "wip",
    label: "WIP (parts)",
    axis: "parts",
    stroke: "var(--chart-3)",
    type: "stepAfter",
    format: (value) => `${Math.round(value).toLocaleString()} parts`,
  },
];

const formatBySeries = new Map(SERIES.map((s) => [s.key as string, s.format]));

export default function TrendsChart({
  data,
  dayTicks,
}: {
  data: TrendsPoint[];
  /** the run's frozen day length, for the Day · time axis and tooltip */
  dayTicks: number;
}) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());

  const toggle = (key: SeriesKey) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // never hide the last visible line — a blank chart reads as a bug
      return next.size === SERIES.length ? current : next;
    });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="tick"
          stroke="var(--muted-foreground)"
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickFormatter={(tick) => formatTickShort(Number(tick), dayTicks)}
          minTickGap={48}
        />
        <YAxis
          yAxisId="money"
          width={64}
          stroke="var(--muted-foreground)"
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickFormatter={(cents) => `$${Math.round(Number(cents) / 100).toLocaleString()}`}
        />
        <YAxis
          yAxisId="parts"
          orientation="right"
          width={48}
          stroke="var(--muted-foreground)"
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickFormatter={(parts) => Number(parts).toLocaleString()}
        />
        <Tooltip
          formatter={(value, name, item) => [
            (formatBySeries.get(String(item.dataKey)) ?? String)(Number(value)),
            String(name),
          ]}
          labelFormatter={(tick) => formatTickTime(Number(tick), dayTicks)}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--popover-foreground)",
          }}
        />
        <Legend
          onClick={(entry) => toggle(entry.dataKey as SeriesKey)}
          formatter={(label, entry) => (
            <span
              style={{
                color:
                  entry.dataKey && hidden.has(entry.dataKey as SeriesKey)
                    ? "var(--muted-foreground)"
                    : "var(--foreground)",
                textDecoration:
                  entry.dataKey && hidden.has(entry.dataKey as SeriesKey)
                    ? "line-through"
                    : "none",
              }}
            >
              {label}
            </span>
          )}
          wrapperStyle={{ cursor: "pointer", paddingTop: 8 }}
        />
        <ReferenceLine
          yAxisId="money"
          y={0}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
        />
        {SERIES.map((series) => (
          <Line
            key={series.key}
            yAxisId={series.axis}
            type={series.type}
            dataKey={series.key}
            name={series.label}
            stroke={series.stroke}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            hide={hidden.has(series.key)}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
