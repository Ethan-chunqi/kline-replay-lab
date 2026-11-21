#!/usr/bin/env python3
"""Rebuild USDT perpetual anchors from exchange trade-price klines.

Usage: python3 scripts/build_anchors.py [--through YYYY-MM-DD] [--symbols BNBUSDT SOLUSDT]
By default, rebuild all five markets in the public site directory.
--through is an inclusive, already closed UTC date. Only the Python standard library is needed.
"""
import argparse
import concurrent.futures
import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

SYMBOLS = ("BTCUSDT", "BNBUSDT", "HYPEUSDT", "SOLUSDT", "ZECUSDT")
DAY = 86_400_000
MINUTE = 60_000
HISTORY_SEARCH_START = 1_483_228_800_000  # 2017-01-01, before either perpetual launched
BINANCE = "binance-usdm"
BYBIT = "bybit-linear"


@dataclass(frozen=True)
class Bar:
    time: int
    high: Decimal
    low: Decimal
    close: Decimal


def read_json(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "perpetual-history/1.0"})
            with urllib.request.urlopen(req, timeout=35) as res:
                data = json.load(res)
            if isinstance(data, dict) and (data.get("retCode", 0) != 0 or data.get("code", 0) < 0):
                raise ValueError(f"Exchange error: {data}")
            return data
        except (OSError, ValueError) as error:
            if attempt == 3:
                raise RuntimeError(f"Failed to read {url}") from error
            time.sleep(2 ** attempt)


def candles_url(source, symbol, step, start, end):
    if source == BINANCE:
        endpoint = "https://fapi.binance.com/fapi/v1/klines"
        query = dict(symbol=symbol, interval="1d" if step == DAY else "1m",
                     startTime=start, endTime=end, limit=1000)
    else:
        endpoint = "https://api.bybit.com/v5/market/kline"
        query = dict(category="linear", symbol=symbol, interval="D" if step == DAY else "1",
                     start=start, end=end, limit=1000)
    return endpoint + "?" + urllib.parse.urlencode(query)


def read_bars(source, symbol, step, start, end, prelaunch=False):
    bars = []
    for left in range(start, end + 1, step * 1000):
        right = min(end, left + step * 1000 - 1)
        response = read_json(candles_url(source, symbol, step, left, right))
        rows = response if source == BINANCE else response["result"]["list"]
        for row in rows:
            timestamp = int(row[0])
            if left <= timestamp <= right:
                bars.append(Bar(timestamp, Decimal(row[2]), Decimal(row[3]), Decimal(row[4])))
    bars.sort(key=lambda b: b.time)
    if not bars or bars[-1].time != end // step * step:
        raise ValueError(f"{source}: missing end of {step}ms series")
    if not prelaunch and bars[0].time != start:
        raise ValueError(f"{source}: missing beginning of {step}ms series")
    for a, b in zip(bars, bars[1:]):
        if b.time - a.time != step:
            raise ValueError(f"{source}: missing or duplicate bar after {a.time}")
    return bars


def server_time(source):
    if source == BINANCE:
        return int(read_json("https://fapi.binance.com/fapi/v1/time")["serverTime"])
    return int(read_json("https://api.bybit.com/v5/market/time")["result"]["timeNano"]) // 1_000_000


def build_source(source, symbol, end):
    daily = read_bars(source, symbol, DAY, HISTORY_SEARCH_START, end, prelaunch=True)
    high_day = max(daily, key=lambda b: b.high)
    peak_day_minutes = read_bars(source, symbol, MINUTE, high_day.time, high_day.time + DAY - 1,
                                 prelaunch=(high_day.time == daily[0].time))
    high_bar = max(peak_day_minutes, key=lambda b: b.high)
    if high_bar.high != high_day.high:
        raise ValueError(f"{source}: highest daily price differs from its minute data")

    # A pre-peak low on the ATH date cannot seed a post-ATH drawdown.
    # Recover later minutes on that date before comparing all subsequent days.
    # The close of the peak minute is the only definitely post-high or equal price
    # inside that minute. If the ordering could change the answer, fail explicitly.
    candidates = [(high_bar.close, high_bar.time, MINUTE)]
    candidates.extend((b.low, b.time, MINUTE) for b in peak_day_minutes if b.time > high_bar.time)
    candidates.extend((b.low, b.time, DAY) for b in daily if b.time > high_day.time)
    low, low_time, resolution = min(candidates, key=lambda c: (c[0], c[1]))
    if high_bar.low < low or (high_bar.low == low and low_time != high_bar.time):
        raise ValueError(f"{source}: ticks in the ATH minute are needed to establish the first later low")
    if resolution == DAY:
        low_minutes = read_bars(source, symbol, MINUTE, low_time, low_time + DAY - 1)
        low_bar = min(low_minutes, key=lambda b: b.low)
        if low_bar.low != low:
            raise ValueError(f"{source}: lowest daily price differs from its minute data")
        low_time = low_bar.time

    def anchor(price, timestamp):
        return dict(price=float(price), time=timestamp, precision="minute", precisionMs=MINUTE,
                    evidence=candles_url(source, symbol, MINUTE, timestamp, timestamp + MINUTE - 1))

    return dict(asOf=end, historyStart=daily[0].time, dailyBars=len(daily),
                high=anchor(high_bar.high, high_bar.time), low=anchor(low, low_time))


def active_contracts(symbols):
    """List actually trading USDT-settled perpetuals; an API failure must not silently omit a venue."""
    listing = read_json("https://fapi.binance.com/fapi/v1/exchangeInfo")
    binance_symbols = {i["symbol"] for i in listing["symbols"]
                       if i["contractType"] == "PERPETUAL" and i["quoteAsset"] == "USDT"
                       and i["marginAsset"] == "USDT" and i["status"] == "TRADING"}
    result = {}
    for symbol in symbols:
        url = f"https://api.bybit.com/v5/market/instruments-info?category=linear&symbol={symbol}"
        instruments = read_json(url)["result"]["list"]
        available_bybit = any(i["symbol"] == symbol and i["contractType"] == "LinearPerpetual"
                              and i["settleCoin"] == "USDT" and i["status"] == "Trading"
                              for i in instruments)
        venues = []
        if symbol in binance_symbols:
            venues.append(BINANCE)
        if available_bybit:
            venues.append(BYBIT)
        if not venues:
            raise ValueError(f"{symbol}: no active linear perpetual found")
        result[symbol] = venues
    return result


def write_anchors(output, symbol, sources):
    data = dict(schemaVersion=1, symbol=symbol, market="perpetual", sources=sources,
                method="Each exchange's linear USDT perpetual last-trade prices. First minute reaching the all-time high; first minute reaching the lowest later price. UTC millisecond timestamps identify minute opens. asOf is the last included UTC daily close.")
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(f".tmp-{os.getpid()}")
    try:
        tmp.write_text(payload, encoding="utf-8")
        tmp.replace(output)
    finally:
        tmp.unlink(missing_ok=True)
    for source, stats in sources.items():
        print(f"{symbol} {source}: {stats['dailyBars']} daily candles. ATH {stats['high']['price']}, subsequent low {stats['low']['price']}.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--through", type=dt.date.fromisoformat, help="inclusive closed UTC date")
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--public-dir", type=Path, default=(root / "dist" if (root / "dist").is_dir() else root))
    parser.add_argument("--symbols", nargs="+", choices=SYMBOLS, default=SYMBOLS)
    parser.add_argument("--output", type=Path, help="custom single-symbol file (BTCUSDT if --symbols is omitted)")
    args = parser.parse_args()
    if args.output and args.symbols == SYMBOLS:
        args.symbols = ("BTCUSDT",)
    if args.output and len(args.symbols) != 1:
        parser.error("--output accepts a single symbol")
    available = active_contracts(args.symbols)
    current_day = min(server_time(s) for s in {s for venues in available.values() for s in venues}) // DAY * DAY
    end = current_day - 1
    if args.through:
        next_day = dt.datetime.combine(args.through + dt.timedelta(days=1), dt.time(), dt.timezone.utc)
        end = int(next_day.timestamp() * 1000) - 1
    if end >= current_day:
        parser.error("--through must end before the current UTC day")

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {(symbol, source): pool.submit(build_source, source, symbol, end)
                for symbol, venues in available.items() for source in venues}
        for symbol, venues in available.items():
            sources = {s: jobs[symbol, s].result() for s in venues}
            relative = "anchors.json" if symbol == "BTCUSDT" else f"history/{symbol}.json"
            write_anchors(args.output or args.public_dir / relative, symbol, sources)


if __name__ == "__main__":
    main()
