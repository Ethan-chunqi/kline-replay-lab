import { parseBarsCSV } from './import.js';

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const body = () => document.getElementById('dialogBody');
const get = (name) => body().querySelector('[name="' + name + '"]');
const link = (url, label) =>
  '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>';
const fileLimit = 8 * 1024 * 1024;

export function openMarkets(api, ctx) {
  api.show(
    '选择市场',
    '<div class="option-list">' +
      ctx.markets
        .map(
          (m) =>
            '<button type="button" class="market-opt' +
            (m.id === ctx.market.id ? ' selected' : '') +
            '" data-market="' +
            esc(m.id) +
            '" aria-pressed="' +
            (m.id === ctx.market.id) +
            '"><strong>' +
            esc(m.name) +
            '</strong><small>' +
            esc(m.region) +
            ' · ' +
            esc(m.symbol) +
            ' · ' +
            esc(m.currency) +
            '</small></button>',
        )
        .join('') +
      '</div>',
  );
  for (const option of body().querySelectorAll('[data-market]')) {
    option.addEventListener('click', () => {
      api.close();
      ctx.onSwitch(option.dataset.market);
    });
  }
}

function inputNumber(name, title, value, min, max, step) {
  return (
    '<label class="field"><span>' +
    title +
    '</span><input type="number" required name="' +
    name +
    '" min="' +
    min +
    '" max="' +
    max +
    '" step="' +
    step +
    '" value="' +
    esc(value) +
    '"></label>'
  );
}

function startIndex(mode, count, typed) {
  // Index is zero-based internally. Leave at least one unopened bar for practice.
  if (mode === 'manual') {
    const index = Number(typed) - 1;
    if (!typed || !Number.isInteger(index) || index < 0 || index > count - 2)
      throw new Error('起点请填第 1 至 ' + (count - 1) + ' 根。');
    return index;
  }
  const warmup = Math.min(119, Math.max(0, Math.floor(count / 3) - 1));
  if (mode === 'fixed') return warmup;
  const upper = Math.max(warmup, count - 1 - Math.min(60, Math.ceil(count / 3)));
  return warmup + Math.floor(Math.random() * (upper - warmup + 1));
}

const simulatedIntervals = [
  ['1D', '日线'],
  ['1m', '1 分钟线'],
  ['3m', '3 分钟线'],
  ['5m', '5 分钟线'],
  ['10m', '10 分钟线'],
  ['15m', '15 分钟线'],
  ['30m', '30 分钟线'],
  ['1H', '1 小时线'],
  ['2H', '2 小时线'],
  ['4H', '4 小时线'],
];
const feedIntervals = [
  ['1m', '1 分钟线'],
  ['5m', '5 分钟线'],
  ['15m', '15 分钟线'],
  ['30m', '30 分钟线'],
  ['1H', '1 小时线'],
  ['1D', '日线'],
];
const isFeed = (base) => base === 'EM_LIVE' || base === 'EM_REPLAY';
function options(pairs, selected) {
  return pairs
    .map(
      ([id, label]) =>
        '<option value="' +
        esc(id) +
        '"' +
        (id === selected ? ' selected' : '') +
        '>' +
        esc(label) +
        '</option>',
    )
    .join('');
}

export function openNew(api, ctx) {
  const account = ctx.session.account;
  const marketPairs = ctx.markets.map((m) => [m.id, m.name + ' · ' + m.currency]);
  const realMarkets = ctx.markets.filter((m) => m.region === 'A股').map((m) => [m.id, m.name]);
  const futureStart = 1000000;
  const spotStart = 100000;
  const capital = account?.initialCash ?? spotStart;
  const sources =
    '<optgroup label="东方财富">' +
    options([
      ['EM_LIVE', '东方财富 · 最新行情'],
      ['EM_REPLAY', '东方财富 · 随机回放'],
    ]) +
    '</optgroup>' +
    '<optgroup label="模拟行情">' +
    options(
      simulatedIntervals.map(([id, name]) => [id, '模拟' + name]),
      '1D',
    ) +
    '</optgroup>' +
    '<option value="CSV">导入历史 CSV</option>';

  api.show(
    '新建训练',
    '<form id="new-training"><div class="twocol"><label class="field"><span>基础行情</span><select name="base">' +
      sources +
      '</select></label>' +
      '<label class="field"><span>练习市场</span><select name="market">' +
      options(marketPairs, ctx.market.id) +
      '</select></label></div>' +
      '<div id="feed-controls" hidden><label class="field"><span>模拟交易品种</span><select name="kind">' +
      options([
        ['future', '股指期货 · 主力具体合约（15% 参考保证金）'],
        ['spot', '指数点位（1 倍）'],
      ]) +
      '</select></label>' +
      '<label class="field"><span>行情基础周期</span><select name="feedBase">' +
      options(feedIntervals, '5m') +
      '</select></label>' +
      '<p id="feed-description" class="note"></p></div>' +
      '<div id="csv-controls" hidden><label class="field"><span>历史行情文件</span><input class="file-field" type="file" name="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"></label><p class="note">支持中英文表头。必填日期或时间、开盘、最高、最低和收盘，成交量可选。每次 30–20,000 根，文件上限 8 MB。</p></div>' +
      '<div class="twocol">' +
      inputNumber('capital', '初始资金（本币）', capital, 1, 1000000000000, 'any') +
      '<label class="field" id="start-field"><span>回放起点</span><select name="start"><option value="fixed">标准起点</option><option value="random">随机起点</option><option value="manual">指定第几根</option></select></label></div>' +
      '<div id="custom-start" hidden>' +
      inputNumber('nth', '从第几根开始', 120, 1, 20000, 1) +
      '</div>' +
      '<div class="twocol">' +
      inputNumber('fee', '手续费（基点）', account?.feeBps ?? 3, 0, 9999, 'any') +
      inputNumber('slip', '滑点（基点）', account?.slippageBps ?? 2, 0, 9999, 'any') +
      '</div>' +
      '<label class="checkrow"><input type="checkbox" name="short" ' +
      (account?.allowShort !== false ? 'checked' : '') +
      '>允许做空</label>' +
      '<p class="note">1 基点 = 0.01%。当前训练会自动存档，可在交易复盘中恢复。</p>' +
      '<p id="train-error" class="error" role="alert"></p><button name="create" type="submit" class="primary modal-action">开始训练</button></form>',
  );
  const form = body().querySelector('form');
  const error = body().querySelector('#train-error');
  const market = get('market'),
    base = get('base'),
    kind = get('kind'),
    start = get('start'),
    file = get('file');
  const capitalInput = get('capital'),
    feedBase = get('feedBase'),
    nth = get('nth'),
    submit = get('create');
  let lastFeed = false;
  let chosenCapital = ![spotStart, futureStart].includes(capital);
  let rememberedMarket = ctx.market.id;

  function update(event) {
    const feed = isFeed(base.value);
    if (feed !== lastFeed || (feed && event?.target === kind)) {
      const currentId = market.value;
      if (feed && !lastFeed) rememberedMarket = currentId;
      const availableMarkets = feed && kind.value === 'future' ? realMarkets : marketPairs;
      market.innerHTML = options(availableMarkets, feed ? currentId : rememberedMarket);
    }
    if ((feed !== lastFeed || event?.target === kind) && !chosenCapital) {
      capitalInput.value = feed && kind.value === 'future' ? futureStart : spotStart;
    }
    lastFeed = feed;
    body().querySelector('#feed-controls').hidden = !feed;
    kind.disabled = feedBase.disabled = !feed;
    body().querySelector('#feed-description').textContent =
      base.value === 'EM_LIVE'
        ? '使用行情源最近可用的 K 线，行情时间见图表。'
        : '从行情源可用的历史区间随机选取起点，逐根揭晓后续 K 线。';
    body().querySelector('#csv-controls').hidden = base.value !== 'CSV';
    file.disabled = base.value !== 'CSV';
    file.required = !file.disabled;
    body().querySelector('#start-field').hidden = start.disabled = feed;
    const manual = !feed && start.value === 'manual';
    body().querySelector('#custom-start').hidden = nth.disabled = !manual;
    nth.max = base.value === 'CSV' ? 19999 : 719;
    error.textContent = '';
  }
  for (const control of [base, kind, start]) control.addEventListener('change', update);
  capitalInput.addEventListener('input', () => {
    chosenCapital = true;
  });
  update();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const targetMarket = ctx.markets.find((m) => m.id === market.value);
    const feed = isFeed(base.value);
    const config = {
      marketId: targetMarket.id,
      base: feed ? feedBase.value : base.value,
      initialCash: Number(capitalInput.value),
      feeBps: Number(get('fee').value),
      slippageBps: Number(get('slip').value),
      allowShort: get('short').checked,
    };
    const csvFile = file.files?.[0];
    error.textContent = '';
    submit.disabled = true;
    if (feed) submit.textContent = '正在读取行情…';
    try {
      if (feed) {
        await ctx.onFeed({ ...config, kind: kind.value, live: base.value === 'EM_LIVE' });
      } else {
        let count = 720;
        if (config.base === 'CSV') {
          if (!csvFile) throw new Error('请先选择 CSV 文件。');
          if (csvFile.size > fileLimit) throw new Error('文件大于 8 MB，请截取部分行情后再导入。');
          config.customBars = parseBarsCSV(await csvFile.text(), targetMarket.timeZone || 'UTC');
          config.customName = csvFile.name.replace(/\.(csv|tsv)$/i, '').slice(0, 80) || '历史行情';
          count = config.customBars.length;
        }
        config.startIndex = startIndex(start.value, count, nth.value);
        const dialog = form.closest('dialog');
        if (!form.isConnected || (dialog && !dialog.open)) return;
        await ctx.onNew(config);
      }
      if (form.isConnected) api.close();
    } catch (cause) {
      error.textContent = cause?.message || '创建训练失败，请重试。';
    } finally {
      submit.disabled = false;
      submit.textContent = '开始训练';
    }
  });
}

export function openHelp(api, ctx) {
  const sources = [
    [
      'https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/',
      'TradingView Bar Replay',
    ],
    ['https://gocharting.com/docs/charting/bar-replay', 'GoCharting 回放'],
    ['https://www.fxreplay.com/', 'FX Replay'],
  ];
  api.show(
    '使用指南',
    '<div class="dialog-copy"><h3>看盘与回放</h3><p class="note">选择市场和图表周期。K 线实体连接开盘与收盘，影线覆盖当期最高与最低价。回放时按 <kbd>→</kbd> 推进，按 <kbd>空格</kbd> 播放或暂停。点「随机时段」可开始一段随机行情训练。</p>' +
      '<h3>行情来源</h3><p class="note">选择「东方财富 · 最新行情」查看最近可用的指数或国内股指期货合约行情，「东方财富 · 随机回放」从可用历史中抽选起点。图上显示行情源的更新时间。页面每 15 秒检查一次，公开期货行情可能延时 15 分钟。东方财富可用历史不足时，同一月份的期货分时 K 线可取自新浪财经，图上会标明来源。其他市场可使用生成的模拟行情，或导入自己的历史 CSV。</p>' +
      '<h3>图表周期</h3><p class="note">图表保留蜡烛和画线工具。分钟、小时、日、周、月、季、年线由当前训练的基础 K 线聚合。每根尚在形成的图表 K 线只包含已揭晓的数据。查看更细的周期，可在新建训练时选择相应基础行情。</p>' +
      '<h3>模拟下单与平仓</h3><p class="note">市价单按当前可见价格加滑点成交，限价、停止和停止限价单根据后续行情撮合。停止限价单触发后继续按指定限价等待。止盈按限价、止损按触发市价。回放时按开盘、离开盘较近的极值、另一极值、收盘的次序撮合。点击「一键平仓」，可按市价平掉当前标的全部多头或空头持仓。</p>' +
      '<h3>盈亏和保证金</h3><p class="note">浮动盈亏随当前持仓价格更新，已实现盈亏累计已平部分的收益及对应费用。累计盈亏等于账户净值减初始资金。指数点位按每点 1 本币、1 倍资金交易。国内股指期货按具体合约乘数以手计价，模拟开仓按合约名义价值的 15% 估算保证金，合约涨跌按乘数计入盈亏。</p>' +
      '<h3>复盘与保存</h3><p class="note">在交易复盘查看净值、记录笔记或导出成交 CSV。新训练会归档当前进度。训练保存在当前浏览器，清除站点数据会清除记录。</p>' +
      '<h3>工具与参考</h3><p class="note">图表使用 ' +
      link('https://tradingview.github.io/lightweight-charts/', 'TradingView Lightweight Charts™') +
      '。</p><p class="note">回放与训练功能参考 ' +
      sources.map(([url, name]) => link(url, name)).join('、') +
      '。</p>' +
      '<p class="note">指数资料可见 ' +
      [
        ['https://www.csindex.com.cn/', '中证指数'],
        ['https://indexes.nasdaq.com/Index/Overview/NDX', 'Nasdaq Indexes'],
        ['https://www.spglobal.com/spdji/', 'S&P DJI'],
        ['https://www.hsi.com.hk/', '恒生指数公司'],
      ]
        .map(([url, name]) => link(url, name))
        .join(' · ') +
      '</p></div><button class="primary modal-action" type="button" id="help-journal">查看交易复盘</button>',
  );
  body()
    .querySelector('#help-journal')
    .addEventListener('click', () => {
      api.close();
      ctx.onJournal();
    });
}
