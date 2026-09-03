import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export type TickPoint = {
  tick: number;
  value: number;
};

/**
 * One line over the run's tick series — the cumulative curve, the rate and the
 * WIP chart are all this component with different data and formatters, so the
 * recharts boilerplate lives once.
 *
 * Colours come from the theme's CSS variables rather than literals, so the
 * chart follows the token layer like everything else.
 */
export default function TickSeriesChart({
  data,
  yLabel,
  tooltipLabel,
  formatValue,
  formatAxis,
  stroke = "var(--chart-1)",
  type = "monotone",
}: {
  data: TickPoint[];
  yLabel: string;
  tooltipLabel: string;
  formatValue: (value: number) => string;
  formatAxis: (value: number) => string;
  stroke?: string;
  /** `stepAfter` for integer series like WIP — parts don't move fractionally. */
  type?: "monotone" | "stepAfter";
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={{ top: 12, right: 16, left: 8, bottom: 28 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="tick"
          stroke="var(--muted-foreground)"
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          label={{
            value: "Tick",
            position: "insideBottom",
            offset: -18,
            fill: "var(--muted-foreground)",
          }}
        />
        <YAxis
          width={64}
          stroke="var(--muted-foreground)"
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickFormatter={formatAxis}
          label={{
            value: yLabel,
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
            fill: "var(--muted-foreground)",
          }}
        />
        <Tooltip
          formatter={(value) => [formatValue(Number(value)), tooltipLabel]}
          labelFormatter={(tick) => `Tick ${Number(tick).toLocaleString()}`}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--popover-foreground)",
          }}
        />
        <Line
          type={type}
          dataKey="value"
          stroke={stroke}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
