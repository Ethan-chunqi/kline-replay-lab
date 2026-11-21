#!/usr/bin/env python3
"""Package true 1-minute trade candles for year opening day and a recent window."""
from concurrent.futures import ThreadPoolExecutor
import json
from urllib.parse import urlencode
import time
from build_extra_crypto import ROOT, START, DAY, M, write, request, bars

old=['BTCUSDT','BNBUSDT','HYPEUSDT','SOLUSDT','ZECUSDT']
jobs=[(s,venue) for s in old for venue in ['binance-usdm','bybit-linear']]+[('OKBUSDT','bybit-linear'),('BGBUSDT','bitget-usdt')]

def fetch(symbol,venue,start,end):
    if venue=='bitget-usdt':return bars(symbol,'1m',start,end)
    result=[]
    for t in range(start,end,1000*M):
        stop=min(t+1000*M,end);size=(stop-t)//M
        if venue=='binance-usdm':
            url='https://fapi.binance.com/fapi/v1/klines?'+urlencode(dict(symbol=symbol,interval='1m',startTime=t,endTime=stop-1,limit=size))
            rows=request(url)
            if any(int(b[6])+1!=int(b[0])+M for b in rows):raise ValueError('Incorrect Binance interval')
        else:
            url='https://api.bybit.com/v5/market/kline?'+urlencode(dict(symbol=symbol,interval='1',category='linear',start=t,end=stop-1,limit=size))
            obj=request(url)
            if obj['retCode'] or obj['result']['symbol']!=symbol or obj['result']['category']!='linear':raise ValueError('Incorrect Bybit contract')
            rows=reversed(obj['result']['list'])
        result.extend([[int(r[0]),*map(float,r[1:6])] for r in rows])
    return result

def build(job):
    s,source=job
    # Retain the previous day as well, covering time differences across the two independent snapshots.
    cut=int(time.time()*1000)//M*M
    for name,left,right in [('start',START,START+DAY),('recent',(cut//DAY-1)*DAY,cut)]:
        filename=f'minutes/{s}-{source}-{name}.json.gz'
        if name=='start' and (ROOT/filename).is_file():continue
        rows=fetch(s,source,left,right)
        if len(rows)!=(right-left)//M or any(r[0]!=left+i*M or r[3]<=0 or r[3]>min(r[1],r[4]) or r[2]<max(r[1],r[4]) or r[5]<0 for i,r in enumerate(rows)):raise ValueError(f'Incomplete {s} {source} minute history')
        write(filename,dict(schema=1,market='perpetual',symbol=s,sourceId=source,interval='1m',asOf=right-1,rows=rows))
    print(s,source,flush=True)

if __name__=='__main__':
    with ThreadPoolExecutor(3) as pool:list(pool.map(build,jobs))
