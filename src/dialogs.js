import { bitcoinPerpTerms, defaultCapital } from './engine.js?v=20261124';
import { parseBarsCSV } from './import.js';
import { futuresTerms } from './eastmoney.js';

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
  const historical = !ctx.session.live;
  api.show(
    historical ? '选择回放市场' : '选择市场',
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
            esc(m.name + (m.region === 'A股' ? historical ? ' 期货' : ' 主连' : '')) +
            '</strong><small>' +
            esc(m.region) +
            ' · ' +
            esc(m.region === 'A股' ? historical ? futuresTerms(m.id).symbol : futuresTerms(m.id).continuous : m.symbol) +
            ' · ' +
            esc(m.currency) +
            '</small></button>',
        )
        .join('') +
      '</div>',
  );
  for (const option of body().querySelectorAll('[data-market]')) {
    option.addEventListener('click', (event) => {
      event.stopPropagation();
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
  const sources =
    '<optgroup label="真实行情">' +
    options(
      [
        ['EM_LIVE', '最新行情'],
        ['EM_REPLAY', '真实历史 · 随机回放'],
      ],
      'EM_REPLAY',
    ) +
    '</optgroup>' +
    '<optgroup label="模拟行情">' +
    options(simulatedIntervals.map(([id, name]) => [id, '模拟' + name])) +
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
      '<label class="field"><span id="kind-label">模拟交易品种</span><select name="kind" required></select></label>' +
      '<p id="kind-description" class="note"></p>' +
      '<div id="feed-controls" hidden><label class="field"><span>行情基础周期</span><select name="feedBase">' +
      options(feedIntervals, '5m') +
      '</select></label>' +
      '<p id="feed-description" class="note"></p></div>' +
      '<div id="csv-controls" hidden><label class="field"><span>历史行情文件</span><input class="file-field" type="file" name="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"></label><p class="note">支持中英文表头。必填日期或时间、开盘、最高、最低和收盘，成交量可选。每次 30–20,000 根，文件上限 8 MB。</p></div>' +
      '<div class="twocol">' +
      inputNumber('capital', '初始资金（本币）', defaultCapital(ctx.market.id), 1, 1000000000000, 'any') +
      '<label class="field" id="start-field"><span>回放起点</span><select name="start"><option value="fixed">标准起点</option><option value="random">随机起点</option><option value="manual">指定第几根</option></select></label></div>' +
      '<div id="custom-start" hidden>' +
      inputNumber('nth', '从第几根开始', 120, 1, 20000, 1) +
      '</div>' +
      '<div class="twocol">' +
      inputNumber('fee', '单边手续费（基点）', account?.feeBps ?? 3, 0, 9999, 'any') +
      inputNumber('slip', '滑点（基点）', account?.slippageBps ?? 2, 0, 9999, 'any') +
      '</div>' +
      '<label class="checkrow"><input type="checkbox" name="short" ' +
      (account?.allowShort !== false ? 'checked' : '') +
      '>允许做空</label>' +
      '<p class="note">1 基点 = 0.01%。手续费按每笔成交的名义金额收取，开仓和平仓分别计费。滑点按成交参考价计算。当前训练会自动存档。</p>' +
      '<p id="train-error" class="error" role="alert"></p><button name="create" type="submit" class="primary modal-action">开始训练</button></form>',
  );
  const form = body().querySelector('form');
  const error = body().querySelector('#train-error');
  const market = get('market'),
    base = get('base'),
    kind = get('kind'),
    start = get('start'),
    file = get('file');
  const feedBase = get('feedBase'),
    nth = get('nth'),
    submit = get('create');
  const short = get('short');
  let lastMarket, lastSource, shortPreference = short.checked;

  function update() {
    const feed = isFeed(base.value);
    const csv = base.value === 'CSV';
    const selectedMarket = ctx.markets.find((item) => item.id === market.value);
    const perp = selectedMarket.id === 'btcPerp';
    const terms = perp ? bitcoinPerpTerms() : selectedMarket.region === 'A股' ? futuresTerms(selectedMarket.id) : null;
    const spotUnit = perp ? null : selectedMarket.quantityUnit;
    if (lastMarket !== market.value) get('capital').value = defaultCapital(market.value);
    get('capital').closest('label').querySelector('span').textContent = '初始资金（' + selectedMarket.currency + '）';
    if (!short.disabled) shortPreference = short.checked;
    short.disabled = Boolean(spotUnit);
    short.checked = spotUnit ? false : perp ? true : shortPreference;
    short.closest('label').hidden = Boolean(selectedMarket.quantityUnit);
    base.querySelector('[value="EM_LIVE"]').textContent =
      (selectedMarket.quantityUnit ? '币安' : '东方财富') + ' · 最新行情';
    if (lastMarket !== market.value || lastSource !== base.value) {
      const resetKind = lastMarket !== market.value || csv || lastSource === 'CSV';
      const selected = resetKind ? (csv ? '' : terms ? 'future' : 'spot') : kind.value;
      const pairs = [];
      if (csv) pairs.push(['', '请选择 CSV 文件中的价格标的']);
      if (terms) {
        const label = csv ? '期货价格' : base.value === 'EM_REPLAY' ? '股指期货 · 历史交割月合约' :
          feed ? '股指期货 · 主力月份合约' : '股指期货模拟（参考主连）';
        pairs.push(['future', perp ? 'BTCUSDT · U 本位永续' : terms.symbol + ' · ' + label]);
      }
      if (!perp) pairs.push(['spot', spotUnit ? '币安 BTC/USDT 现货' : csv ? '指数点位 · 指数现货练习（1×）' : '指数现货练习（1×）']);
      kind.innerHTML = options(pairs, selected);
      lastMarket = market.value;
      lastSource = base.value;
    }
    body().querySelector('#kind-label').textContent = csv ? 'CSV 价格标的' : '模拟交易品种';
    let description = '';
    if (perp && kind.value === 'future') {
      description = '以 USDT 结算，可做多或做空。下单面板支持 1–100 倍杠杆，按 BTC 数量成交。';
    } else if (kind.value === 'future') {
      const leverage = (1 / terms.marginRate).toFixed(2);
      description =
        terms.symbol +
        ' 每手每点 ' +
        terms.multiplier +
        ' 元，最小变动 ' +
        terms.tickSize +
        ' 点。参考开仓保证金为名义金额的 ' +
        Number((terms.marginRate * 100).toFixed(2)) +
        '%，对应约 ' +
        leverage +
        ' 倍杠杆。';
    } else if (kind.value === 'spot') {
      description = spotUnit ? '使用 USDT 买入 BTC，按持有的 BTC 数量卖出。数量精确至 0.00001 BTC。' : '指数每点折合 1 ' + selectedMarket.currency + '，按 1 倍名义金额练习。';
    } else {
      description = '请选择与文件中 OHLC 对应的交易品种。该选择决定每点盈亏与保证金。';
    }
    body().querySelector('#kind-description').textContent = description;
    body().querySelector('#feed-controls').hidden = !feed;
    feedBase.disabled = !feed;
    body().querySelector('#feed-description').textContent =
      base.value === 'EM_LIVE'
        ? '使用行情源最近可用的 K 线，行情时间见图表。'
        : perp ? '从币安 BTCUSDT U 本位永续历史 K 线抽取训练时段，时间按 UTC 显示。'
        : spotUnit ? '从币安 BTCUSDT 现货历史 K 线抽取训练时段，全天连续交易，时间按 UTC 显示。'
        : '跨年份抽取真实历史。股指期货按交割月份取价，优先抽取本机尚未练过的合约和日期。';
    body().querySelector('#csv-controls').hidden = base.value !== 'CSV';
    file.disabled = base.value !== 'CSV';
    file.required = !file.disabled;
    body().querySelector('#start-field').hidden = start.disabled = feed;
    const manual = !feed && start.value === 'manual';
    body().querySelector('#custom-start').hidden = nth.disabled = !manual;
    nth.max = base.value === 'CSV' ? 19999 : 719;
    error.textContent = '';
  }
  for (const control of [base, market, kind, start]) control.addEventListener('change', update);
  update();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const targetMarket = ctx.markets.find((m) => m.id === market.value);
    const feed = isFeed(base.value);
    const config = {
      marketId: targetMarket.id,
      kind: kind.value,
      base: feed ? feedBase.value : base.value,
      initialCash: Number(get('capital').value),
      feeBps: Number(get('fee').value),
      slippageBps: Number(get('slip').value),
      allowShort: get('short').checked,
    };
    const csvFile = file.files?.[0];
    error.textContent = '';
    submit.disabled = true;
    if (feed) submit.textContent = '正在读取行情…';
    try {
      if (!config.kind) throw new Error('请先选择 CSV 文件中的价格标的。');
      if (feed) {
        await ctx.onFeed({ ...config, live: base.value === 'EM_LIVE' });
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
    ['https://www.binance.com/zh-CN/trade/BTC_USDT?type=spot', '币安现货基本版画线工具'],
  ];
  api.show(
    '使用指南',
    '<div class="dialog-copy"><h3>看盘与回放</h3><p class="note">鼠标放在主图上，滚轮向上放大、向下缩小。按住右键拖动可左右查看历史、上下移动价格。点「回到最新」恢复视图。点击图表后也可用 <kbd>↑</kbd> 和 <kbd>↓</kbd> 缩放。回放时按 <kbd>→</kbd> 推进，按 <kbd>空格</kbd> 播放或暂停。「往年随机」从当前自然年以前的行情开练。选定具体年份会立即跳转。「随机时段」在该范围内优先抽取未练过的合约和日期。图名旁的回放时间和剩余交易日数随进度更新。原训练可在交易复盘中恢复。</p>' +
      '<h3>行情来源</h3><p class="note">选择「东方财富 · 最新行情」查看最近可用的指数或国内股指期货合约行情，「真实历史 · 随机回放」按所选品种抽取区间。国内期货使用站内真实交割月档案、公开的 CC0 五分钟合约数据和新浪财经历史行情，指数日线使用腾讯或新浪财经的历年数据。图上显示行情源的更新时间。页面每 15 秒检查一次，公开期货行情可能延时 15 分钟。东方财富历史不足时，图表可使用新浪财经同月份期货或同一指数的历史 K 线，并标明来源。比特币现货和 U 本位永续分别使用对应的币安 BTCUSDT 历史 K 线，以 UTC 显示全天候行情。你也可以使用生成的模拟行情，或导入自己的历史 CSV。</p>' +
      '<h3>画线工具</h3><p class="note">点左侧线段图标使用当前工具，点旁边的小箭头展开全部线段工具。趋势线点两个端点，轨道线再点第三点确认宽度。工具栏下方可以开启磁吸、连续绘图、锁定或隐藏。拖动线身可平移，拖动端点可修改方向和长度。点中一条线，可在下方修改颜色、粗细和线型。左键或右键单击线身，再点线旁的「删除」即可删掉这一条。图表聚焦时也可按 Delete 或退格键。</p>' +
      '<h3>图表周期</h3><p class="note">图表保留蜡烛和画线工具。分钟、小时、日、周、月、季、年线由当前训练的基础 K 线聚合。每根尚在形成的图表 K 线只包含已揭晓的数据。查看更细的周期，可在新建训练时选择相应基础行情。</p>' +
      '<h3>模拟下单与平仓</h3><p class="note">市价单按当前可见价格加滑点成交，限价、停止和停止限价单根据后续行情撮合。停止限价单触发后继续按指定限价等待。止盈按限价、止损按触发市价。回放时按开盘、离开盘较近的极值、另一极值、收盘的次序撮合。点击「一键平仓」，可按市价平掉当前标的全部多头或空头持仓。</p>' +
      '<h3>盈亏和保证金</h3><p class="note">浮动盈亏随当前持仓价格更新，已实现盈亏累计已平部分的收益及对应费用。累计盈亏等于账户净值减初始资金。BTC 永续按全仓模式训练，杠杆 1–100 倍、固定维持保证金率 0.4%，按所见合约成交行情触发强平，费用计入净盈亏。训练不计资金费率。中证1000 默认练习 IM、中证500 默认练习 IC、沪深300 默认练习 IF。IM 和 IC 每手每点 200 元，IF 每手每点 300 元。练习按 15% 参考开仓保证金、约 6.67 倍名义杠杆计算。选择「指数现货练习（1×）」后，每点盈亏按每单位 1 本币计算。CSV 训练按你选定的文件价格标的计价。</p>' +
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
