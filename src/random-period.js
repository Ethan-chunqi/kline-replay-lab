// Pick a different section of the same series without inspecting any future prices.
export function pickRandomStart({
  length,
  currentIndex,
  previousStart,
  blockedStarts = [],
  random = Math.random,
}) {
  if (!Number.isSafeInteger(length) || length < 2) throw new RangeError('随机训练至少需要两根 K 线');
  const lastStart = length - 2;
  const warmup = Math.min(119, Math.floor(lastStart / 5));
  const future = Math.min(60, Math.max(1, Math.floor(length / 4)));
  const latest = length - 1 - future;
  const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < length;
  const anchors = [currentIndex, previousStart].filter(validIndex);
  const visited = new Set([...blockedStarts].filter(validIndex));

  function available(from, to) {
    const result = [];
    for (let i = from; i <= to; i++) {
      if (!anchors.includes(i)) result.push(i);
    }
    return result;
  }

  let pool = available(warmup, latest);
  if (!pool.length) pool = available(0, lastStart);
  // With fewer than four bars, both possible starts may already be anchors.
  if (!pool.length) return currentIndex === 0 && lastStart > 0 ? 1 : 0;

  const fresh = pool.filter((i) => !visited.has(i));
  // Once every available start has been tried, maintain distance from the active segment.
  const references = fresh.length ? [...new Set([...anchors, ...visited])] : anchors;
  if (fresh.length) pool = fresh;

  if (references.length) {
    references.sort((a, b) => a - b);
    const targetGap = Math.min(60, Math.max(2, Math.round((latest - warmup + 1) / 8)));
    let pointer = 0;
    let largestGap = 0;
    // Both lists are sorted. Sweep once to find the nearest prior start for each candidate.
    const gaps = pool.map((i) => {
      while (
        pointer + 1 < references.length &&
        Math.abs(i - references[pointer + 1]) <= Math.abs(i - references[pointer])
      )
        pointer++;
      const gap = Math.abs(i - references[pointer]);
      largestGap = Math.max(largestGap, gap);
      return gap;
    });
    const minGap = largestGap >= targetGap ? targetGap : Math.ceil(largestGap * 0.7);
    pool = pool.filter((_, i) => gaps[i] >= minGap);
  }

  const roll = random();
  if (!Number.isFinite(roll)) throw new RangeError('随机数无效');
  const index = Math.max(0, Math.min(pool.length - 1, Math.floor(roll * pool.length)));
  return pool[index];
}
