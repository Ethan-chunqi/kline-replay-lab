#!/usr/bin/env python3
"""Rebuild true Bybit OKBUSDT and Bitget BGBUSDT perpetual charts and their extrema."""
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import gzip
import json
import math
import os
from pathlib import Path
import time
from urllib.parse import urlencode
from build_crypto_year import request, verify, START, WIDTH, DAY

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / 'dist' if (REPO / 'dist' / 'feed.js').is_file() else REPO
M = 60_000
VENUES = {'OKBUSDT': ('bybit-linear','Bybit'), 'BGBUSDT': ('bitget-usdt','Bitget')}
SIZES = {'1m': M, '15m': WIDTH, '1d': DAY}
BITGET = 'https://api.bitget.com/api/v2/mix/market/'
BYBIT = 'https://api.bybit.com/v5/market/'

def url(symbol, frame, left, end):
    step = SIZES[frame]
    count = (end - left) // step
    if symbol == 'BGBUSDT':
        return BITGET+'history-candles?'+urlencode(dict(productType='USDT-FUTURES',symbol=symbol,
            granularity='1Dutc' if frame=='1d' else frame, startTime=left,endTime=end,limit=count))
    return BYBIT+'kline?'+urlencode(dict(category='linear', symbol=symbol, interval={'1m':'1','15m':'15','1d':'D'}[frame],
                                         start=left,end=end-1,limit=count))

def parse_rows(raw,symbol):
    if symbol=='BGBUSDT':
        if raw['code']!='00000':raise ValueError(raw)
        rows=raw['data']
    else:
        if raw['retCode'] or raw['result']['symbol']!=symbol or raw['result']['category']!='linear':raise ValueError(raw)
        rows=reversed(raw['result']['list'])
    return [[int(r[0]),*map(float,r[1:6])] for r in rows]

def bars(symbol,frame,start,end,prelaunch=False):
    step=SIZES[frame]
    count=(85 if frame=='1d' else 200) if symbol=='BGBUSDT' else 1000
    spans=[(a,min(a+step*count,end)) for a in range(start,end,step*count)]
    def page(span):
        left,stop=span
        raw=parse_rows(request(url(symbol,frame,left,stop)),symbol)
        return [b for b in raw if left<=b[0]<stop]
    # Retry/backoff is applied by request(); stay below the public IP rate ceiling.
    with ThreadPoolExecutor(3) as pool: rows=[b for page_rows in pool.map(page,spans) for b in page_rows]
    if not rows or rows[-1][0]+step!=end or (not prelaunch and rows[0][0]!=start):
        raise ValueError(f'{symbol} {frame} incomplete range {start} {end}')
    if any(b[0] != rows[0][0]+i*step or not all(math.isfinite(x) for x in b) or
           not (0<b[3]<=min(b[1],b[4])<=max(b[1],b[4])<=b[2]) or b[5]<0 for i,b in enumerate(rows)):
        raise ValueError(f'{symbol} {frame} invalid candle')
    return rows

def write(name, obj):
    path=ROOT/name
    path.parent.mkdir(parents=True,exist_ok=True)
    data=json.dumps(obj,separators=(',',':'),allow_nan=False).encode()
    if path.suffix=='.gz':data=gzip.compress(data,compresslevel=7,mtime=0)
    tmp=path.with_suffix('.tmp-'+str(os.getpid()))
    tmp.write_bytes(data);tmp.replace(path)

def snapshot(symbol, frame='15m', count=675):
    if symbol=='BGBUSDT':
        source=BITGET+'candles?'+urlencode(dict(productType='USDT-FUTURES',symbol=symbol,granularity=frame,limit=count))
    else:
        source=BYBIT+'kline?'+urlencode(dict(category='linear',symbol=symbol,interval='15' if frame=='15m' else '1',limit=count))
    data=request(source);rows=parse_rows(data,symbol);t=int(data.get('requestTime') or data['time'])
    if len(rows)!=count or rows[-1][0]>t or t-rows[-1][0]>SIZES[frame]+12000 or any(
       b[0]!=rows[0][0]+i*SIZES[frame] for i,b in enumerate(rows)):raise ValueError(f'{symbol} live {frame} snapshot')
    return t,rows

def build(symbol):
    source,provider=VENUES[symbol]
    if symbol=='BGBUSDT':
        cfg=request(BITGET+'contracts?productType=USDT-FUTURES&symbol=BGBUSDT')['data'][0]
        assert (cfg['symbol'],cfg['symbolType'],cfg['symbolStatus'],cfg['supportMarginCoins'])==(symbol,'perpetual','normal',['USDT'])
        # This contract's openTime is not necessarily its first trade; query dates before BGB existed.
        earliest=dt.datetime(2021,1,1,tzinfo=dt.timezone.utc)
    else:
        cfg=request(BYBIT+'instruments-info?category=linear&symbol='+symbol)['result']['list'][0]
        assert (cfg['symbol'],cfg['contractType'],cfg['status'],cfg['settleCoin'])==(symbol,'LinearPerpetual','Trading','USDT')
        earliest=dt.datetime.fromtimestamp(int(cfg['launchTime'])/1000,dt.timezone.utc)
    identity=dict(symbol=symbol,sourceId=source,market='perpetual')
    now,recent=snapshot(symbol)
    cut=now//DAY*DAY
    write(f'snapshots/{symbol}.json',dict(**identity,source=provider,interval='15m',asOf=now,
        candles=[dict(zip(('time','open','high','low','close','volume'),r)) for r in recent]))
    daily=bars(symbol,'1d',int(earliest.timestamp()*1000)//DAY*DAY,cut,True)
    high=max(daily,key=lambda b:b[2])
    daymins=bars(symbol,'1m',high[0],high[0]+DAY,True)
    peak=max(daymins,key=lambda b:b[2])
    if peak[2]!=high[2]:raise ValueError('daily/minute high mismatch')
    later=[(b[3],b[0],'1m') for b in daymins if b[0]>peak[0]]+[(b[3],b[0],'1d') for b in daily if b[0]>high[0]]
    later.append((peak[4],peak[0],'1m'))
    price,t,frame=min(later)
    if peak[3]<=price and t!=peak[0]:raise ValueError('same minute ordering requires trades')
    if frame=='1d':
        low=min(bars(symbol,'1m',t,t+DAY),key=lambda b:b[3])
        if low[3]!=price:raise ValueError('daily/minute low mismatch')
        t=low[0]
    def point(price,t):return dict(price=price,time=t,precision='minute',precisionMs=M,evidence=url(symbol,'1m',t,t+M))
    baseline=dict(asOf=cut-1,historyStart=daily[0][0],dailyBars=len(daily),high=point(peak[2],peak[0]),low=point(price,t))
    write(f'history/{symbol}.json',dict(schemaVersion=1,symbol=symbol,market='perpetual',sources={source:baseline},
          method='Trade-price perpetual candles from the first available contract day; first minute of the ATH and of the subsequent low.'))
    write(f'daily/{symbol}-{source}.json',dict(**identity,interval='1d',asOf=cut-1,rows=daily[-365:]))
    for kind in ['high','low']:
        p=baseline[kind];a=p['time'];windows={}
        for frame,step in SIZES.items():
            centre=a//step*step; left=max(daily[0][0],centre-70*step);end=min(cut,centre+71*step)
            windows[frame]=[b for b in daily if left<=b[0]<end] if frame=='1d' else bars(symbol,frame,left,end,True)
            if not any(b[0]<=a<b[0]+step and b[2 if kind=='high' else 3]==p['price'] for b in windows[frame]):raise ValueError('Anchor window mismatch')
        write(f'extreme-windows/{symbol}-{source}-{kind}.json',dict(**identity,kind=kind,point=p,asOf=cut-1,windows=windows))
    path=f'year/crypto/{symbol}-{source}.json.gz'
    existing=[]
    if (ROOT/path).is_file():
        old=json.loads(gzip.decompress((ROOT/path).read_bytes()))
        if old['symbol']!=symbol or old['sourceId']!=source or old['start']!=START or old['width']!=WIDTH: raise ValueError('contract mismatch')
        existing=old['rows'];verify(existing,START,old['end'])
    newstart=START+len(existing)*WIDTH
    if newstart<cut:
        rows=existing+bars(symbol,'15m',newstart,cut)
        verify(rows,START,cut)
        write(path,dict(schema=1,**identity,width=WIDTH,start=START,end=cut,rows=rows))
    print(symbol,provider,len(daily),'daily candles', baseline['high'],baseline['low'],flush=True)

if __name__=='__main__':
    with ThreadPoolExecutor(2) as pool:list(pool.map(build,VENUES))
