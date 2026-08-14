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
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="tick" />
        <YAxis />
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