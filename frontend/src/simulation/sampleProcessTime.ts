const MIN_DURATION = 1;

export function sampleProcessTime(
  originalTime: number,
  deviation: number,
): number {
  const factor = 1 + (Math.random() * 2 - 1) * deviation;
  const result = Math.max(MIN_DURATION, Math.round(originalTime * factor));
  console.log("nominal:", originalTime, "→ actual:", result);
  return result;
}
