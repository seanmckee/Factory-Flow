import { Factory } from "lucide-react";

type Props = {
  name: string;
  queueCount: number;
  status: string;
};
function WorkCenter({ name, queueCount, status }: Props) {
  const statusColor =
    status === "Busy"
      ? "text-yellow-500"
      : status === "Idle"
        ? "text-green-500"
        : "text-red-500";
  return (
    <div>
      <div className="flex flex-col gap-2 border-2 border-black rounded-lg p-6 items-center w-72 h-40">
        <p className="flex gap-2 items-center">
          <Factory /> {name}
        </p>
        <div className="flex flex-col gap-2 p-6">
          <p className="flex gap-2 items-center">Queue Count: {queueCount}</p>
          <p className={statusColor}>Status: {status}</p>
        </div>
      </div>
    </div>
  );
}

export default WorkCenter;
