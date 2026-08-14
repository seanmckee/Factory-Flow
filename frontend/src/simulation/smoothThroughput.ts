export function smoothThroughput(
    history: { tick: number; cents: number }[],
    windowSize: number,
  ): { tick: number; cents: number }[] {
    return history.map((sample, i) => {
        const window = history.slice(Math.max(0, i - windowSize + 1), i + 1);
        const total = window.reduce((acc, s) => acc + s.cents, 0);
        return { tick: sample.tick, cents: total/window.length};
    });
  }