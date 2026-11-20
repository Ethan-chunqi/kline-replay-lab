// Pick a different section of the same series without inspecting any future prices.
export function pickRandomStart({
  length,
  currentIndex,
  previousStart,
  blockedStarts = [],
  blockedRanges = [],
  earliestStart = 0,
  latestStart = length - 2,
  random = Math.random,
}) {
  if (!Number.isSafeInteger(length) || length < 2) throw new RangeError('随机训练至少需要两根 K 线');
  const lastStart = length - 2;
  const warmup = Math.min(119, Math.floor(lastStart / 5));
  const earliest = Math.max(0, Math.min(earliestStart, lastStart));
  const latest = Math.max(earliest, Math.min(latestStart, Math.floor((length - 1) * 0.6), lastStart));
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

  let pool = available(Math.min(Math.max(earliest, warmup), latest), latest);
  if (!pool.length) pool = available(earliest, latest);
  // With fewer than four bars, both possible starts may already be anchors.
  if (!pool.length) return earliest;

  const untouched = pool.filter((i) => !blockedRanges.some(([from, to]) => i >= from && i <= to));
  if (untouched.length) pool = untouched;
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

// Draw across years before reusing a delivery month. Visits are recovered
// from saved training sessions so a refresh does not reset the rotation.
export function rankArchivePeriods(candidates, visits, random = Math.random) {
  const count = new Map(), years = new Map();
  for (const { key, year } of visits) {
    count.set(key, (count.get(key) || 0) + 1);
    years.set(year, (years.get(year) || 0) + 1);
  }
  return candidates.map((period) => ({
    period, visits: count.get(period.key) || 0, yearVisits: years.get(period.year) || 0, roll: random(),
  })).sort((a, b) => a.visits - b.visits || a.yearVisits - b.yearVisits || a.roll - b.roll)
    .map((entry) => entry.period);
}

// Find the first and last bars belonging to days already practiced. Intraday
// positions taken on a different chart interval still reserve the same days.
export function visitedBarRanges(bars, dateSpans, dayOf) {
  function boundary(day, after) {
    let left = 0, right = bars.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      const dayAtBar = dayOf(bars[middle].time);
      if (dayAtBar < day || (after && dayAtBar === day)) left = middle + 1;
      else right = middle;
    }
    return left;
  }
  return dateSpans.map(([start, end]) => [boundary(start, false), boundary(end, true) - 1])
    .filter(([a, b]) => a <= b);
}
