import { exposureTime } from './exposure-time.js';

const formatPct = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function duration(value) {
  if (value > 0 && value < 1) return '不足1秒';
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = seconds % 60;
  return (hours ? hours + '小时' : '') + (minutes ? minutes + '分' : '') +
    (rest || !seconds ? rest + '秒' : '');
}

export function renderExposure(root, session, sourceBars) {
  if (!root.firstElementChild) {
    root.innerHTML = '<div class="exposure-title"><span>空仓率</span><strong class="exposure-rate"></strong></div>' +
      '<div class="exposure-times"></div><details class="exposure-method"><summary>计算口径</summary>' +
      '<p></p></details>';
  }
  const { flatPct, flatSeconds, totalSeconds, estimatedCalendar } = exposureTime(session, sourceBars);
  let note = '空仓时长除以本次训练已推进的交易时长。按行情时间计算，扣除休市时段。回放按基础 K 线的成交时刻统计，同一时刻反手不增加空仓时长。';
  if (estimatedCalendar) note += '该文件仅提供周线或更长周期，按工作日常规交易时段估算。';
  else if (session.live && !['btc', 'btcPerp'].includes(session.marketId)) note += '最新行情模式按已记录的交易日统计。';
  root.querySelector('.exposure-method p').textContent = note;
  const rate = root.querySelector('.exposure-rate');
  rate.textContent = flatPct == null ? '—' : formatPct.format(flatPct) + '%';
  if (flatPct > 0 && flatPct < 0.01) rate.textContent = '<0.01%';
  if (flatPct > 99.99 && flatPct < 100) rate.textContent = '>99.99%';
  root.querySelector('.exposure-times').textContent = '空仓 ' + (totalSeconds ? duration(flatSeconds) : '—') +
    ' / 已训练 ' + (totalSeconds ? duration(totalSeconds) : '—');
}
