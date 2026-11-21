#!/usr/bin/env python3
"""Refresh public regular-session quotes and split-normalized historical OHLCV, using the Python standard library."""
import argparse
import concurrent.futures
import datetime as dt
import gzip
import http.client
import json
import math
import os
from pathlib import Path
import random
import sys
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo


def kr_poll(info):
    url = 'https://polling.finance.naver.com/api/realtime/domestic/stock/' + info['symbol']
    rows = fetch([url]).get('datas', [])
    row = next((r for r in rows if r.get('itemCode') == info['symbol']), None)
    if not row or row['stockExchangeType']['zoneId'] != 'Asia/Seoul':
        raise ValueError('Missing Korean market capitalisation')
    cap = int(row['marketValueFullRaw'])
    stamp = int(dt.datetime.fromisoformat(row['localTradedAt']).timestamp()) * 1000
    if cap <= 0:
        raise ValueError('Invalid market capitalisation')
    return {'marketCap':cap, 'marketCapAsOf':stamp, 'marketCapSource':'Naver Pay Securities'}


ROOT = Path(__file__).resolve().parent.parent
SITE = next(p for p in (ROOT / 'dist/equities', ROOT / 'equities') if (p / 'catalog.js').exists())
CATALOG = json.loads((SITE / 'catalog.js').read_text().split('=', 1)[1].strip().rstrip(';'))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
DAY = 86400
UTC = dt.timezone.utc


def fetch(urls):
    error = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(urls[attempt % len(urls)], headers={'User-Agent': UA, 'Accept': 'application/json,*/*'})
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.load(response)
        except (OSError, ValueError, http.client.HTTPException) as exc:
            error = exc
            time.sleep(.35 * (attempt + 1) + random.random() / 4)
    raise RuntimeError(str(error))


def yahoo(info, params):
    path = '/v8/finance/chart/' + urllib.parse.quote(info['providerSymbol'], safe='') + '?' + urllib.parse.urlencode(params)
    data = fetch(['https://query1.finance.yahoo.com' + path, 'https://query2.finance.yahoo.com' + path])
    rec = data['chart']['result'][0]
    if rec['meta']['symbol'].upper() != info['providerSymbol'].upper() or rec['meta']['dataGranularity'] != params['interval']:
        raise ValueError('Yahoo symbol or interval mismatch')
    return rec


def day_start(stamp, zone):
    return int(dt.datetime.fromtimestamp(stamp, zone).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def checked_bar(stamp, vals, allow_negative=False):
    if any(v is None for v in vals[:4]):
        return None
    o, h, l, c = (round(float(x), 6) for x in vals[:4])
    if (l <= 0 and not allow_negative) or not (l <= min(o, c) <= max(o, c) <= h) or not all(map(math.isfinite, [o,h,l,c])):
        return None
    vol = float(vals[4] or 0)
    return [stamp, o, h, l, c, int(round(vol))]


def yahoo_bars(rec, zone, daily):
    q = rec['indicators']['quote'][0]
    spans = rec['meta'].get('tradingPeriods') or []
    spans = spans.get('regular', []) if isinstance(spans, dict) else spans
    by_day = {day_start(p['start'], zone): p for spans_day in spans for p in spans_day}
    candles = {}
    for i, t in enumerate(rec.get('timestamp', [])):
        session = day_start(t, zone)
        row = checked_bar(session if daily else t, [q[k][i] if k in q else None for k in ['open','high','low','close','volume']])
        if not row:
            continue
        if not daily:
            end = by_day.get(session, {}).get('end')
            if end and t >= end and candles:
                # Yahoo appends an official close at the closing auction, timestamped exactly at session end.
                prev = next(reversed(candles.values()))
                if t == end and 0 < t - prev[0] <= 900:
                    prev[2] = max(prev[2], row[2]); prev[3] = min(prev[3], row[3]); prev[4] = row[4]
                continue
            if t % 900:
                continue
        candles[row[0]] = row
    return list(candles.values())


def us_data(info, prev, inc):
    now = int(time.time())
    zone = ZoneInfo(info['timeZone'])
    korean = info['region']=='kr'
    if korean:
        import korea
        bars = korea.intraday(info,15,fetch,checked_bar)
    intr = yahoo(info, {'interval':'15m','range':'1mo','includePrePost':'false','region':'US'})
    if not korean:
        bars = yahoo_bars(intr, zone, False)
    start = now - DAY * 40 if inc and prev else -2208988800
    if inc and prev and now - prev[-1][0] > 35 * DAY:
        start = -2208988800
    def daily(s):
        return yahoo(info, {'period1':s, 'period2':now + DAY, 'interval':'1d', 'events':'splits', 'region':'US'})
    from_naver = korean and info['type']=='index'
    if from_naver:
        raw = {}
        fresh = korea.daily(info,fetch,checked_bar)
        start = -2208988800
    else:
        raw = daily(start)
        fresh = yahoo_bars(raw, zone, True)
    # A split (or a historical restatement in the overlap) puts all older data on a new basis.
    if start > 0:
        existing = {r[0]:r for r in prev}
        changed = any(r[0] in existing and r[0] < prev[-1][0] and abs(r[4]-existing[r[0]][4]) > max(.00001, r[4]*.00015) for r in fresh)
        if raw.get('events', {}).get('splits') or changed:
            raw = daily(-2208988800)
            fresh = yahoo_bars(raw, zone, True)
            start = -2208988800
    history = stitch(prev if start > 0 else [], fresh)
    meta = intr['meta']
    quote = {'price':meta['regularMarketPrice'], 'asOf':min(now, meta['regularMarketTime']), 'source':'Yahoo Finance', 'sourceId':'yahoo-chart',
             'dayHigh':meta.get('regularMarketDayHigh'), 'dayLow':meta.get('regularMarketDayLow'), 'prevClose':meta.get('previousClose'),
             'tradeDay':day_start(bars[-1][0], zone), 'splitBasis':'指数点位' if info['type']=='index' else '拆股调整、未含股息',
             'delayMinutes':meta.get('exchangeDataDelayedBy')}
    period = meta.get('currentTradingPeriod',{}).get('regular',{})
    if period.get('end') and day_start(period['end'],zone) == quote['tradeDay']:
        quote['sessionEnd'] = period['end'] * 1000
    if korean:
        local_day=dt.datetime.fromtimestamp(quote['tradeDay'],zone)
        _, closing=korea.hours(local_day.date())
        session_end=quote['tradeDay']+closing*60
        quote['sessionEnd']=session_end*1000
        quote['asOf']=min(now,session_end,meta['regularMarketTime'])
        quote['intradaySourceId']='naver-krx'
        quote['intradaySource']='Naver Pay Securities'
        if from_naver:
            quote['sourceId']='naver-krx'
            quote['source']='Naver Pay Securities'
            quote['price']=fresh[-1][4] if fresh[-1][0]==quote['tradeDay'] and now>=session_end else bars[-1][4]
            quote['dayHigh']=fresh[-1][2] if fresh[-1][0]==quote['tradeDay'] else None
            quote['dayLow']=fresh[-1][3] if fresh[-1][0]==quote['tradeDay'] else None
        if info['type']=='stock':
            quote.update(kr_poll(info))
    return history, bars, quote


def stitch(old, new):
    merged = {r[0]:r for r in old}
    merged.update((r[0], r) for r in new)
    return [merged[t] for t in sorted(merged)]


def cn_daily(info, start, end):
    s = info['providerSymbol']
    p = '/appstock/app/fqkline/get?param=' + ','.join([s,'day',start,end,'640','qfq'])
    raw = fetch(['https://web.ifzq.gtimg.cn' + p, 'https://ifzq.gtimg.cn' + p])
    rec = raw['data'][s]
    zone = ZoneInfo(info['timeZone'])
    rows = []
    stock = info['type'] == 'stock'
    values = rec.get('qfqday') if stock else rec.get('day')
    if values is None:
        # Tencent returns day when the requested period has no adjusted variant.
        if stock and 'day' in rec and not rec['day']:
            return []
        # During periods with no corporate-action adjustment, Tencent may return raw rows.
        # Confirm these rows belong to the latest, unadjusted segment before using them.
        if stock and 'day' in rec and rec.get('day'):
            raise ValueError('Expected qfqday for '+s+' '+start)
        values = []
    for r in values:
        stamp = int(dt.datetime.strptime(r[0], '%Y-%m-%d').replace(tzinfo=zone).timestamp())
        bar = checked_bar(stamp,[r[1],r[3],r[4],r[2],r[5]],allow_negative=stock)
        if bar:
            rows.append(bar)
    if len(rows) >= 640:
        raise ValueError('Daily query reached row limit')
    return rows


def cn_data(info, prev, inc):
    zone = ZoneInfo(info['timeZone'])
    today = dt.datetime.now(zone).date()
    s = info['providerSymbol']
    if inc and prev:
        begin = dt.datetime.fromtimestamp(prev[-1][0],zone).date() - dt.timedelta(days=10)
    else:
        begin = dt.date(info['historyYear'], 1, 1)
    pieces = []
    while begin <= today:
        end = min(today, begin + dt.timedelta(days=729))
        pieces.append((begin.isoformat(), end.isoformat()))
        begin = end + dt.timedelta(days=1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        parts = list(pool.map(lambda p:cn_daily(info,*p), pieces))
    fresh = [r for part in parts for r in part]
    if info['type']=='stock' and inc and prev:
        existing = {r[0]: r for r in prev[:-1]}
        if any(r[0] in existing and any(abs(r[i]-existing[r[0]][i])>.0011 for i in range(1,5)) for r in fresh):
            return cn_data(info,[],False)
    history = stitch(prev if inc else [], fresh)
    path = '/appstock/app/kline/mkline?param='+s+',m15,,640'
    rec = fetch(['https://ifzq.gtimg.cn'+path,'https://web.ifzq.gtimg.cn'+path])['data'][s]
    rows = []
    for r in rec['m15']:
        end = int(dt.datetime.strptime(r[0],'%Y%m%d%H%M').replace(tzinfo=zone).timestamp())
        bar = checked_bar(end-900,[r[1],r[3],r[4],r[2],r[5]])
        if bar:
            rows.append(bar)
    q = rec['qt'][s]
    if q[2] != s[2:]:
        raise ValueError('Tencent symbol mismatch')
    quote_time = int(dt.datetime.strptime(q[30][:14],'%Y%m%d%H%M%S').replace(tzinfo=zone).timestamp())
    quote = {'price':float(q[3]), 'asOf':min(int(time.time()),quote_time,rows[-1][0]+900),
             'prevClose':float(q[4]), 'dayHigh':float(q[33]), 'dayLow':float(q[34]), 'tradeDay':day_start(rows[-1][0],zone),
             'source':'腾讯证券', 'sourceId':'tencent-index', 'splitBasis':'指数点位', 'sessionEnd':(day_start(rows[-1][0],zone)+15*3600)*1000, 'delayMinutes':None}
    if info['type']=='stock':
        quote.update(sourceId='tencent-stock-qfq',intradaySourceId='tencent-stock-raw',splitBasis='日K前复权，分时不复权')
        cap=float(q[45])*100_000_000
        if not math.isfinite(cap) or cap<=0:
            raise ValueError('Missing total market capitalization')
        quote.update(marketCap=round(cap),marketCapAsOf=quote['asOf']*1000)
    return history,rows,quote


def point(r, index):
    return {'price':r[index], 'time':r[0]*1000, 'precision':'day', 'precisionMs':86400000}


def snapshot(info, days, intr, meta):
    if len(days) < 10 or not intr:
        raise ValueError('Insufficient daily or intraday history')
    if meta['price'] <= 0:
        raise ValueError('Invalid quotation')
    session = meta['tradeDay']
    session_bars = [r for r in intr if r[0] >= session]
    if not session_bars:
        raise ValueError('Missing session candles')
    prev_day = [r for r in days if r[0] < session][-1]
    if meta['sourceId']!='tencent-stock-qfq':
        meta['prevClose'] = prev_day[4]
    meta['dayHigh'] = meta['dayHigh'] or max(r[2] for r in session_bars)
    meta['dayLow'] = meta['dayLow'] or min(r[3] for r in session_bars)
    # Persist the active session in the daily history, including its official published high and low.
    old = next((r for r in reversed(days) if r[0] == session), None)
    op = old[1] if old else session_bars[0][1]
    active = [session, op, max(meta['dayHigh'],op,meta['price'],old[2] if old else 0), min(meta['dayLow'],op,meta['price'],old[3] if old else math.inf),
              meta['price'],old[5] if old else sum(r[5] for r in session_bars)]
    days = stitch(days, [active])
    hi = max(range(len(days)), key=lambda i:days[i][2])
    post = list(range(hi+1, len(days)))
    high = point(days[hi],2)
    low_i = min(post, key=lambda i:days[i][3]) if post else None
    low = point(days[low_i],3) if post else None
    # A daily OHLC does not establish when its low occurred relative to its high.
    peak_day = days[hi]
    uncertain = None
    def choose(candidate, point_index):
        nonlocal low, low_i
        if low is None or candidate['price'] < low['price']:
            low, low_i = candidate, point_index
    if peak_day[1] == peak_day[2] or peak_day[3] == peak_day[4]:
        choose(point(peak_day,3),hi)
    elif low is None or peak_day[3] < low['price']:
        choose(point(peak_day,4),hi)  # the closing print followed or equalled the day's high
        uncertain = point(peak_day,3)
        # Earlier unadjusted share trades cannot establish ordering on the current adjustment basis.
        intr_comparable = meta['sourceId']!='tencent-stock-qfq' or peak_day[0]==session
        ath_rows = [r for r in intr if intr_comparable and peak_day[0] <= r[0] < peak_day[0]+DAY]
        hit = next((i for i,r in enumerate(ath_rows) if abs(r[2]-high['price'])<=max(.00001,high['price']*1e-7)), None)
        regular_end = peak_day[0] + int({'cn':15, 'kr':15.5, 'us':16}[info['region']]*3600)
        if peak_day[0]==session:
            regular_end=min(regular_end,meta['asOf'],meta.get('sessionEnd',regular_end*1000)/1000)
        opening = peak_day[0]+int((9 if info['region']=='kr' else 9.5)*3600)
        expected = [t for t in range(opening,math.ceil(regular_end),900)
                    if info['region']!='cn' or not peak_day[0]+int(11.5*3600)<=t<peak_day[0]+13*3600]
        if hit is not None and [r[0] for r in ath_rows] == expected and min(r[3] for r in ath_rows)<=peak_day[3]+.00001:
            peak=ath_rows[hit]
            def part(row,index):
                return {'price':row[index], 'time':row[0]*1000, 'precision':'15m', 'precisionMs':900000}
            uncertain = part(peak,3)
            if peak[1]==peak[2] or peak[4]==peak[3]:
                choose(part(peak,3),hi)
            choose(part(peak,4),hi)
            for r in ath_rows[hit+1:]:
                choose(part(r,3),hi)
    confirmed = low
    if uncertain and low and uncertain['price'] < low['price']-1e-8:
        low = None
    else:
        uncertain = None
    near = set(range(max(0,len(days)-480),len(days)))
    for i in [hi,low_i if low_i is not None else hi]:
        near.update(range(max(0,i-55),min(len(days),i+56)))
    archive = {'schema':1,'symbol':info['symbol'],'sourceId':meta['sourceId'],'rows':days}
    data = {'schema':1,'symbol':info['symbol'],'generatedAt':int(time.time())*1000,
        **meta,'asOf':meta['asOf']*1000,'tradeDay':session*1000,'high':high,'low':low,
        'historyStart':days[0][0]*1000,'historyCount':len(days),'uncertainLow':uncertain,'confirmedLowCandidate':confirmed if uncertain else None,'intraday':intr,'days':[days[i] for i in sorted(near)],
        'historyEnd':days[-1][0]*1000}
    return data, archive


def atomic(path, raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp = path.with_name('.'+path.name+'.tmp')
    tmp.write_bytes(raw)
    os.replace(tmp,path)


def minute_snapshot(info):
    if info['region']=='cn':
        rows=cn_minutes(info)
        return rows,'tencent-stock-raw' if info['type']=='stock' else 'tencent-index','腾讯行情'
    if info['region']=='kr':
        import korea
        return korea.intraday(info,1,fetch,checked_bar),'naver-krx','Naver Pay Securities'
    raw=yahoo(info,{'range':'5d','interval':'1m','includePrePost':'false'})
    z=ZoneInfo(info['timeZone'])
    q=raw['indicators']['quote'][0]
    sessions=raw['meta'].get('tradingPeriods',[])
    if isinstance(sessions,dict):sessions=sessions.get('regular',[])
    spans={day_start(p['start'],z):(p['start'],p['end']) for group in sessions for p in group}
    rows=[]
    for i,t in enumerate(raw.get('timestamp',[])):
        span=spans.get(day_start(t,z))
        if not span or not span[0]<=t<span[1]:continue
        b=checked_bar(t,[q[k][i] if k in q else None for k in ('open','high','low','close','volume')])
        if b:rows.append(b)
    if not rows:raise ValueError('No real minute candles')
    return rows,'yahoo-chart','Yahoo Finance'


def cn_minutes(info,before=''):
    sym=info['providerSymbol']
    url='https://ifzq.gtimg.cn/appstock/app/kline/mkline?param='+sym+',m1,'+before+',640'
    rec=fetch([url])['data'][sym]
    rows=[]
    for r in rec.get('m1',[]):
        time_local=dt.datetime.strptime(r[0],'%Y%m%d%H%M').replace(tzinfo=ZoneInfo('Asia/Shanghai'))
        stamp=int(time_local.timestamp())-60
        minute=time_local.hour*60+time_local.minute-1
        if not (570<=minute<690 or 780<=minute<900):
            continue
        b=checked_bar(stamp,[r[1],r[3],r[4],r[2],r[5]])
        if b:rows.append(b)
    return rows


def write(info, args):
    sym = info['symbol']
    history_path = args.output/'history'/(sym+'.json.gz')
    prior = []
    if args.incremental:
        for base in [args.output,SITE]:
            cache = base/'history'/(sym+'.json.gz')
            if cache.exists():
                obj = json.loads(gzip.decompress(cache.read_bytes()))
                if obj.get('symbol')==sym and obj.get('schema')==1:
                    prior = obj['rows']
                    break
    raw_days, intr, meta = (cn_data if info['region']=='cn' else us_data)(info,prior,args.incremental)
    data,archive = snapshot(info,raw_days,intr,meta)
    data['minutes'],data['minuteSourceId'],data['minuteSource']=minute_snapshot(info)
    out = args.output/'data'/(sym+'.json')
    # Do not generate commits when the provider still reports exactly the same market quotation.
    if out.exists() and history_path.exists():
        previous = json.loads(out.read_bytes())
        if previous['asOf']>data['asOf'] and not (info['region']=='kr' and not previous.get('intradaySourceId') and previous['tradeDay']==data['tradeDay']):
            raise ValueError('Provider returned older data than the stored quotation')
        if {k:v for k,v in previous.items() if k!='generatedAt'}=={k:v for k,v in data.items() if k!='generatedAt'}:
            return sym+' unchanged'
    pack = lambda x:json.dumps(x,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')
    atomic(history_path,gzip.compress(pack(archive),compresslevel=6,mtime=0))
    atomic(out,pack(data))
    return '%s %s daily, %s quarter-hour, ATH %s, price %s' % (sym,len(archive['rows']),len(intr),data['high']['price'],data['price'])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=SITE)
    parser.add_argument('--incremental',action='store_true')
    parser.add_argument('--symbols',nargs='+')
    parser.add_argument('--region',choices=['us','cn','kr','asia'])
    parser.add_argument('--workers',type=int,default=4)
    args=parser.parse_args()
    selected=[x for x in CATALOG if (not args.symbols or x['symbol'] in args.symbols) and (not args.region or x['region']==args.region or (args.region=='asia' and x['region'] in ('cn','kr')))]
    if not selected:parser.error('No matching instruments')
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs={pool.submit(write,x,args):x['symbol'] for x in selected}
        failures=[]
        for future in concurrent.futures.as_completed(jobs):
            try:print(future.result(),flush=True)
            except Exception as e:
                failures.append(jobs[future]);print(jobs[future],str(e),file=sys.stderr,flush=True)
    for group, filename in [('cn-ai','market-caps.json'), ('kr-ai','market-caps-kr.json')]:
        if not any(x.get('group')==group for x in selected): continue
        ranked=[]
        for info in (x for x in CATALOG if x.get('group')==group):
            path=args.output/'data'/(info['symbol']+'.json')
            if not path.exists(): break
            data=json.loads(path.read_bytes())
            if not data.get('marketCap') or not data.get('marketCapAsOf'): break
            ranked.append({k:data[k] for k in ('symbol','marketCap','marketCapAsOf')})
        else:
            ranked.sort(key=lambda r:-r['marketCap'])
            atomic(args.output/filename,json.dumps(ranked,separators=(',',':')).encode())
    sys.exit(1 if failures else 0)
