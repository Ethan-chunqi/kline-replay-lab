#!/usr/bin/env python3
"""Archive each available native Sina interval for the specific CFFEX delivery month."""
import argparse
import concurrent.futures
import datetime as dt
import gzip
import json
import math
import os
import re
from pathlib import Path
import time
import urllib.request

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / 'dist' if (REPO / 'dist' / 'feed.js').is_file() else REPO
CN = dt.timezone(dt.timedelta(hours=8))


def build(path, output):
    raw = json.loads(path.read_text())
    contract = raw['contract']
    if (raw.get('schema') != 1 or not re.fullmatch(r'(IM|IC|IF|IH)',path.stem) or raw['symbol'] != path.stem or
            not re.fullmatch(raw['symbol']+r'\d{4}',contract) or raw['sourceId'] != 'cffex-'+contract or
            raw.get('dailySource') != '中金所'):
        raise ValueError(f'{path}: snapshot identity or official source mismatch')
    official = {r[0]: r for r in raw['days']}
    listing = int(dt.datetime.fromisoformat(raw['listingDate']).replace(tzinfo=CN).timestamp())
    through = int(raw['asOf']/1000)
    destination = output/f'{contract}.json.gz'
    destination.parent.mkdir(parents=True, exist_ok=True)
    previous = {}
    seed = destination if destination.exists() else ROOT/'year'/'futures'/destination.name
    if seed.is_file():
        with gzip.open(seed, 'rt') as handle:
            prior = json.load(handle)
        if (prior.get('schema') != 1 or prior['contract'] != contract or prior['symbol'] != raw['symbol'] or
                prior['sourceId'] != raw['sourceId'] or prior['listingDate'] != raw['listingDate']):
            raise ValueError(f'{seed}: delivery month mismatch')
        if seed == destination and prior['asOf'] > raw['asOf']:
            return contract, 'kept newer archive'
        previous = prior['frames']
    frames = {}
    counts = []
    for minutes, interval in [(1,'1m'),(15,'15m'),(30,'30m'),(60,'1h')]:
        url = ('https://stock.finance.sina.com.cn/futures/api/openapi.php/'
               f'InnerFuturesNewService.getFewMinLine?symbol={contract}&type={minutes}')
        for attempt in range(3):
            try:
                payload=json.load(urllib.request.urlopen(url,timeout=15))['result']
                if payload['status']['code']!=0: raise ValueError('No native bars')
                break
            except (OSError,ValueError):
                if attempt==2: raise
                time.sleep(2**attempt)
        rows = {r[0]:r for r in previous.get(interval,[])}
        for p in payload['data']:
            t = int(dt.datetime.strptime(p['d'],'%Y-%m-%d %H:%M:%S').replace(tzinfo=CN).timestamp()) - 60*minutes
            if t<listing or t+60*minutes>through:continue
            o,h,l,c,v=[float(p[k]) for k in ['o','h','l','c','v']]
            if not all(map(math.isfinite,[o,h,l,c,v])) or not 0<l<=min(o,c)<=max(o,c)<=h or v<0:continue
            # The settled daily range independently confirms this delivery month.
            day = ((t+8*3600)//86400)*86400-8*3600
            daily = official.get(day)
            if not daily:continue
            if h>daily[2]+0.21 or l<daily[3]-0.21: raise ValueError(f'{contract} {p["d"]}: conflicting official range')
            rows[t]=[t,o,h,l,c,v]
        if not rows:raise ValueError('No confirmed '+interval+' '+contract)
        ordered=[rows[t] for t in sorted(rows)]
        frames[interval]=ordered
        counts.append((interval,len(ordered),dt.datetime.fromtimestamp(ordered[0][0],CN).date().isoformat()))
    record=dict(schema=1,symbol=raw['symbol'],contract=contract,sourceId=raw['sourceId'],source='Sina Finance',
                listingDate=raw['listingDate'],asOf=raw['asOf'],frames=frames)
    tmp=destination.with_suffix('.tmp')
    with open(tmp,'wb') as stream:
        with gzip.GzipFile(fileobj=stream,mode='wb',mtime=0) as gz:gz.write(json.dumps(record,separators=(',',':')).encode())
    os.replace(tmp,destination)
    return contract,counts


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--snapshots',type=Path,default=ROOT/'futures'/'data',help='Directory of verified product snapshots')
    cli.add_argument('--output',type=Path,default=ROOT/'year'/'futures',help='Destination for per-contract gzip archives')
    args=cli.parse_args()
    files=[args.snapshots/(symbol+'.json') for symbol in ('IC','IF','IH','IM')]
    if not all(path.is_file() for path in files):cli.error('All four fresh CFFEX product snapshots are required')
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for item in pool.map(lambda path:build(path,args.output),files):print(*item,flush=True)
