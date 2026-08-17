export function cumulativeThroughput(
  history: { tick: number; cents: number }[],
): { tick: number; cents: number }[] {
  let running = 0;
  return history.map((sample) => {
    running += sample.cents;
    return { tick: sample.tick, cents: running };
  });
}
