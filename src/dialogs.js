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

const indicators = [
  ['MA', '移动均线', 'MA 5、20'],
  ['MA60', '长期均线', 'MA 60'],
  ['VOL', '成交量', 'VOL'],
  ['BOLL', '布林带', '20 根 / 2 倍标准差'],
  ['RSI', '相对强弱指标', 'RSI 14'],
  ['MACD', '移动平均收敛发散指标', '12 / 26 / 9'],
];

export function openIndicators(api, ctx) {
  const selected = new Set(ctx.session.indicators || ['MA', 'VOL']);
  api.show(
    '图表指标',
    '<form id="indicator-form"><div class="option-list">' +
      indicators
        .map(
          ([code, title, summary]) =>
            '<label><span><b>' +
            title +
            '</b> <small class="muted">' +
            summary +
            '</small></span><input type="checkbox" name="indicator" value="' +
            code +
            '" ' +
            (selected.has(code) ? 'checked' : '') +
            '></label>',
        )
        .join('') +
      '</div><button type="submit" class="primary modal-action">应用指标</button></form>',
  );
  body()
    .querySelector('form')
    .addEventListener('submit', (event) => {
      event.preventDefault();
      const values = [...body().querySelectorAll('input:checked')].map((input) => input.value);
      api.close();
      ctx.onIndicators(values);
    });
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

export function openNew(api, ctx) {
  const account = ctx.session.account;
  const marketOptions = ctx.markets
    .map(
      (m) =>
        '<option value="' +
        esc(m.id) +
        '" ' +
        (m.id === ctx.market.id ? 'selected' : '') +
        '>' +
        esc(m.name) +
        ' · ' +
        esc(m.currency) +
        '</option>',
    )
    .join('');
  api.show(
    '新建训练',
    '<form id="new-training"><div class="twocol"><label class="field"><span>练习市场</span><select name="market">' +
      marketOptions +
      '</select></label>' +
      '<label class="field"><span>基础行情</span><select name="base"><option value="1D">模拟日线</option><option value="15m">模拟 15 分钟线</option><option value="1H">模拟 1 小时线</option><option value="CSV">导入历史 CSV</option></select></label></div>' +
      '<div id="csv-controls" hidden><label class="field"><span>历史行情文件</span><input class="file-field" type="file" name="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"></label><p class="note">支持中英文表头。必填日期或时间、开盘、最高、最低和收盘，成交量可选。每次 30–20,000 根，文件上限 8 MB。</p></div>' +
      '<div class="twocol">' +
      inputNumber('capital', '初始资金（本币）', account?.initialCash ?? 100000, 1, 1000000000000, 'any') +
      '<label class="field"><span>回放起点</span><select name="start"><option value="fixed">标准起点</option><option value="random">随机起点</option><option value="manual">指定第几根</option></select></label></div>' +
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
  const fileGroup = body().querySelector('#csv-controls');
  const customStart = body().querySelector('#custom-start');
  const error = body().querySelector('#train-error');
  const file = get('file'),
    start = get('start'),
    nth = get('nth'),
    base = get('base'),
    submit = get('create');
  function update() {
    fileGroup.hidden = base.value !== 'CSV';
    file.disabled = fileGroup.hidden;
    file.required = !fileGroup.hidden;
    customStart.hidden = start.value !== 'manual';
    nth.disabled = customStart.hidden;
    nth.max = base.value === 'CSV' ? 19999 : 719;
    error.textContent = '';
  }
  start.addEventListener('change', update);
  base.addEventListener('change', update);
  update();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const market = ctx.markets.find((m) => m.id === get('market').value);
    const config = {
      marketId: market.id,
      base: base.value,
      initialCash: Number(get('capital').value),
      feeBps: Number(get('fee').value),
      slippageBps: Number(get('slip').value),
      allowShort: get('short').checked,
    };
    const mode = start.value,
      typed = nth.value,
      source = file.files?.[0];
    error.textContent = '';
    submit.disabled = true;
    try {
      let count = 720;
      if (config.base === 'CSV') {
        if (!source) throw new Error('请先选择 CSV 文件。');
        if (source.size > fileLimit) throw new Error('文件大于 8 MB，请截取部分行情后再导入。');
        config.customBars = parseBarsCSV(await source.text(), market.timeZone || 'UTC');
        config.customName = source.name.replace(/\.(csv|tsv)$/i, '').slice(0, 80) || '历史行情';
        count = config.customBars.length;
      }
      config.startIndex = startIndex(mode, count, typed);
      const dialog = form.closest('dialog');
      if (!form.isConnected || (dialog && !dialog.open)) return;
      await ctx.onNew(config);
      if (form.isConnected) api.close();
    } catch (cause) {
      error.textContent = cause?.message || '创建训练失败，请重试。';
    } finally {
      submit.disabled = false;
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
    '<div class="dialog-copy"><h3>从一根 K 线开始</h3><p class="note">选择市场，观察当前价格，再决定买入或卖出。按 <kbd>→</kbd> 向前走一根，按 <kbd>空格</kbd> 播放或暂停。K 线实体连接开盘价和收盘价，上下影线显示最高与最低价。</p>' +
      '<h3>练习市场与数据</h3><p class="note">中证 1000、中证 500、纳斯达克 100 等市场分别以本币计价。内置价格和成交量均为生成的模拟数据，采用工作日训练日历。要回放真实历史，可新建训练并导入有权使用的行情 CSV。分时数据按所选市场的时区解析。</p>' +
      '<h3>委托如何成交</h3><p class="note">每个单位按 1 点折合 1 本币计算。市价单在可见收盘价上计入滑点。挂单最早在下一根生效。停止市价单触发后按市价成交，跳空可能改变成交价。停止限价单触发后转为限价单，买价不高于指定限价，卖价不低于指定限价。跳空越过限价后，委托会继续等待，期间可撤单。保护止盈按限价，保护止损按触发市价。单根内先走离开盘较近的极值，再走另一端，最后收盘。两端等距时先走低点。</p>' +
      '<h3>资金与风险</h3><p class="note">手续费按每次成交金额计收。卖空需全额担保，账户权益降至空头市值的 50% 时强平，极端跳空后训练余额最低为零。指数练习采用点值模型，可反手交易，交易所交割、乘数和融资利息均未计入。</p>' +
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
