import type { Part } from "../types/Part";
type PartsListProps = {
  parts: Part[];
};
export default function PartsList({ parts }: PartsListProps) {
  return (
    <div>
      <h1>Parts</h1>
      {parts.map((part) => (
        <p key={part.id}>
          {part.partNumber}: {part.name}
        </p>
      ))}
    </div>
  );
}
