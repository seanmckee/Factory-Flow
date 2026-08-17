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
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="tick"
          label={{ value: "Tick", position: "insideBottom", offset: -18 }}
        />
        <YAxis
          width={64}
          tickFormatter={(cents: number) => (cents / 100).toFixed(0)}
          label={{
            value: "Cumulative Throughput ($)",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
          }}
        />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="cents"
          stroke="#3b82f6"
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
