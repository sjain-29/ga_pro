/** Shared UI primitives: icons, toasts, modals, drawers, confirm dialogs, badges. */
import { esc, money, moneyShort } from './format.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* --------------------------------------------------------------- icons */
export function icons(root = document) {
  if (window.lucide?.createIcons) {
    try { window.lucide.createIcons({ attrs: { 'stroke-width': 1.9 }, nameAttr: 'data-lucide', root }); } catch { window.lucide.createIcons(); }
  }
}
export const icon = (name, cls = '') => `<i data-lucide="${name}" class="ico ${cls}" aria-hidden="true"></i>`;

/* -------------------------------------------------------------- toasts */
export function toast(message, type = 'success', ms = 3800) {
  const host = $('#toasts');
  const ico = { success: 'check-circle-2', error: 'alert-octagon', warn: 'alert-triangle', info: 'info' }[type] || 'info';
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(ico)}<div class="toast-msg">${esc(message)}</div><button class="toast-x" aria-label="Dismiss">${icon('x')}</button>`;
  host.appendChild(el);
  icons(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  el.querySelector('.toast-x').onclick = close;
  setTimeout(close, ms);
}

export function errorMessage(e) {
  const m = e?.message || String(e);
  if (/PERMISSION_DENIED|permission[_ ]denied/i.test(m)) return 'Permission denied — you are not authorised to make this change.';
  if (/network|offline|unavailable/i.test(m)) return 'Network problem — check your connection and try again.';
  if (/auth\/(invalid-credential|wrong-password|user-not-found|invalid-login)/.test(m)) return 'Incorrect username or password.';
  if (/auth\/too-many-requests/.test(m)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/auth\/email-already-in-use/.test(m)) return 'An account with this email already exists.';
  if (/auth\/weak-password/.test(m)) return 'Password is too weak (minimum 8 characters, mix letters and numbers).';
  if (/auth\/requires-recent-login/.test(m)) return 'Please sign in again and retry.';
  return m.replace(/^Firebase:\s*/, '');
}

/* ------------------------------------------------------- modal / drawer */
let openLayers = [];
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openLayers.length) openLayers[openLayers.length - 1].close(); });

export function modal({ title, body = '', footer = '', size = 'md', kind = 'modal', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `layer layer-${kind}`;
  wrap.innerHTML = `
    <div class="layer-backdrop"></div>
    <section class="${kind} ${kind}-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="layer-head"><h2>${esc(title)}</h2><button class="icon-btn layer-x" aria-label="Close">${icon('x')}</button></header>
      <div class="layer-body">${body}</div>
      ${footer ? `<footer class="layer-foot">${footer}</footer>` : ''}
    </section>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  const api = {
    el: wrap,
    body: wrap.querySelector('.layer-body'),
    foot: wrap.querySelector('.layer-foot'),
    close() {
      if (!wrap.isConnected) return;
      wrap.classList.remove('in');
      openLayers = openLayers.filter((l) => l !== api);
      setTimeout(() => wrap.remove(), 220);
      onClose && onClose();
    },
  };
  wrap.querySelector('.layer-backdrop').onclick = api.close;
  wrap.querySelector('.layer-x').onclick = api.close;
  openLayers.push(api);
  icons(wrap);
  setTimeout(() => wrap.querySelector('input:not([type=hidden]):not([disabled]),select,textarea')?.focus(), 80);
  return api;
}
export const drawer = (opts) => modal({ ...opts, kind: 'drawer' });

export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false, requireText = '', reason = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title, size: 'sm',
      body: `<p class="muted">${message}</p>
        ${requireText ? `<label class="field"><span>Type <b>${esc(requireText)}</b> to confirm</span><input class="input" id="cf-text" autocomplete="off"></label>` : ''}
        ${reason ? `<label class="field"><span>Reason</span><input class="input" id="cf-reason" maxlength="200" placeholder="e.g. duplicate entry"></label>` : ''}`,
      footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
      onClose: () => resolve(false),
    });
    const ok = m.el.querySelector('[data-ok]');
    if (requireText) { ok.disabled = true; m.el.querySelector('#cf-text').oninput = (e) => { ok.disabled = e.target.value.trim() !== requireText; }; }
    m.el.querySelector('[data-x]').onclick = () => m.close();
    ok.onclick = () => {
      const r = reason ? (m.el.querySelector('#cf-reason').value.trim() || 'No reason given') : true;
      resolve(r); m.close();
    };
  });
}

/** Disable a button while an async action runs. */
export async function busy(btn, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  btn.disabled = true; btn.classList.add('is-busy');
  btn.innerHTML = `<span class="spinner"></span>${btn.dataset.busy || 'Saving…'}`;
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = html; icons(btn); }
}

/* ------------------------------------------------------- display atoms */
export const restricted = (label = 'Restricted') => `<span class="restricted" title="You do not have permission to view this">${icon('lock')}${label}</span>`;
export const amt = (paise, fallback = '—') => (paise === null || paise === undefined ? `<span class="muted">${fallback}</span>` : `<span class="amt ${paise < 0 ? 'neg' : ''}">${money(paise)}</span>`);
export const amtShort = (paise) => (paise === null || paise === undefined ? '<span class="muted">—</span>' : `<span class="amt ${paise < 0 ? 'neg' : ''}" title="${money(paise)}">${moneyShort(paise)}</span>`);

const TONES = {
  'On Track': 'green', Attention: 'yellow', Critical: 'orange', 'Due Today': 'red', Overdue: 'red', Completed: 'muted', Cancelled: 'muted', 'No End Date': 'muted',
  'Not Started': 'slate', 'In Progress': 'blue', 'On Hold': 'yellow',
  Pending: 'red', Partial: 'orange', Complete: 'green', Overpaid: 'purple', 'Amount Not Confirmed': 'slate',
  'Settled with Deductions': 'teal', 'Closed by Deductions': 'teal', 'Excess / Reconciliation Required': 'purple', 'Not Configured': 'slate',
  Active: 'green', Inactive: 'muted', active: 'green', inactive: 'muted', Archived: 'slate', Deleted: 'red',
};
export const toneOf = (label) => TONES[label] || 'slate';
export const badge = (label, tone = toneOf(label), ico = '') => `<span class="badge tone-${tone}">${ico ? icon(ico) : '<span class="dot"></span>'}${esc(label)}</span>`;

export function progress(pctVal, tone = 'blue', label = '') {
  const p = pctVal === null || pctVal === undefined ? 0 : Math.max(0, Math.min(100, pctVal));
  return `<div class="progress" role="progressbar" aria-valuenow="${p.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" ${label ? `aria-label="${esc(label)}"` : ''}><span class="bar tone-bg-${tone}" style="width:${p}%"></span></div>`;
}

export const empty = (title, text = '', ico = 'inbox', action = '') => `<div class="empty">${icon(ico, 'empty-ico')}<h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
export const skeleton = (n = 4, cls = 'sk-card') => Array.from({ length: n }, () => `<div class="skeleton ${cls}"></div>`).join('');

export function kpi({ label, value, sub = '', ico = 'circle', tone = 'navy', href = '', calc = false }) {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="kpi tone-k-${tone}" ${href ? `href="${href}"` : ''}>
    <div class="kpi-ico">${icon(ico)}</div>
    <div class="kpi-body"><div class="kpi-label">${esc(label)}${calc ? '<span class="calc-tag" title="Calculated automatically">auto</span>' : ''}</div>
    <div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div></${tag}>`;
}

/** Build <option>s */
export const options = (list, selected) => list.map((o) => {
  const v = typeof o === 'string' ? o : o.value; const l = typeof o === 'string' ? o : o.label;
  return `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
}).join('');

/** Collect named form controls into an object. */
export function formData(form) {
  const o = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value.trim();
  }
  return o;
}

export function fieldError(form, name, msg) {
  const el = form.querySelector(`[name="${name}"]`);
  if (!el) return;
  el.classList.toggle('invalid', !!msg);
  let hint = el.closest('.field')?.querySelector('.field-err');
  if (!hint && msg) { hint = document.createElement('small'); hint.className = 'field-err'; el.closest('.field')?.appendChild(hint); }
  if (hint) hint.textContent = msg || '';
}

/** Rupee input: formats on blur with Indian grouping, accepts paste of "₹12,50,000". */
export function moneyInput(name, paise, attrs = '') {
  const v = paise === null || paise === undefined ? '' : (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<div class="money-wrap"><span class="cur">₹</span><input class="input money" inputmode="decimal" name="${name}" value="${v}" autocomplete="off" ${attrs}></div>`;
}
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (!el.classList?.contains('money')) return;
  const s = el.value.replace(/[₹,\s]/g, '');
  if (/^-?\d+(\.\d{0,2})?$/.test(s)) el.value = Number(s).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

/** Debounce */
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Searchable select: enhances a <select> with a filter box (keeps native semantics). */
export function searchableSelect(select) {
  if (!select || select.dataset.enhanced) return;
  select.dataset.enhanced = '1';
  const all = [...select.options].map((o) => ({ v: o.value, l: o.textContent }));
  const box = document.createElement('input');
  box.className = 'input select-filter';
  box.placeholder = 'Type to filter…';
  box.setAttribute('aria-label', 'Filter options');
  select.before(box);
  box.oninput = () => {
    const q = box.value.toLowerCase(); const cur = select.value;
    select.innerHTML = all.filter((o) => !o.v || o.l.toLowerCase().includes(q)).map((o) => `<option value="${esc(o.v)}" ${o.v === cur ? 'selected' : ''}>${esc(o.l)}</option>`).join('');
  };
}
