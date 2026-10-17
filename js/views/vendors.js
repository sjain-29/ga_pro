/** Vendor Payment dashboard */
import { state, projects, loadedBasic } from '../store.js';
import { can, projectAllowed } from '../permissions.js';
import { esc, money, percent } from '../format.js';
import { icon, icons, kpi, empty, skeleton, amt, badge, progress, options, debounce } from '../ui.js';
import { renderChart, destroyCharts } from '../charts.js';
import { departmentNames, VENDOR_STATUSES } from './common.js';
import { openTxnForm, openPayable } from './project-detail.js';

const f = { dept: '', vendor: '', status: '', q: '', all: false };

export function mount(el, route, app) {
  const u = state.profile;
  el.innerHTML = `<div class="page-head"><div><h1>Vendor Payments</h1><div class="sub">Approved payables, payments made and what is still outstanding. Profit figures are not shown here.</div></div></div>
    <div class="filters" id="vf"></div><div class="kpi-grid" id="vk"></div>
    <div class="two-col"><section class="card"><div class="card-head"><h3>${icon('list-todo')}<span id="vt-title">Projects requiring payment</span></h3><label class="check small"><input type="checkbox" id="v-all" ${f.all ? 'checked' : ''}> Show fully paid</label></div><div class="card-body" id="vl">${skeleton(4, 'sk-row')}</div></section>
    <section class="card chart-card"><div class="card-head"><h3>${icon('pie-chart')}Payment status</h3></div><div class="card-body" data-chart id="vc"></div></section></div>`;
  el.querySelector('#v-all').onchange = (e) => { f.all = e.target.checked; update(); };

  function vendorsOf(p) {
    const s = new Set(Object.values(p.vendor?.txns || {}).map((t) => t.vendor).filter(Boolean));
    if (p.quotations) ['q1', 'q2', 'q3'].forEach((k) => p.quotations[k]?.vendor && s.add(p.quotations[k].vendor));
    return [...s];
  }
  function renderFilters(all) {
    const vendors = [...new Set(all.flatMap(vendorsOf))].sort();
    const h = el.querySelector('#vf');
    h.innerHTML = `<div class="search">${icon('search')}<input class="input" id="vq" placeholder="Search project" value="${esc(f.q)}"></div>
      <select class="input" data-k="dept"><option value="">All departments</option>${options(departmentNames(), f.dept)}</select>
      <select class="input" data-k="vendor"><option value="">All vendors</option>${options(vendors, f.vendor)}</select>
      <select class="input" data-k="status"><option value="">All payment statuses</option>${options(VENDOR_STATUSES, f.status)}</select>`;
    h.querySelector('#vq').oninput = debounce((e) => { f.q = e.target.value; update(false); }, 150);
    h.querySelectorAll('[data-k]').forEach((s) => { s.onchange = () => { f[s.dataset.k] = s.value; update(false); }; });
    icons(h);
  }

  let filtersDrawn = false;
  function update(redrawFilters = true) {
    if (!loadedBasic()) return;
    const all = projects();
    if (redrawFilters || !filtersDrawn) { renderFilters(all); filtersDrawn = true; }
    const q = f.q.toLowerCase();
    let list = all.filter((p) => (!f.dept || p.basic.department === f.dept) && (!f.vendor || vendorsOf(p).includes(f.vendor)) && (!f.status || p.calc.vendor?.status === f.status) && (!q || `${p.id} ${p.basic.description}`.toLowerCase().includes(q)));
    const st = (s) => list.filter((p) => p.calc.vendor?.status === s).length;
    const sum = (fn) => list.reduce((s, p) => s + (fn(p) || 0), 0);
    el.querySelector('#vk').innerHTML = [
      kpi({ label: 'Total Vendor Payable', value: amt(sum((p) => p.calc.vendor?.payable)), ico: 'file-check', tone: 'navy', sub: `${list.filter((p) => p.calc.vendor?.payable === null).length} not confirmed` }),
      kpi({ label: 'Vendor Payments Made', value: amt(sum((p) => p.calc.vendor?.paid)), ico: 'send', tone: 'blue' }),
      kpi({ label: 'Outstanding Vendor Payments', value: amt(sum((p) => Math.max(0, p.calc.vendor?.outstanding || 0))), ico: 'hourglass', tone: 'orange', calc: true }),
      kpi({ label: 'Pending', value: st('Pending'), ico: 'circle-dashed', tone: 'red', sub: 'No payment yet' }),
      kpi({ label: 'Partially Paid', value: st('Partial'), ico: 'circle-dot', tone: 'orange' }),
      kpi({ label: 'Fully Paid', value: st('Complete'), ico: 'circle-check', tone: 'green' }),
    ].join('');
    const labels = VENDOR_STATUSES.filter((s) => st(s));
    renderChart(el.querySelector('#vc'), { type: 'doughnut', labels, datasets: [{ label: 'Projects', data: labels.map(st) }], onClick: (l) => { f.status = l; update(); } });

    const shown = (f.all ? list : list.filter((p) => !['Complete'].includes(p.calc.vendor?.status))).sort((a, b) => (b.calc.vendor?.outstanding || 0) - (a.calc.vendor?.outstanding || 0));
    el.querySelector('#vt-title').textContent = f.all ? 'All projects' : 'Projects requiring payment';
    el.querySelector('#vl').innerHTML = shown.length ? shown.map((p) => {
      const v = p.calc.vendor; const ed = can(u, 'vendor', 'edit') && projectAllowed(u, p.id);
      const tone = { Complete: 'green', Partial: 'orange', Pending: 'red', Overpaid: 'purple' }[v.status] || 'slate';
      return `<div class="list-item" style="flex-wrap:wrap">
        <a class="li-main" href="#/project/${encodeURIComponent(p.id)}"><div class="li-title"><span class="pid">${esc(p.id)}</span> · ${esc(p.basic.description)}</div>
          <div class="li-sub">${esc(vendorsOf(p).join(', ') || 'No vendor yet')} · Paid ${money(v.paid)} of ${v.payable === null ? 'amount not confirmed' : money(v.payable)}</div>
          <div style="margin-top:6px;max-width:420px">${progress(v.progress, tone)}</div></a>
        <div style="text-align:right">${badge(v.status)}<div class="small" style="margin-top:4px">${v.outstanding > 0 ? `<b>${money(v.outstanding)}</b> due` : ''}</div></div>
        ${ed ? `<div class="txn-actions"><button class="btn btn-sm btn-navy" data-pay="${esc(p.id)}">${icon('plus')}Pay</button>${v.payable === null ? `<button class="btn btn-sm btn-ghost" data-payable="${esc(p.id)}">Set payable</button>` : ''}</div>` : ''}</div>`;
    }).join('') : empty('Nothing outstanding', 'All vendor payments in this view are complete.', 'party-popper');
    el.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = () => openTxnForm(all.find((p) => p.id === b.dataset.pay), 'vendor', 'txns'); });
    el.querySelectorAll('[data-payable]').forEach((b) => { b.onclick = () => openPayable(all.find((p) => p.id === b.dataset.payable)); });
    icons(el);
  }
  update();
  return { update: () => update(false), destroy() { destroyCharts(el); } };
}
