// 2026-11-22 00:00 Asia/Shanghai. This epoch stays fixed across all future sessions.
export const solLowStart = Date.UTC(2026, 10, 21, 16);
const quarter = 900000;
const minute = 60000;

function validPoint(p, start, end) {
  return Number.isFinite(p?.price) && p.price > 0 && Number.isSafeInteger(p.time) &&
    p.time >= start && p.time <= end && Number.isInteger(p.precisionMs) && p.precisionMs > 0;
}

function valid(s, anchor) {
  return Number.isSafeInteger(s?.asOf) && s.asOf >= anchor.asOf && validPoint(s.high,0,s.asOf) &&
    s.high.price >= anchor.high.price && (s.asOf < solLowStart ? s.low === null :
      validPoint(s.low,solLowStart,s.asOf) && s.low.price <= s.high.price);
}

function stored(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key,JSON.stringify(value)); } catch { /* Storage is optional. */ }
}

function combine(old, fresh) {
  if (!old || old.asOf > fresh.asOf) return fresh;
  const better = (a,b,sign) => !a ? b : !b ? a : a.price === b.price ?
    (a.time < b.time || (a.time === b.time && a.precisionMs <= b.precisionMs) ? a : b) : sign*a.price > sign*b.price ? a : b;
  return {...fresh,high:better(old.high,fresh.high,1),low:better(old.low,fresh.low,-1)};
}

export function createSolCycle({bridge,range,refinedPoint,contiguous}) {
  const checkpoints = new Map();
  const observations = new Map();
  return async function calculate(contract, anchor, state) {
    const {asOf,candles} = state;
    const key = 'sol-fixed-low-v1/'+contract.sourceId+'/'+solLowStart;
    const seed = valid(anchor.fixedLow,anchor) && anchor.fixedLow.asOf <= asOf ? anchor.fixedLow :
      {asOf:anchor.asOf,high:anchor.high,low:null};
    if (!checkpoints.has(key)) {
      const record = stored(key);
      checkpoints.set(key,record?.closed);
      observations.set(key,record?.observed);
    }
    let base = checkpoints.get(key);
    if (!valid(base,anchor) || (base.asOf+1)%quarter || base.asOf < seed.asOf || base.asOf > asOf) base = seed;
    const observed = observations.get(key);
    const known = valid(observed,anchor) && observed.asOf <= asOf ? observed : null;
    const last = candles.at(-1);
    if (!last || last.time>asOf || asOf-last.time>quarter+12000) throw Error('K 线时间待核实');
    const start = base.asOf+1;
    const tail = candles.filter(b=>b.time>=start).map(b=>({...b,width:quarter}));
    if (!tail.length) return base;
    contiguous(tail,tail[0].time,last.time+quarter,quarter);

    // A UTC daily candle straddling the Beijing boundary includes previous-cycle prices.
    // Split the gap first, so only data on or after the boundary enters the low.
    const gapEnd = tail[0].time;
    const split = Math.min(Math.max(solLowStart,start),gapEnd);
    const bars = [...await bridge(contract,start,split,asOf), ...await bridge(contract,split,gapEnd,asOf), ...tail];

    async function resolve(bar,kind,end) {
      const existing = known?.[kind];
      if (existing?.price===bar[kind] && existing.time>=bar.time && existing.time<bar.time+bar.width) return existing;
      const p = await refinedPoint(contract,bar,kind,end);
      if (kind!=='low') return p;
      // The quarter-hour price is certified even if finer public history is unavailable.
      const stop = Math.min(p.time+quarter,(Math.floor(end/minute)+1)*minute);
      try {
        const minutes = await range(contract,minute,p.time,stop,end);
        const first = minutes.find(b=>b.low===p.price);
        if (first) return {price:p.price,time:first.time,precisionMs:minute};
      } catch { /* The quote can still identify its 15-minute candle. */ }
      return p;
    }
    async function update(previous, rows, end) {
      let hi,lo;
      for (const b of rows) {
        if (b.high > previous.high.price && (!hi || b.high > hi.high)) hi=b;
        if (b.time>=solLowStart && (!previous.low || b.low<previous.low.price) && (!lo || b.low<lo.low)) lo=b;
      }
      return {asOf:end,high:hi ? await resolve(hi,'high',end) : previous.high,
        low:lo ? await resolve(lo,'low',end) : previous.low};
    }
    const current = last.time+quarter-1 > asOf;
    const closed = current ? bars.slice(0,-1) : bars;
    if (closed.length) {
      const b=closed.at(-1);
      base=await update(base,closed,b.time+b.width-1);
      base=combine(known,base);
    }
    const result=combine(known,current ? await update(base,[bars.at(-1)],asOf) : base);
    const previous=checkpoints.get(key);
    if ((!previous || base.asOf >= previous.asOf) && (!observed || result.asOf >= observed.asOf)) {
      checkpoints.set(key,base);
      observations.set(key,result);
      if (previous?.asOf!==base.asOf || observed?.low?.price!==result.low?.price || observed?.high?.price!==result.high.price) {
        save(key,{closed:base,observed:result});
      }
    }
    return result;
  };
}
