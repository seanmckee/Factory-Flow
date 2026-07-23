import { describe, it, expect } from "vitest";
import { simulateTick } from "./simulationTick";
import type { Routing } from "../types/Routing";
import type { WipPart } from "../types/WipPart";

const testRouting: Routing = {
  id: 1,
  partId: 1,
  name: "Test Routing",
  revision: "A",
  steps: [
    {
      id: 1,
      routingId: 1,
      workCenterId: 10,
      sequence: 1,
      processTimeSeconds: 5,
      setupTimeSeconds: 0,
    },
    {
      id: 2,
      routingId: 1,
      workCenterId: 20,
      sequence: 2,
      processTimeSeconds: 5,
      setupTimeSeconds: 0,
    },
  ],
};

describe("simulateTick", () => {
  it("advances a part's progress by 1 second per tick", () => {
    // Arrange
    const wipParts: WipPart[] = [
      { id: 1, workOrderId: 1, stepIndex: 0, progressSeconds: 0 },
    ];

    // Act
    const result = simulateTick(wipParts, testRouting);

    // Assert
    expect(result.wipParts[0].progressSeconds).toBe(1);
  });
  it("only advances one part per work center (capacity of 1)", () => {
    const wipParts: WipPart[] = [
      { id: 1, workOrderId: 1, stepIndex: 0, progressSeconds: 0 },
      { id: 2, workOrderId: 1, stepIndex: 0, progressSeconds: 0 },
    ];

    const result = simulateTick(wipParts, testRouting);

    expect(result.wipParts[0].progressSeconds).toBe(1);

    expect(result.wipParts[1].progressSeconds).toBe(0);
  });
  it("moves to next step when process time completes", () => {
    const wipParts: WipPart[] = [
      { id: 1, workOrderId: 1, stepIndex: 0, progressSeconds: 4 },
    ];
    const result = simulateTick(wipParts, testRouting);
    expect(result.wipParts[0].stepIndex).toBe(1);
    expect(result.wipParts[0].progressSeconds).toBe(0);
  });
  it("finished part leaves array and increases finishedParts", () => {
    const wipParts: WipPart[] = [
      { id: 1, workOrderId: 1, stepIndex: 1, progressSeconds: 4 },
    ];
    const result = simulateTick(wipParts, testRouting);
    expect(result.finishedParts).toBe(1);
    expect(result.wipParts.length).toBe(0);
  });
});
