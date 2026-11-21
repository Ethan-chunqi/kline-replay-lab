#!/usr/bin/env python3
"""Build verified, closed BTC/BNB/HYPE/SOL/ZEC USDT perpetual 15m history from 2026-01-01 UTC."""
import argparse
import concurrent.futures
import datetime as dt
import gzip
import http.client
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

UTC = dt.timezone.utc
START = int(dt.datetime(2026, 1, 1, tzinfo=UTC).timestamp() * 1000)
WIDTH = 900_000
DAY = 86_400_000
SYMBOLS = ['BTCUSDT', 'BNBUSDT', 'HYPEUSDT', 'SOLUSDT', 'ZECUSDT']
VENUES = ['binance-usdm', 'bybit-linear']
REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / 'dist' if (REPO / 'dist' / 'feed.js').is_file() else REPO
DEST = ROOT / 'year' / 'crypto'


def request(url):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'market-history/1.0'})
            with urllib.request.urlopen(req, timeout=25) as response:
                return json.load(response)
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as e:
            if i == 3:
                raise
            time.sleep(max(float(getattr(e, 'headers', {}).get('Retry-After', 0) or 0)
                           if isinstance(e, urllib.error.HTTPError) else 0, 2**i))


def rows_from(symbol, venue, start, end):
    limit = (end-start)//WIDTH
    if venue == 'binance-usdm':
        url = 'https://fapi.binance.com/fapi/v1/klines?' + urllib.parse.urlencode(
            dict(symbol=symbol, interval='15m', startTime=start, endTime=end-1, limit=limit))
        rows = request(url)
        if not isinstance(rows, list) or not all(int(r[6]) == int(r[0])+WIDTH-1 for r in rows):
            raise ValueError('Unexpected Binance perpetual response')
    else:
        url = 'https://api.bybit.com/v5/market/kline?' + urllib.parse.urlencode(
            dict(category='linear', symbol=symbol, interval='15', start=start, end=end-1, limit=limit))
        result = request(url)
        payload = result.get('result', {})
        if result.get('retCode') != 0 or payload.get('category') != 'linear' or payload.get('symbol') != symbol:
            raise ValueError('Unexpected Bybit linear response')
        rows = reversed(payload['list'])
    out = [[int(r[0]), *map(float, r[1:6])] for r in rows]
    verify(out, start, end)
    return out


def verify(rows, start, end):
    if len(rows)*WIDTH != end-start:
        raise ValueError('Incomplete contract range')
    for i, (t, o, h, l, c, v) in enumerate(rows):
        if (t != start+i*WIDTH or not all(map(math.isfinite, [o,h,l,c,v])) or
                not 0 < l <= min(o,c) <= max(o,c) <= h or v < 0):
            raise ValueError(f'Invalid candle at {t}')


def update(job):
    symbol, venue, end, directory = job
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f'{symbol}-{venue}.json.gz'
    rows = []
    if path.exists():
        with gzip.open(path, 'rt') as stream:
            prior = json.load(stream)
        if (prior['symbol'], prior['sourceId'], prior['width'], prior['start']) != (symbol, venue, WIDTH, START):
            raise ValueError(f'Identity mismatch in {path}')
        verify(prior['rows'], START, prior['end'])
        if prior['end'] >= end:
            return f'{symbol} {venue} current'
        rows = prior['rows']
    cursor = START+len(rows)*WIDTH
    count = 1000
    while cursor < end:
        stop = min(end, cursor+count*WIDTH)
        rows.extend(rows_from(symbol, venue, cursor, stop))
        cursor = stop
    verify(rows, START, end)
    doc = dict(schema=1, market='perpetual', symbol=symbol, sourceId=venue, width=WIDTH, start=START, end=end, rows=rows)
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'wb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=7, mtime=0) as stream:
            stream.write(json.dumps(doc, separators=(',', ':'), allow_nan=False).encode())
    os.replace(tmp, path)
    return f'{symbol} {venue}: {len(rows)} closed 15m bars'


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--directory', type=Path, default=DEST)
    cli.add_argument('--through', type=dt.date.fromisoformat, help='Exclusive UTC date; defaults to this UTC day')
    args = cli.parse_args()
    through = args.through or dt.datetime.now(UTC).date()
    end = int(dt.datetime.combine(through, dt.time(), tzinfo=UTC).timestamp()*1000)
    if end <= START or end > int(time.time()*1000)//DAY*DAY:
        cli.error('--through must be after 2026-01-01 and no later than the current UTC date')
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        for message in pool.map(update, [(s, v, end, args.directory) for s in SYMBOLS for v in VENUES]):
            print(message, flush=True)
