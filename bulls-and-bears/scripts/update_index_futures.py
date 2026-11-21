#!/usr/bin/env python3
"""Eastmoney actual main-month quotes + CFFEX contract-life trading days and published margin parameters."""
import argparse
import concurrent.futures
import csv
import datetime as dt
import io
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from zoneinfo import ZoneInfo

sys.dont_write_bytecode = True
from update_equities import atomic, checked_bar, snapshot, stitch

CN = ZoneInfo('Asia/Shanghai')
ROOT = Path(__file__).resolve().parent.parent
SITE = next(p for p in (ROOT/'dist/futures',ROOT/'futures') if (p/'catalog.js').exists())
CFF = 'http://www.cffex.com.cn'
MAIN_URL = 'https://qhweb.eastmoney.com/quote'
TYPES = {'IM':200,'IC':200,'IF':300,'IH':300}
QUOTE = 'https://futsseapi.eastmoney.com/list/custom/'
FIELDS = 'name,p,zdf,vol,ccl,o,h,l,zjsj,dm,sc,uid,jysj'
PARAMS = {'orderBy':'','sort':'','pageSize':999,'pageIndex':0,'specificContract':'true','platform':'zbPC','field':FIELDS}


def request(url,tries=3):
    for i in range(tries):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36','Referer':MAIN_URL})
            with urllib.request.urlopen(req,timeout=10) as resp:
                return resp.read()
        except Exception:
            if i+1==tries:raise
            time.sleep(.3*(i+1))


def stamp(s,pattern='%Y-%m-%d'):
    return int(dt.datetime.strptime(s,pattern).replace(tzinfo=CN).timestamp())


def official(path):
    # CFFEX also publishes the signed-off day tables over HTTP on networks where its HTTPS endpoint is unavailable.
    return request(CFF+path)


def official_rows(raw):
    text=raw.decode('gb18030').lstrip('\ufeff')
    if '合约代码' not in text[:50]:raise ValueError('Missing CFFEX daily report')
    return list(csv.DictReader(io.StringIO(text)))


def em_contracts():
    page=request(MAIN_URL).decode()
    start=re.search(r'zhuliCodesMap:\s*',page)
    primary=json.JSONDecoder().raw_decode(page[start.end():])[0]['zhuli']
    contracts={p:next(c for c in primary if re.fullmatch(p+r'\d{4}',c)) for p in TYPES}
    url=QUOTE+','.join('CFFEX_'+c for c in contracts.values())+'?'+urllib.parse.urlencode(PARAMS)
    rows=json.loads(request(url))['list']
    quotes={r['dm']:r for r in rows if r.get('uid')=='CFFEX|'+r['dm'] and int(r['sc'])==220}
    if set(quotes)!=set(contracts.values()):raise ValueError('Missing Eastmoney identified contract')
    return contracts,quotes


def last_report(today):
    for i in range(18):
        date=today-dt.timedelta(days=i)
        if date.weekday()>=5:continue
        label=date.strftime('%Y%m%d')
        path='/sj/hqsj/rtj/'+date.strftime('%Y%m/%d/')+label+'_1.csv'
        try: rows=official_rows(official(path))
        except (OSError,ValueError):continue
        if rows:return date,path,rows
    raise RuntimeError('No recent official closing report')


def published_margins(today):
    listing=official('/cn/jscs.html').decode()
    links=sorted(set(re.findall(r'href="(/sj/jscs/\d{6}/\d{2}/(\d{8})_1\.csv)"',listing)),key=lambda x:x[1],reverse=True)
    path,date=next(x for x in links if x[1]<=today.strftime('%Y%m%d'))
    lines=official(path).decode('gb18030').lstrip('\ufeff').splitlines()
    rows={r['期货合约'].strip():r for r in csv.DictReader(lines[1:]) if r.get('期货合约')}
    return dt.datetime.strptime(date,'%Y%m%d').date().isoformat(),CFF+path,rows


def copy_months(start,end):
    yr,mo=start.year,start.month
    while (yr,mo)<=(end.year,end.month):
        yield '%04d%02d'%(yr,mo)
        yr,mo=(yr+1,1) if mo==12 else (yr,mo+1)


def archive_month(month,contracts):
    try:
        raw=official('/sj/historysj/'+month+'/zip/'+month+'.zip')
    except urllib.error.HTTPError as e:
        if e.code in (404,410):return {}
        raise
    result={}
    if not raw.startswith(b'PK'):return result
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            m=re.search(r'(\d{8})_1\.csv$',name)
            if not m:continue
            result[m[1]]={r['合约代码'].strip():r for r in official_rows(z.read(name)) if r['合约代码'].strip() in contracts}
    return result


def sina(contract,kind):
    url='https://stock.finance.sina.com.cn/futures/api/openapi.php/InnerFuturesNewService.'+kind+'?symbol='+contract
    if kind=='getFewMinLine':url+='&type=15'
    rec=json.loads(request(url))['result']
    if rec['status']['code']!=0 or not rec.get('data'):raise ValueError('Missing actual contract bars')
    return rec['data']


def minute_bars(contract):
    # Prefer Eastmoney exact-contract trade-price bars when its history endpoint is available.
    params={'secid':'220.'+contract,'klt':'15','fqt':'0','lmt':'10000','end':'20500101','fields1':'f1,f2,f3,f4,f5,f6','fields2':'f51,f52,f53,f54,f55,f56,f57'}
    url='https://push2his.eastmoney.com/api/qt/stock/kline/get?'+urllib.parse.urlencode(params)
    try:
        j=json.loads(request(url,tries=1))['data']
        if j['code']!=contract:raise ValueError('Wrong Eastmoney symbol')
        out=[]
        for line in j['klines']:
            t,o,c,h,l,v,*_=line.split(',')
            out.append(checked_bar(stamp(t,'%Y-%m-%d %H:%M')-900,[o,h,l,c,v]))
        if not out or any(x is None for x in out):raise ValueError('Incomplete Eastmoney bars')
        return out,'东方财富期货'
    except Exception:
        out=[]
        for r in sina(contract,'getFewMinLine'):
            bar=checked_bar(stamp(r['d'],'%Y-%m-%d %H:%M:%S')-900,[r[k] for k in ('o','h','l','c','v')])
            if bar:out.append(bar)
        return out,'新浪期货'


def margin_rate(raw):
    if not raw or not re.fullmatch(r'\d+(?:\.\d+)?%',raw.strip()):return None
    n=float(raw.strip()[:-1])/100
    return n if 0<n<=1 else None


def publish(args):
    today=dt.datetime.now(CN).date()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:
        contracts_job=p.submit(em_contracts)
        report_job=p.submit(last_report,today)
        margin_job=p.submit(published_margins,today)
        contracts,quotes=contracts_job.result()
        date,report_path,offrows=report_job.result()
        margindate,marginurl,margins=margin_job.result()
    tpath='/sj/jycs/'+date.strftime('%Y%m/%d')+'/index.xml'
    params={r.findtext('INSTRUMENT_ID'):{v.tag:v.text for v in r} for r in ET.fromstring(official(tpath))}
    exact=set(contracts.values())
    # A newly listed real month can appear on Eastmoney one day before it enters the closing parameters.
    if not exact.issubset(params):raise ValueError('A main month has no confirmed listing parameters yet')
    starts={c:dt.datetime.strptime(params[c]['OPEN_DATE'],'%Y%m%d').date() for c in exact}
    existing={}
    for product,c in contracts.items():
        for root in [args.output,SITE]:
            path=root/'data'/(product+'.json')
            if path.is_file():
                obj=json.loads(path.read_bytes())
                if obj.get('contract')==c and obj.get('listingDate')==starts[c].isoformat() and obj.get('dailySource')=='中金所':
                    existing[c]=obj; break
    first=min((dt.datetime.fromtimestamp(existing[c]['lastOfficialDay']/1000,CN).date() if c in existing else starts[c]) for c in exact)
    months=list(copy_months(first,date))
    reports={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:
        for pieces in p.map(lambda month:archive_month(month,exact),months):reports.update(pieces)
    reports[date.strftime('%Y%m%d')]={r['合约代码'].strip():r for r in offrows if r['合约代码'].strip() in exact}
    # Some current-month ZIP mirrors publish with a delay. Read the exchange day files for any missing weekday.
    missing=[]
    for j in range((date-first).days+1):
        d=first+dt.timedelta(days=j)
        if d.weekday()<5 and d.strftime('%Y%m%d') not in reports:missing.append(d)
    def get_day(d):
        label=d.strftime('%Y%m%d')
        try:rows=official_rows(official('/sj/hqsj/rtj/'+d.strftime('%Y%m/%d/')+label+'_1.csv'))
        except urllib.error.HTTPError as e:
            if e.code in (404,410):return label,{}
            raise
        except ValueError:return label,{}
        return label,{r['合约代码'].strip():r for r in rows if r['合约代码'].strip() in exact}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:
        for d,rows in p.map(get_day,missing):reports[d]=rows
    def write(item):
        product,c=item
        q=quotes[c];current=reports[date.strftime('%Y%m%d')][c]
        # Reuse only signed-off previous trading dates; discard any old partial daily row.
        prev=existing.get(c)
        prior=[r for r in prev['days'] if r[0]*1000<=prev['lastOfficialDay']] if prev else []
        rows=[]
        for label,group in sorted(reports.items()):
            d=group.get(c)
            if not d or int(d['成交量'])==0:continue
            bar=checked_bar(stamp(label,'%Y%m%d'),[d[k] for k in ['今开盘','最高价','最低价','今收盘','成交量']])
            if bar:rows.append(bar)
        daily=stitch(prior,rows)
        if daily[0][0]!=stamp(starts[c].isoformat()):raise ValueError(c+' archive missing first trading day')
        # Independently require every vendor-reported traded date through the official close.
        # A missing day file on a holiday is expected; a traded date absent from the exchange series is not.
        reference_days={stamp(r['d']) for r in sina(c,'getDailyKLine')
                        if float(r.get('v') or 0)>0 and stamp(r['d'])<=stamp(date.isoformat())}
        actual_days={r[0] for r in daily}
        if not reference_days or reference_days-actual_days:
            raise ValueError(c+' missing independently reported trading dates: '+str(sorted(reference_days-actual_days)))
        intr,bar_source=minute_bars(c)
        if prev:intr=stitch(prev['intraday'],intr)
        intr=[r for r in intr if r[0]>=daily[0][0]]
        verified_final=all(abs(float(current[key])-float(q[k]))<=.001 for key,k in [('今收盘','p'),('今开盘','o'),('最高价','h'),('最低价','l'),('成交量','vol'),('前结算','zjsj')])
        if verified_final:
            sd=stamp(date.isoformat());asof=sd+15*3600
        else:
            # Identify a later live session independently from date-stamped K-lines and the previous official settlement.
            latest_date=dt.datetime.fromtimestamp(intr[-1][0],CN).date()
            if latest_date<=date or abs(float(q['zjsj'])-float(current['今结算']))>.001:raise ValueError(c+' provider dates/settlements disagree')
            sd=stamp(latest_date.isoformat())
            hms=str(int(q['jysj'])).zfill(6)
            emtime=stamp(latest_date.isoformat()+' '+hms,'%Y-%m-%d %H%M%S')
            asof=min(emtime,sd+15*3600,int(time.time()))
            if asof<sd+9.5*3600 or abs(asof-(intr[-1][0]+900))>1800:raise ValueError(c+' intraday time mismatch')
            daily=stitch(daily,[[sd,float(q['o']),float(q['h']),float(q['l']),float(q['p']),int(q['vol'])]])
        meta={'price':float(q['p']),'asOf':asof,'tradeDay':sd,'source':'东方财富期货','sourceId':'cffex-'+c,
              'dayHigh':float(q['h']),'dayLow':float(q['l']),'prevClose':float(q['zjsj']),'sessionEnd':(sd+15*3600)*1000}
        data,_=snapshot({'symbol':product,'region':'cn'},daily,intr,meta)
        margin=margins.get(c,{})
        buy=margin_rate(margin.get('合约多头保证金标准'));sell=margin_rate(margin.get('合约空头保证金标准'))
        data.update(contract=c,multiplier=TYPES[product],tick=.2,marginRate=buy if buy==sell else None,
            marginRateLong=buy,marginRateShort=sell,marginAsOf=margindate if margin else None,marginSourceUrl=marginurl if margin else None,
            quoteUrl='https://quote.eastmoney.com/qihuo/'+c+'.html',mainSourceUrl=MAIN_URL,officialSourceUrl=CFF+report_path,
            listingDate=starts[c].isoformat(),expiryDate=dt.datetime.strptime(params[c]['END_TRADING_DAY'],'%Y%m%d').date().isoformat(),
            prevClose=float(q['zjsj']),prevSettlement=float(q['zjsj']),settlement=float(current['今结算']) if verified_final else None,
            openInterest=int(q['ccl']),volume=int(q['vol']),lastOfficialDay=stamp(date.isoformat())*1000,barSource=bar_source,
            dailySource='中金所',officialCloseVerified=verified_final,days=daily)
        path=args.output/'data'/(product+'.json')
        if path.exists():
            previous=json.loads(path.read_bytes())
            if previous['asOf']>data['asOf']:raise ValueError('Regressing quote '+c)
            if {k:v for k,v in previous.items() if k!='generatedAt'}=={k:v for k,v in data.items() if k!='generatedAt'}:return c+' unchanged'
        atomic(path,json.dumps(data,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode())
        return f"{c} {data['price']} {len(daily)} daily {len(intr)} 15min {data['barSource']}, CFFEX margin {buy}/{sell}"
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:
        for line in p.map(write,contracts.items()):print(line,flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=SITE)
    publish(parser.parse_args())
