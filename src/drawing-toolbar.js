import { icon } from './icons.js?v=20261124';

const groups = {
  lines: [
    ['trend', '趋势线'], ['extended', '延伸趋势线'], ['horizontal', '水平线'],
    ['horizontalSegment', '水平线段'], ['vertical', '垂直线'], ['crossLine', '十字线'],
    ['parallel', '轨道线'], ['ray', '射线'], ['priceLine', '价格线'],
    ['arrowLine', '箭头线'], ['infoLine', '信息线'],
  ],
  arrows: [
    ['arrowUp', '向上箭头'], ['arrowDown', '向下箭头'], ['arrowLeft', '向左箭头'], ['arrowRight', '向右箭头'],
  ],
};
const labels = Object.fromEntries([
  ...groups.lines, ...groups.arrows, ['pointer', '选择光标'], ['crosshair', '十字光标'],
  ['fib', '斐波那契回撤'], ['rectangle', '矩形'], ['measure', '测量'], ['text', '文本'],
]);
const singlePoint = new Set(['horizontal', 'vertical', 'crossLine', 'priceLine', ...groups.arrows.map(([id]) => id)]);
const cursorTools = ['pointer', 'crosshair'];

function hint(tool) {
  if (tool === 'trend') return '点两处画趋势线，点已有线可编辑';
  if (tool === 'parallel') return '先点轨道线的两个端点，再点第三点确定宽度';
  if (tool === 'text') return '点击图表放置文本，双击已有文本可编辑';
  if (singlePoint.has(tool)) return '点击图表放置' + labels[tool];
  return '依次点击两个端点绘制' + labels[tool];
}

const iconNames = { horizontal: 'hline', crosshair: 'cross' };
function toolIcon(tool) { return icon(iconNames[tool] || tool); }

export function createDrawingToolbar({ rail, menu, onTool, onOption, onAction, notify }) {
  const remembered = { lines: 'trend', arrows: 'arrowRight' };
  const options = { magnet: false, keepDrawing: false, locked: false, hidden: false };
  const hintText = document.querySelector('#drawingHint');
  let openGroup = null;
  function button(label, contents, attrs) {
    return '<button type="button" title="' + label + '" aria-label="' + label + '" ' + attrs + '>' + contents + '</button>';
  }
  const toolButton = (id) => button(labels[id], toolIcon(id), 'class="tool draw-main" data-tool="' + id + '" aria-pressed="false"');
  function groupButtons(group, name) {
    return '<div class="draw-family" data-family="' + group + '">' + toolButton(remembered[group]) +
      button('展开' + name, icon('chevron', 12), 'class="draw-more" data-menu="' + group + '" aria-expanded="false" aria-haspopup="menu" aria-controls="drawingMenu"') + '</div>';
  }
  const divider = '<span class="draw-separator" aria-hidden="true"></span>';
  rail.innerHTML = [
    ...cursorTools.map(toolButton), divider, groupButtons('lines', '线段工具'), groupButtons('arrows', '箭头工具'),
    ...['fib', 'rectangle', 'measure', 'text'].map(toolButton), divider,
    ...[['magnet', '磁吸到 K 线价格'], ['keepDrawing', '连续绘图'], ['locked', '锁定所有画线'], ['hidden', '隐藏所有画线']]
      .map(([id, name]) => button(name, icon(id), 'class="tool draw-main" data-option="' + id + '" aria-pressed="false"')),
    divider, button('清除本周期画线', icon('trash'), 'class="tool draw-main" data-draw-action="clearDraw"'),
  ].join('');
  function groupButton(group) { return rail.querySelector('[data-menu="' + group + '"]'); }
  function closeMenu(restoreFocus = false) {
    if (!openGroup) return;
    const opener = groupButton(openGroup);
    opener.setAttribute('aria-expanded', 'false');
    openGroup = null;
    menu.hidden = true;
    menu.replaceChildren();
    if (restoreFocus) opener.focus({ preventScroll: true });
  }
  function openMenu(group) {
    if (openGroup === group) { closeMenu(true); return; }
    closeMenu();
    openGroup = group;
    const opener = groupButton(group);
    opener.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-label', group === 'lines' ? '线段工具' : '箭头工具');
    menu.innerHTML = groups[group].map(([id, name]) => {
      const checked = remembered[group] === id;
      return '<button type="button" role="menuitemradio" aria-checked="' + checked + '" data-pick="' + id + '">' +
        toolIcon(id) + '<span>' + name + '</span>' + (checked ? icon('check', 15) : '') + '</button>';
    }).join('');
    menu.hidden = false;
    const bodyBox = menu.parentElement.getBoundingClientRect();
    const y = opener.getBoundingClientRect().top - bodyBox.top;
    menu.style.top = Math.max(3, Math.min(y, bodyBox.height - menu.offsetHeight - 3)) + 'px';
    menu.querySelector('[aria-checked="true"]').focus({ preventScroll: true });
  }
  function setTool(tool, keepDrawing) {
    options.keepDrawing = keepDrawing;
    rail.querySelector('[data-option="keepDrawing"]').setAttribute('aria-pressed', String(keepDrawing));
    for (const [group, members] of Object.entries(groups)) {
      if (!members.some(([id]) => id === tool)) continue;
      remembered[group] = tool;
      const main = rail.querySelector('[data-family="' + group + '"] .draw-main');
      main.dataset.tool = tool;
      main.title = labels[tool];
      main.setAttribute('aria-label', labels[tool]);
      main.innerHTML = toolIcon(tool);
    }
    for (const b of rail.querySelectorAll('[data-tool]')) {
      const active = b.dataset.tool === tool;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    hintText.textContent = cursorTools.includes(tool) ? '' : hint(tool);
  }
  function activate(id) {
    if (options.locked || options.hidden) {
      if (!cursorTools.includes(id)) { notify(options.locked ? '请先解锁画线' : '请先显示画线'); return; }
    }
    onTool(id);
  }
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.menu) { openMenu(b.dataset.menu); return; }
    closeMenu();
    if (b.dataset.tool) activate(b.dataset.tool);
    else if (b.dataset.drawAction) onAction(b.dataset.drawAction);
    else if (b.dataset.option) {
      const id = b.dataset.option;
      options[id] = !options[id];
      b.setAttribute('aria-pressed', String(options[id]));
      onOption({ [id]: options[id] });
    }
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    closeMenu(true);
    activate(b.dataset.pick);
  });
  menu.addEventListener('keydown', (e) => {
    const choices = [...menu.querySelectorAll('button')];
    const idx = choices.indexOf(document.activeElement);
    const n = choices.length;
    const move = { ArrowDown: (idx + 1) % n, ArrowUp: (idx + n - 1) % n, Home: 0, End: n - 1 };
    if (Object.hasOwn(move, e.key)) {
      e.preventDefault(); choices[move[e.key]].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); closeMenu(true);
    }
  });
  document.addEventListener('pointerdown', (e) => { if (!rail.contains(e.target) && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener('focusin', (e) => { if (!rail.contains(e.target) && !menu.contains(e.target)) closeMenu(); });
  window.addEventListener('resize', () => closeMenu());
  setTool('trend', true);
  return { setTool, options };
}
