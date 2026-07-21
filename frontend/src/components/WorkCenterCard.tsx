import { Factory } from "lucide-react";

type WorkCenterCardProps = {
  name: string;
  queueCount: number;
};

function WorkCenterCard({ name, queueCount }: WorkCenterCardProps) {
  const status = queueCount > 0 ? "Running" : "Starved";
  const statusColor = queueCount > 0 ? "text-green-500" : "text-slate-500";

  return (
    <div className="flex flex-col gap-2 border-2 border-black rounded-lg p-6 items-center w-72">
      <p className="flex gap-2 items-center">
        <Factory /> {name}
      </p>
      <p className="flex gap-2 items-center">Queue Count: {queueCount}</p>
      <p className={statusColor}>Status: {status}</p>
    </div>
  );
}

export default WorkCenterCard;
