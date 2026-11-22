#!/usr/bin/env python3
"""Build exchange-specific base-coin volume checkpoints from verified closed perpetual bars."""
import argparse
import csv
import datetime as dt
import gzip
import io
import json
import os
import subprocess
import tempfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D
from pathlib import Path
from urllib.parse import urlencode
from build_crypto_year import request

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE / 'dist' if (HERE / 'dist').exists() else HERE
M, Q, DAY = 60_000, 900_000, 86_400_000
WIDTHS = {M:'1m', Q:'15m', DAY:'1d'}


def bars(symbol, source, step, start, end):
    if start >= end:
        return []
    limit = (85 if step == DAY else 200) if source == 'bitget-usdt' else 1000
    rows = []
    for left in range(start,end,step*limit):
        stop=min(end,left+step*limit)
        n=(stop-left)//step
        if source=='binance-usdm':
            url='https://fapi.binance.com/fapi/v1/klines?'+urlencode(dict(symbol=symbol,interval=WIDTHS[step],startTime=left,endTime=stop-1,limit=n))
            page=request(url)
            assert all(int(r[6])==int(r[0])+step-1 for r in page)
        elif source=='bybit-linear':
            url='https://api.bybit.com/v5/market/kline?'+urlencode(dict(category='linear',symbol=symbol,interval={M:'1',Q:'15',DAY:'D'}[step],start=left,end=stop-1,limit=n))
            raw=request(url)
            assert raw['retCode']==0 and raw['result']['category']=='linear' and raw['result']['symbol']==symbol
            page=raw['result']['list']
        else:
            route='history-candles'
            url='https://api.bitget.com/api/v2/mix/market/'+route+'?'+urlencode(dict(productType='USDT-FUTURES',symbol=symbol,granularity='1Dutc' if step==DAY else WIDTHS[step],startTime=left,endTime=stop,limit=n))
            raw=request(url)
            assert raw['code']=='00000';page=raw['data']
        part=sorted((int(r[0]),D(r[2]),D(r[3]),D(r[5])) for r in page if left<=int(r[0])<stop)
        if [r[0] for r in part]!=list(range(left,stop,step)) or any(r[3]<0 for r in part):
            raise ValueError(f'{symbol} {source}: incomplete {step}ms range {left}..{stop}')
        rows.extend(part)
    return rows


def total_after(symbol,source,start,end):
    assert start%M==end%M==0 and start<=end
    volume=D(0)
    for step in [Q,DAY]:
        boundary=min(end,((start+step-1)//step)*step)
        volume+=sum(r[3] for r in bars(symbol,source,M if step==Q else Q,start,boundary))
        start=boundary
    for step in [DAY,Q,M]:
        stop=end//step*step
        if stop>start:
            volume+=sum(r[3] for r in bars(symbol,source,step,start,stop))
            start=stop
    assert start==end
    return volume


def trade_evidence(source,minute,price,bar_volume,cache):
    """Check every execution in the minute against its official base volume."""
    day=dt.datetime.fromtimestamp(minute/1000,dt.timezone.utc).date().isoformat()
    if source=='binance-usdm':
        name=f'BTCUSDT-trades-{day}.zip'
        url='https://data.binance.vision/data/futures/um/daily/trades/BTCUSDT/'+name
    else:
        name=f'BTCUSDT{day}.csv.gz';url='https://public.bybit.com/trading/BTCUSDT/'+name
    file=cache/name
    if not file.exists():
        tmp=cache/(name+'.part')
        code=subprocess.run(['curl','-sLf','--retry','2','--connect-timeout','8','--max-time','150',url,'-o',str(tmp)]).returncode
        if code:
            tmp.unlink(missing_ok=True)
            return None
        os.replace(tmp,file)
    from contextlib import ExitStack
    with ExitStack() as stack:
        if source=='binance-usdm':
            z=stack.enter_context(zipfile.ZipFile(file))
            text=stack.enter_context(io.TextIOWrapper(z.open(z.namelist()[0])))
            rows=csv.reader(text);header=next(rows)
            assert header[:5]==['id','price','qty','quote_qty','time'],header
            time_col,price_col,size_col=4,1,2
        else:
            text=stack.enter_context(gzip.open(file,'rt'))
            rows=csv.reader(text);header=next(rows)
            time_col,price_col,size_col=map(header.index,['timestamp','price','size'])
        stamp=None;entire=D(0);after=D(0)
        for row in rows:
            t=int(row[time_col]) if source=='binance-usdm' else int(D(row[time_col])*1000)
            if t<minute:continue
            if t>=minute+M:break
            size=D(row[size_col]);entire+=size
            if stamp is None and D(row[price_col])==price:stamp=t
            if stamp is not None:after+=size
    if stamp is not None and entire==bar_volume:return stamp,after,url
    print('Minute basis (trade and kline coverage differ):',source,day,entire,bar_volume,flush=True)
    return None


def recent_aggregates(minute,price,bar_volume):
    endpoint='https://fapi.binance.com/fapi/v1/aggTrades?'
    source=endpoint+urlencode(dict(symbol='BTCUSDT',startTime=minute,endTime=minute+M-1,limit=1000))
    url=source;rows=[]
    while True:
        page=request(url)
        if not isinstance(page,list) or not page:break
        rows.extend(r for r in page if minute<=r['T']<minute+M)
        if page[-1]['T']>=minute+M or len(page)<1000:break
        url=endpoint+urlencode(dict(symbol='BTCUSDT',fromId=page[-1]['a']+1,limit=1000))
    if sum(D(r['q']) for r in rows)!=bar_volume or any(y['a']!=x['a']+1 for x,y in zip(rows,rows[1:])):return None
    idx=next((i for i,r in enumerate(rows) if D(r['p'])==price),None)
    if idx is None:return None
    r=rows[idx]
    return r['T'],sum(D(a['q']) for a in rows[idx:]),source,1 if r['f']==r['l'] else 100


def build(job,cache,now):
    symbol,source,anchor,snapshot=job
    end=(now//Q)*Q
    reference_end=snapshot['asOf']//Q*Q
    candidates=[]
    def add(kind,p):
        key=kind,p['time'],D(str(p['price'])),p.get('precisionMs',M)
        if key not in candidates:candidates.append(key)
    add('high',anchor['high'])
    base=anchor.get('fixedLow',anchor)
    add('low',base['low'])
    tick_start=(base['asOf']+1)//Q*Q
    latest=bars(symbol,source,Q,tick_start,end)
    for cutoff in sorted({max(tick_start,reference_end),end}):
        market=[r for r in latest if r[0]<cutoff]
        if market:
            low=min(market,key=lambda r:r[2])
            if low[2]<D(str(base['low']['price'])):add('low',dict(time=low[0],price=low[2],precisionMs=Q))
    rows=[]
    for kind,first,price,precision in candidates:
        width=min(precision,Q)
        series=bars(symbol,source,M,first,first+width)
        point=next(r for r in series if r[1 if kind=='high' else 2]==price)
        minute=point[0];start=minute;res=M;partial=point[3];proof=None
        if symbol=='BTCUSDT':
            evidence=trade_evidence(source,minute,price,partial,cache)
            if not evidence and source=='binance-usdm' and now-minute<2*DAY:
                evidence=recent_aggregates(minute,price,partial)
            if evidence:
                start,partial,proof=evidence[:3];res=evidence[3] if len(evidence)==4 else 1
        until=max(reference_end,((minute+M+Q-1)//Q)*Q)
        if until>end:continue
        value=partial+total_after(symbol,source,minute+M,until)
        item=dict(kind=kind,price=float(price),fromTime=start,precisionMs=res,minute=minute,end=until,volume=float(value),openingVolume=float(partial))
        if proof:item['tradeSource']=proof
        rows.append(item)
    print(symbol,source,len(rows),'checkpoints',flush=True)
    return symbol+'/'+source,rows


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path,default=Path(tempfile.gettempdir())/'perp-volume-trades')
    args=parser.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    jobs=[]
    for sym in ['BTC','BNB','SOL','HYPE','ZEC','OKB','BGB']:
        symbol=sym+'USDT';root=ROOT
        hist=json.loads((root/('anchors.json' if sym=='BTC' else 'history/'+symbol+'.json')).read_text())
        snap=json.loads((root/('snapshot.json' if sym=='BTC' else 'snapshots/'+symbol+'.json')).read_text())
        jobs.extend((symbol,s,a,snap) for s,a in hist['sources'].items())
    now=int(time.time()*1000)
    with ThreadPoolExecutor(max_workers=5) as pool:
        out=dict(pool.map(lambda j:build(j,args.cache,now),jobs))
    target=ROOT/'history/period-volumes.json'
    target.write_text(json.dumps(dict(schema=1,checkpoints=out),ensure_ascii=False,separators=(',',':'))+'\n')


if __name__=='__main__':main()
