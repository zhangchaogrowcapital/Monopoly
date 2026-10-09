// DOM 小工具：元素创建、提示、弹窗
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div.cls#id', {attrs, onclick}, ...children) */
export function h(tag, props = {}, ...children) {
  const [, name = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(tag);
  const el = document.createElement(name || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]);
    else el.id = m[2];
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = {};
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export function toast(text, type = 'info', ms = 2600) {
  const root = $('#toast-root');
  const el = h(`div.toast.${type}`, text);
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/** 打开弹窗，返回 {el, close}。content 可以是元素或函数(close)=>元素 */
export function modal(title, content, { wide = false, onClose, closable = true } = {}) {
  const root = $('#modal-root');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('show');
    setTimeout(() => wrap.remove(), 200);
    onClose?.();
  };
  const body = typeof content === 'function' ? content(close) : content;
  const wrap = h('div.modal-wrap', {
    onclick: (e) => { if (closable && e.target === wrap) close(); },
  }, h(`div.modal${wide ? '.wide' : ''}`,
    h('div.modal-head', h('h3', title), closable ? h('button.icon-btn.close', { onclick: close, title: '关闭' }, '✕') : null),
    h('div.modal-body', body)));
  root.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  return { el: wrap, close };
}

export function confirmBox(text, { ok = '确定', cancel = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal('确认', (close) => h('div.confirm',
      h('p', text),
      h('div.row.end',
        h('button.btn', { onclick: () => close() }, cancel),
        h(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => { result = true; close(); } }, ok))), {
      onClose: () => resolve(result),
    });
    return m;
  });
}

export const money = (n) => `¥${Number(n).toLocaleString('zh-CN')}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
