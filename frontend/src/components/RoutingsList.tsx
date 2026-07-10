import type { Routing } from "../types/Routing";
type RoutingsListProps = {
  routings: Routing[];
};
export default function RoutingsList({ routings }: RoutingsListProps) {
  return (
    <div>
      <h1>Routings</h1>
      {routings.map((routing) => (
        <p></p>
      ))}
    </div>
  );
}
