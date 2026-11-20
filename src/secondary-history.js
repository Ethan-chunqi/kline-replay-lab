// Sina's public dated-contract intraday history. Execution quotes still come from the quote provider.
const host = 'https://stock2.finance.sina.com.cn';
const prefixes = { csi1000: 'IM', csi500: 'IC', csi300: 'IF' };
const durations = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1H': 60 };

function loadPublicRows(url, signal) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.referrerPolicy = 'no-referrer';
    if ('credentialless' in frame) frame.credentialless = true;
    const token = [...crypto.getRandomValues(new Uint32Array(4))]
      .map((n) => n.toString(16).padStart(8, '0'))
      .join('');
    let timeout;
    function finish(done, result) {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      signal?.removeEventListener('abort', cancel);
      frame.remove();
      done(result);
    }
    function cancel() {
      finish(reject, signal.reason ?? new DOMException('已取消', 'AbortError'));
    }
    function receive(event) {
      if (event.origin !== 'null' || event.source !== frame.contentWindow || event.data?.token !== token)
        return;
      if (!Array.isArray(event.data.rows))
        return finish(reject, new Error('新浪财经未返回该月份合约的分钟行情'));
      finish(resolve, event.data.rows);
    }
    if (signal?.aborted) return cancel();
    window.addEventListener('message', receive);
    signal?.addEventListener('abort', cancel, { once: true });
    timeout = setTimeout(() => finish(reject, new Error('新浪财经分钟行情请求超时')), 8500);
    // Only this isolated, opaque-origin document executes the provider's JSONP.
    frame.srcdoc =
      '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-' +
      token +
      "' " +
      host +
      "; base-uri 'none'; form-action 'none'\">" +
      '<script referrerpolicy="no-referrer" src="' +
      url.replaceAll('&', '&amp;') +
      '"></script>' +
      '<script nonce="' +
      token +
      '">parent.postMessage({token:"' +
      token +
      '",rows:globalThis.wavelabCffexRows},"*")</script>';
    document.body.append(frame);
  });
}

function parseRows(rows, minutes) {
  if (!rows.length || rows.length > 10000) throw new Error('新浪财经返回的 K 线数量无效');
  let previous = 0;
  return rows.map((row) => {
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):00$/.exec(row?.d);
    if (!match) throw new Error('新浪财经返回的分钟 K 线时间无效');
    const day = Date.parse(match[1] + 'T00:00:00Z');
    const minute = Number(match[2]) * 60 + Number(match[3]);
    const sessionStart = minute > 780 && minute <= 900 ? 780 : 570;
    const validSession = (minute > 570 && minute <= 690) || (minute > 780 && minute <= 900);
    if (
      !Number.isFinite(day) ||
      new Date(day).toISOString().slice(0, 10) !== match[1] ||
      !validSession ||
      (minute - sessionStart) % minutes !== 0
    )
      throw new Error('新浪财经返回了无法对应中金所交易时段的 K 线');
    const time = day / 1000 + (minute - 480 - minutes) * 60;
    const values = ['o', 'h', 'l', 'c', 'v'].map((key) =>
      row[key] === '' || row[key] == null ? NaN : Number(row[key]),
    );
    const [open, high, low, close, volume] = values;
    if (
      !values.every(Number.isFinite) ||
      low <= 0 ||
      low > Math.min(open, close) ||
      high < Math.max(open, close) ||
      volume < 0 ||
      time <= previous
    )
      throw new Error('新浪财经返回的价格、交易量或时间顺序无效');
    previous = time;
    return { time, open, high, low, close, volume };
  });
}

export async function fetchSecondaryHistory(marketId, symbol, base, { signal } = {}) {
  const prefix = prefixes[marketId];
  const monthly = /^(IM|IC|IF)\d{2}(0[1-9]|1[0-2])$/.exec(symbol);
  if (!prefix || !monthly || monthly[1] !== prefix)
    throw new Error('新浪备用行情只支持与标的相符的中金所具体月份合约');
  const minutes = durations[base];
  if (!minutes) throw new Error('新浪备用行情仅提供 1、5、15、30、60 分钟 K 线');
  const endpoint = new URL(
    '/futures/api/jsonp.php/var%20wavelabCffexRows=/InnerFuturesNewService.getFewMinLine',
    host,
  );
  endpoint.searchParams.set('symbol', symbol);
  endpoint.searchParams.set('type', String(minutes));
  const bars = parseRows(await loadPublicRows(endpoint.href, signal), minutes);
  const sourceUrl = 'https://finance.sina.com.cn/futures/quotes/' + symbol + '.shtml';
  return {
    bars,
    symbol,
    base,
    historySource: '新浪财经',
    sourceUrl,
    historySourceUrl: sourceUrl,
    dataUrl: endpoint.href,
    asOf: bars.at(-1).time + minutes * 60,
  };
}
