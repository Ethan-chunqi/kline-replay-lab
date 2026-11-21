// Only contracts for which this site has source-specific quotes and historical baselines.
const common=['binance-usdm','bybit-linear'];
export const perpetualSources=Object.fromEntries([
  ...['BTC','BNB','HYPE','SOL','ZEC'].map(base=>[base+'USDT',common]),
  ['OKBUSDT',['bybit-linear']],['BGBUSDT',['bitget-usdt']],
]);
export const venueNames={'binance-usdm':'Binance','bybit-linear':'Bybit','bitget-usdt':'Bitget'};
export const bitgetBase='https://api.bitget.com/api/v2/mix/market/';
export function bitgetPath(path,symbol,params={}) {
  return bitgetBase+path+'?'+new URLSearchParams({productType:'USDT-FUTURES',symbol,...params});
}

// Bitget's /candles includes the open candle. /history-candles uses an exclusive
// end timestamp, allows 200 rows, and serves older minute data in UTC.
export async function bitgetKlines(symbol,interval,start,end,count,read) {
  const width={'1m':60000,'15m':900000,'30m':1800000,'1h':3600000,'1d':86400000}[interval];
  const granularity=({'1d':'1Dutc','1h':'1H'})[interval] || interval;
  const endBucket=Math.floor(end/width)*width;
  const from=start ?? Math.max(0,endBucket-(count-1)*width);
  const rows=[];
  for(let cursor=from;cursor<=endBucket;) {
    const stop=Math.min(endBucket+width,cursor+(width===86400000?85:200)*width);
    const latest=stop>Date.now()-width;
    const raw=await read(bitgetPath(latest?'candles':'history-candles',symbol,{
      granularity,startTime:cursor,endTime:Math.min(stop,Date.now()),limit:Math.round((stop-cursor)/width),
    }));
    if(raw.code!=='00000' || !Array.isArray(raw.data))throw Error('Invalid Bitget perpetual data');
    rows.push(...raw.data.filter(r=>+r[0]>=cursor && +r[0]<stop));cursor=stop;
  }
  return rows;
}
