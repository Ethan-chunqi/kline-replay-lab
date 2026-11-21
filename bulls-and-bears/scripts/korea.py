"""Naver Pay Securities KRX session candles. Timestamps label the beginning of a bar."""
import datetime as dt
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('Asia/Seoul')
INDEX_CODES = {'KOSPI':'KOSPI', 'KOSDAQ':'KOSDAQ', 'KOSPI200':'KPI200'}

def hours(day):
    date = day.isoformat()
    if date == '2026-11-19':
        return 600,990
    if date == '2026-01-02':
        return 600,930
    return 540,930

def naver(info, timeframe, start, end, fetch):
    kind = 'index' if info['type']=='index' else 'item'
    code = INDEX_CODES.get(info['symbol'],info['symbol'])
    url = ('https://api.stock.naver.com/chart/domestic/'+kind+'/'+code+'/'+timeframe+
           '?startDateTime='+start.strftime('%Y%m%d')+'0000&endDateTime='+end.strftime('%Y%m%d')+'2359&wrapper=true')
    rec = fetch([url])
    if not isinstance(rec,dict) or rec.get('stockExchangeType')!='KRX':
        raise ValueError('Invalid Naver KRX chart for '+code)
    return rec['priceInfos']

def daily(info,fetch,checked_bar):
    rows=[]
    for r in naver(info,'day',dt.date(1980,1,1),dt.datetime.now(ZONE).date(),fetch):
        stamp=int(dt.datetime.strptime(r['localDate'],'%Y%m%d').replace(tzinfo=ZONE).timestamp())
        b=checked_bar(stamp,[r.get(k) for k in ('openPrice','highPrice','lowPrice','closePrice','accumulatedTradingVolume')])
        if b:rows.append(b)
    return sorted(rows)

def intraday(info,minutes,fetch,checked_bar):
    now=dt.datetime.now(ZONE)
    rows=naver(info,'minute' if minutes==1 else 'minute'+str(minutes),now.date()-dt.timedelta(days=20),now.date(),fetch)
    bars={}
    for r in rows:
        local=dt.datetime.strptime(r['localDateTime'],'%Y%m%d%H%M%S').replace(tzinfo=ZONE)
        opening, closing=hours(local.date())
        minute=local.hour*60+local.minute
        if not opening<=minute<=closing:continue
        stamp=int(local.timestamp())
        b=checked_bar(stamp,[r.get(k) for k in ('openPrice','highPrice','lowPrice','currentPrice','accumulatedTradingVolume')])
        if not b:continue
        if minute==closing:
            # Only incorporate the official closing print. Naver may put subsequent extended
            # session trades in the same 15m row. Its opening trade is the auction mark.
            last=next(reversed(bars.values()),None)
            if last and 0<stamp-last[0]<=minutes*60 and dt.datetime.fromtimestamp(last[0],ZONE).date()==local.date():
                last[2]=max(last[2],b[1]); last[3]=min(last[3],b[1]); last[4]=b[1]
                if b[1]==b[2]==b[3]==b[4]:last[5]+=b[5]
            elif minutes==1:
                # Cash auctions have a no-trading period immediately before the close.
                bars[stamp-60]=[stamp-60,b[1],b[1],b[1],b[1],b[5] if b[1]==b[2]==b[3]==b[4] else 0]
            continue
        if (minute-opening)%minutes==0:bars[stamp]=b
    return [bars[t] for t in sorted(bars)]
