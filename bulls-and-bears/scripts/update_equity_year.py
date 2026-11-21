#!/usr/bin/env python3
"""Archive regular-session candles from 2026-01-01 for the equity catalogue.

Run after update_equities.py. --snapshots accepts a quotes directory containing
data/SYMBOL.json; --output points to the deployment's year directory. One gzip
file per instrument holds 15m, hourly and daily observations. 30m is derived
from source 15m candles in the browser.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import gzip
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from update_equities import CATALOG, SITE, checked_bar, cn_minutes, fetch, stitch, yahoo
import korea

START = dt.date(2026, 1, 1)


def zone_for(info):
    return ZoneInfo(info['timeZone'])


def date_of(stamp, zone):
    return dt.datetime.fromtimestamp(stamp, zone).date()


def midnight(day, zone):
    return int(dt.datetime.combine(day, dt.time(), zone).timestamp())


def split_session(info, stamp):
    local = dt.datetime.fromtimestamp(stamp, zone_for(info))
    minute = local.hour * 60 + local.minute
    if info['region'] == 'cn':
        return 570 if 570 <= minute < 690 else 780 if 780 <= minute < 900 else None
    if info['region']=='kr':
        opening,closing=korea.hours(local.date())
        return opening if opening<=minute<closing else None
    return 570 if 570 <= minute < 960 else None


def aggregate(rows, width, info):
    groups = {}
    for row in rows:
        t = dt.datetime.fromtimestamp(row[0], zone_for(info))
        opening = split_session(info, row[0])
        if opening is None:
            continue
        minute = t.hour * 60 + t.minute
        start = row[0] - (minute - opening) % width * 60
        if start not in groups:
            groups[start] = [start, *row[1:]]
        else:
            dest = groups[start]
            dest[2] = max(dest[2], row[2])
            dest[3] = min(dest[3], row[3])
            dest[4] = row[4]
            dest[5] += row[5]
    return list(groups.values())


def sina_quarters(info, start, as_of):
    # Sina labels a bar with its end wall-clock time. Its uncapped-looking
    # parameter is actually capped at about 5,000 rows (~310 trading days).
    ticker = info['providerSymbol']
    path = '/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'
    url = 'https://money.finance.sina.com.cn' + path + f'?symbol={ticker}&scale=15&ma=no&datalen=6000'
    data = fetch([url])
    if not isinstance(data, list):
        raise ValueError(f'{ticker}: invalid Sina bars')
    found = {}
    zone = zone_for(info)
    for row in data:
        end = int(dt.datetime.strptime(row['day'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=zone).timestamp())
        if not start <= end - 900 <= as_of or split_session(info, end - 900) is None:
            continue
        # Sina publishes Chinese equity and index volume in shares; the site
        # uses board lots, including fractional lots for odd-lot executions.
        volume_in_shares = float(row['volume'])
        b = checked_bar(end - 900, [row['open'],row['high'],row['low'],row['close'],volume_in_shares])
        if b:
            b[5] = round(volume_in_shares / 100, 2)
            found[b[0]] = b
    return [found[t] for t in sorted(found)]


def yahoo_window(info, interval, start, as_of):
    zone = zone_for(info)
    rec = yahoo(info, {'interval': interval, 'period1': start, 'period2': as_of + 1,
                       'includePrePost': 'false'})
    periods = rec['meta'].get('tradingPeriods', [])
    if isinstance(periods, dict):
        periods = periods.get('regular', [])
    sessions = {date_of(p['start'], zone): (p['start'],p['end']) for session in periods for p in session}
    provider_sessions = sessions.copy()
    quotes = rec['indicators']['quote'][0]
    bars = {}
    seconds = {'1m':60,'5m':300,'15m':900,'1h':3600}[interval]
    for i, t in enumerate(rec.get('timestamp', [])):
        vals = [quotes[k][i] if k in quotes else None for k in ('open','high','low','close','volume')]
        row = checked_bar(t, vals)
        if not row or t < start or t > as_of:
            continue
        local = dt.datetime.fromtimestamp(t, zone)
        default_end = int(local.replace(hour=16,minute=0,second=0).timestamp())
        _, end = sessions.get(local.date(), (None,default_end))
        if info['region']=='kr':
            # Yahoo advertises a 15:00 close for KRX. Its extra quote at that
            # timestamp can actually be the later official close. Do not attach
            # that observation to a historical intraday bucket.
            native_end=provider_sessions.get(local.date(),(None,default_end))[1]
            if t>=native_end:
                continue
            first, last=korea.hours(local.date())
            start_of_day=midnight(local.date(),zone)
            end=start_of_day+last*60
            sessions[local.date()]=(start_of_day+first*60,end)
        if t == end and bars:
            # The extra official close row is an auction mark without incremental volume.
            final = bars[max(bars)]
            if 0 < t-final[0] <= seconds and date_of(final[0],zone)==local.date():
                final[2] = max(final[2],row[2])
                final[3] = min(final[3],row[3])
                final[4] = row[4]
            continue
        opening = split_session(info,t)
        if t >= end or opening is None or (local.hour * 60 + local.minute - opening) % (seconds//60) != 0:
            continue
        bars[t] = row
    missing = {day for day,(opening,closing) in sessions.items()
               if any(t not in bars for t in range(opening,closing,seconds) if start<=t<=as_of)}
    return bars, missing


def yahoo_series(info, interval, start, as_of):
    now = dt.datetime.now(dt.timezone.utc)
    zone = zone_for(info)
    limit = 29 if interval=='1m' else 59 if interval=='15m' else 729
    start = max(start,midnight(now.astimezone(zone).date()-dt.timedelta(days=limit),zone))
    if start > as_of:
        return []
    if interval=='1m':
        bars={}
        cursor=start
        while cursor<=as_of:
            upper=min(cursor+6*86400-1,as_of)
            batch,_=yahoo_window(info,interval,cursor,upper)
            bars.update(batch)
            cursor=upper+1
        return [bars[t] for t in sorted(bars)]
    bars, missing = yahoo_window(info,interval,start,as_of)
    if info['region']=='kr':
        return [bars[t] for t in sorted(bars)]
    # Long Yahoo chart responses can contain null quotes for a session even
    # when the same real bars exist in its focused history. Retry those dates.
    for day in sorted(missing):
        lower = max(start,midnight(day-dt.timedelta(days=1),zone))
        upper = min(as_of,midnight(day+dt.timedelta(days=2),zone)-1)
        narrow, short_missing = yahoo_window(info,interval,lower,upper)
        if day in short_missing and (dt.datetime.now(zone).date()-day).days<59:
            fine,_ = yahoo_window(info,'5m',lower,upper)
            combined = aggregate([fine[t] for t in sorted(fine) if date_of(t,zone)==day],15 if interval=='15m' else 60,info)
            close=midnight(day,zone)+16*3600
            width=900 if interval=='15m' else 3600
            for row in combined:
                if all(t in fine for t in range(row[0],min(row[0]+width,close),300)):
                    narrow[row[0]]=row
        old = {t for t in bars if date_of(t,zone)==day}
        new = {t for t in narrow if date_of(t,zone)==day}
        if new.issuperset(old):
            bars.update({t:narrow[t] for t in new})
    return [bars[t] for t in sorted(bars)]


def merge_archive(previous, fresh, lower):
    old = [r for r in previous if r[0] >= lower]
    if not old or not fresh:
        return fresh or old
    overlap = {r[0]:r[4] for r in old}
    # Avoid attaching nominal prices on old and new sides of a split/restatement.
    if any(abs(overlap[r[0]] - r[4]) > max(0.02, abs(r[4])*0.01) for r in fresh if r[0] in overlap):
        return fresh
    return stitch(old, fresh)


def write(info, args):
    symbol = info['symbol']
    zone = zone_for(info)
    local_quote = args.snapshots / 'data' / (symbol + '.json')
    state = json.loads(local_quote.read_text())
    if state['symbol'] != symbol or state['sourceId'] not in ('tencent-index','tencent-stock-qfq','yahoo-chart','naver-krx'):
        raise ValueError(f'{symbol}: snapshot source mismatch')
    as_of = state['asOf'] // 1000
    start = midnight(START, zone)
    # The full daily archive stays available when a rolling quote snapshot drops
    # January. Use its entire 2026+ range and the latest same-source snapshot.
    full_daily = args.snapshots / 'history' / (symbol+'.json.gz')
    if not full_daily.exists():
        full_daily = SITE / 'history' / (symbol+'.json.gz')
    history = json.loads(gzip.decompress(full_daily.read_bytes()))
    if history['symbol'] != symbol or history['sourceId'] != state['sourceId']:
        raise ValueError(f'{symbol}: daily history source mismatch')
    daily = [r for r in stitch(history['rows'], state['days']) if start <= r[0] <= as_of]
    if not daily:
        raise ValueError(f'{symbol}: no daily bars')
    dest = args.output / (symbol + '.json.gz')
    previous = {}
    for f in [dest, SITE/'year'/(symbol+'.json.gz')]:
        if f.exists():
            prior = json.loads(gzip.decompress(f.read_bytes()))
            if prior.get('symbol')==symbol and prior.get('sourceId')==state['sourceId'] and prior.get('startDate')==START.isoformat():
                if prior['asOf'] > state['asOf']:
                    raise ValueError(f'{symbol}: existing archive is newer than snapshot')
                previous = dict(prior.get('bars',{}))
                previous['minuteSource'] = prior.get('minuteSourceId')
                previous['quarterSource'] = prior.get('intradaySourceId')
                previous['sinaBasis'] = prior.get('intradaySourceId','').startswith('sina-cn-')
                break
    if info['region']=='cn':
        old = previous.get('15m',[]) if previous.get('sinaBasis') else []
        quarters = merge_archive(old, sina_quarters(info,start,as_of), start)
        if quarters and date_of(quarters[-1][0],zone)==date_of(as_of,zone) and dt.datetime.fromtimestamp(as_of,zone).hour>=15:
            if abs(quarters[-1][4] - state['price']) > max(.025, state['price']*.0001):
                raise ValueError(f'{symbol}: Sina final trade disagrees with same-day Tencent quote')
        source_id = 'sina-cn-stock-raw' if info['type']=='stock' else 'sina-cn-index-raw'
        # Hourly China bars are exact regular-session aggregations of the archive.
        hourly = []
    elif info['region']=='kr':
        source_id='yahoo-chart'
        old_quarters=previous.get('15m',[]) if previous.get('quarterSource')==source_id else []
        quarters=merge_archive(old_quarters,yahoo_series(info,'15m',start,as_of),start)
        lower=max(start,previous['1h'][-1][0]-14*86400) if previous.get('1h') else start
        hourly=merge_archive(previous.get('1h',[]),yahoo_series(info,'1h',lower,as_of),start)
        def regular_observations(rows):
            return [r for r in rows if dt.datetime.fromtimestamp(r[0],zone).hour<15]
        hourly=regular_observations(hourly)
        quarters=regular_observations(quarters)
    else:
        source_id = 'yahoo-chart'
        lower = max(start, previous.get('1h',[[start]])[-1][0]-14*86400) if previous.get('1h') else start
        hourly = merge_archive(previous.get('1h',[]), yahoo_series(info,'1h',lower,as_of), start)
        quarters = merge_archive(previous.get('15m',[]),yahoo_series(info,'15m',start,as_of),start)
    minute_source = state.get('minuteSourceId')
    if not minute_source or not state.get('minutes'):
        raise ValueError(f'{symbol}: missing latest minute bars')
    older_minutes=previous.get('1m',[]) if previous.get('minuteSource')==minute_source else []
    if info['region']=='us':
        lower=max(start,older_minutes[-1][0]-3*86400) if older_minutes else start
        minutes=merge_archive(older_minutes,yahoo_series(info,'1m',lower,as_of),start)
    elif info['region']=='cn':
        fresh=state['minutes']
        by_time={r[0]:r for r in fresh}
        boundary=older_minutes[-1][0] if older_minutes else start
        while min(by_time)>boundary:
            last=min(by_time)
            cursor=dt.datetime.fromtimestamp(last+60,zone).strftime('%Y%m%d%H%M')
            older=cn_minutes(info,cursor)
            if not older or older[0][0]>=last:break
            by_time.update((r[0],r) for r in older if start<=r[0]<=as_of)
        minutes=[r for r in merge_archive(older_minutes,[by_time[t] for t in sorted(by_time)],start)
                 if split_session(info,r[0]) is not None]
    else:
        minutes=merge_archive(older_minutes,state['minutes'],start)
    if not minutes or not quarters or (info['region']!='cn' and not hourly):
        raise ValueError(f'{symbol}: empty intraday history')
    raw_bars = {'1d':daily,'15m':quarters,'1m':minutes}
    if hourly:
        raw_bars['1h'] = hourly
    day_keys = {date_of(r[0], zone) for r in daily}
    coverage = {}
    for interval, rows in [('1m',minutes),('1d',daily),('15m',quarters),('30m',quarters),('1h',hourly or quarters)]:
        dates = {date_of(r[0],zone) for r in rows}
        # Require every trading date, plus all regular-session bars for China,
        # whose cash market has no abbreviated sessions. US half sessions count.
        full = day_keys == dates
        if info['region']=='cn' and interval!='1d':
            counts = {}
            for row in rows:
                d = date_of(row[0],zone)
                counts[d] = counts.get(d,0)+1
            full = full and all(count==(240 if interval=='1m' else 16) or (d==date_of(as_of,zone) and dt.datetime.fromtimestamp(as_of,zone).hour<15) for d,count in counts.items())
        if info['region']=='us' and interval=='1h' and full:
            # Within an otherwise full-length series, a missing interior hour is
            # distinguishable from an abbreviated close or a trading holiday.
            for prev,cur in zip(rows,rows[1:]):
                if date_of(prev[0],zone)==date_of(cur[0],zone) and cur[0]-prev[0]>3600:
                    full=False
                    break
        if info['region']=='kr' and interval=='1h':
            # Yahoo's Korean hourly regular-session feed omits minutes near the
            # close on special sessions; the archive shows its date range but marks partial coverage.
            full=False
        coverage[interval] = 'full' if full else 'partial'
    payload={'schema':1,'symbol':symbol,'sourceId':state['sourceId'],'source':state['source'],
             'intradaySourceId':source_id,'intradaySource':('新浪财经' if info['region']=='cn' else 'Yahoo Finance' if info['region']=='kr' else state['source']),
             'minuteSourceId':minute_source,'minuteSource':state['minuteSource'],
             'hourSourceId':'yahoo-chart' if info['region']=='kr' else source_id,
             'hourSource':'Yahoo Finance' if info['region']=='kr' else ('新浪财经' if info['region']=='cn' else state['source']),
             'startDate':START.isoformat(),'asOf':state['asOf'],'coverage':coverage,'bars':raw_bars}
    packed=gzip.compress(json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode(),compresslevel=8,mtime=0)
    dest.parent.mkdir(parents=True,exist_ok=True)
    tmp=dest.with_suffix('.tmp')
    tmp.write_bytes(packed)
    tmp.replace(dest)
    return f'{symbol}: {len(quarters)}×15m from {date_of(quarters[0][0],zone)}, {len(hourly or aggregate(quarters,60,info))}×1h, {len(daily)}×1d; {coverage}'


if __name__=='__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--snapshots',type=Path,default=SITE)
    cli.add_argument('--output',type=Path,default=SITE/'year')
    cli.add_argument('--symbols',nargs='+')
    cli.add_argument('--region',choices=['us','cn','kr','asia'])
    cli.add_argument('--workers',type=int,default=3)
    args=cli.parse_args()
    universe=[i for i in CATALOG if (not args.symbols or i['symbol'] in args.symbols) and (not args.region or i['region']==args.region or (args.region=='asia' and i['region'] in ('cn','kr')))]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs={pool.submit(write,i,args):i['symbol'] for i in universe}
        failures=[]
        for job in as_completed(jobs):
            try:
                print(job.result(),flush=True)
            except Exception as exc:
                failures.append(jobs[job]);print(jobs[job],str(exc),flush=True)
    if failures:
        raise SystemExit('Could not update '+', '.join(failures))
