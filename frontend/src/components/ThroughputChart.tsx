import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ThroughputSample = {
  tick: number;
  cents: number;
};

/**
 * Colours come from the theme's CSS variables rather than literals, so the
 * chart follows the token layer like everything else.
 */
export default function ThroughputChart({
  data,
}: {
  data: ThroughputSample[];
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
          tickFormatter={(cents: number) => (cents / 100).toFixed(0)}
          label={{
            value: "Cumulative Throughput ($)",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
            fill: "var(--muted-foreground)",
          }}
        />
        <Tooltip
          formatter={(cents) => [`$${(Number(cents) / 100).toFixed(2)}`, "Throughput"]}
          labelFormatter={(tick) => `Tick ${Number(tick).toLocaleString()}`}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--popover-foreground)",
          }}
        />
        <Line
          type="monotone"
          dataKey="cents"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
