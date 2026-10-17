/** Expense Tracking */
import { state, projects, loadedBasic } from '../store.js';
import { can, EXPENSE_DOMAINS, canSeeAllExpenses } from '../permissions.js';
import { sumTxns, inRange } from '../calc.js';
import { esc, money, date } from '../format.js';
import { icon, icons, kpi, empty, amt, restricted } from '../ui.js';
import { renderChart, destroyCharts } from '../charts.js';
import { filterBar, wireFilters, rangeOf, lastMonths, monthLabel } from './common.js';
import { openExpenseDrawer } from './project-detail.js';

const LABEL = { purchase: 'Actual Purchase', transport: 'Transport', pilot: 'Pilot', other: 'Other' };
const ICO = { purchase: 'package', transport: 'truck', pilot: 'plane', other: 'shapes' };
const COLOR = { purchase: '#101D35', transport: '#2563EB', pilot: '#C62828', other: '#F59E0B' };
const f = { period: 'fy', dept: '', status: '', client: '' };

export function mount(el) {
  const u = state.profile;
  const cats = EXPENSE_DOMAINS.filter((c) => can(u, c));
  el.innerHTML = `<div class="page-head"><div><h1>Expense Tracking</h1><div class="sub">Recorded project costs by category. Quotations are never counted as expenses.</div></div></div>
    <div id="ef"></div><div class="kpi-grid" id="ek"></div>
    <div class="charts-grid"><section class="card chart-card"><div class="card-head"><h3>${icon('bar-chart-3')}Monthly expenses by category</h3><span class="card-sub">By expense date</span></div><div class="card-body" data-chart id="ec1"></div></section>
    <section class="card chart-card"><div class="card-head"><h3>${icon('pie-chart')}Expense category breakdown</h3></div><div class="card-body" data-chart id="ec2"></div></section></div>
    <div class="two-col"><section class="card"><div class="card-head"><h3>${icon('folder-kanban')}Project-wise expenses</h3></div><div class="card-body" id="et"></div></section>
    <section class="card"><div class="card-head"><h3>${icon('clock')}Latest entries</h3></div><div class="card-body" id="er"></div></section></div>`;
  const renderF = () => { const h = el.querySelector('#ef'); h.innerHTML = filterBar(f, { basis: 'Expense entry date' }); wireFilters(h, f, () => { renderF(); update(); }); icons(h); };

  function update() {
    if (!loadedBasic()) return;
    const r = rangeOf(f);
    const list = projects().filter((p) => (!f.dept || p.basic.department === f.dept) && (!f.status || p.basic.status === f.status) && (!f.client || p.basic.clientName === f.client));
    const txIn = (p, c) => Object.fromEntries(Object.entries(p.expenses?.[c]?.txns || {}).filter(([, t]) => !r || inRange(t.date, r)));
    const totals = Object.fromEntries(cats.map((c) => [c, list.reduce((s, p) => s + sumTxns(txIn(p, c)), 0)]));
    const grand = cats.reduce((s, c) => s + totals[c], 0);
    el.querySelector('#ek').innerHTML = EXPENSE_DOMAINS.map((c) => kpi({ label: `${LABEL[c]}${c === 'purchase' ? ' Price' : ' Expenses'}`, value: cats.includes(c) ? amt(totals[c]) : restricted(), ico: ICO[c], tone: { purchase: 'navy', transport: 'blue', pilot: 'red', other: 'orange' }[c] })).join('')
      + kpi({ label: 'Total Project Expenses', value: canSeeAllExpenses(u) ? amt(grand) : restricted('Partial access'), ico: 'sigma', tone: 'purple', calc: true });

    const months = lastMonths(12);
    renderChart(el.querySelector('#ec1'), { type: 'bar', money: true, stacked: true, labels: months.map(monthLabel),
      datasets: cats.map((c) => ({ label: LABEL[c], color: COLOR[c], data: months.map((m) => list.reduce((s, p) => s + sumTxns(Object.fromEntries(Object.entries(p.expenses?.[c]?.txns || {}).filter(([, t]) => (t.date || '').startsWith(m)))), 0)) })) });
    renderChart(el.querySelector('#ec2'), { type: 'doughnut', money: true, labels: cats.map((c) => LABEL[c]), datasets: [{ label: 'Expenses', data: cats.map((c) => totals[c]), colors: cats.map((c) => COLOR[c]) }] });

    const rows = list.map((p) => ({ p, v: Object.fromEntries(cats.map((c) => [c, sumTxns(txIn(p, c))])) })).map((x) => ({ ...x, t: cats.reduce((s, c) => s + x.v[c], 0) })).filter((x) => x.t !== 0).sort((a, b) => b.t - a.t);
    el.querySelector('#et').innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>Project</th>${cats.map((c) => `<th class="num">${LABEL[c]}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
      ${rows.map((x) => `<tr class="clickable" data-go="${esc(x.p.id)}"><td data-l="Project"><span class="pid">${esc(x.p.id)}</span></td>${cats.map((c) => `<td data-l="${LABEL[c]}" class="num"><button class="link-btn" data-cat="${c}" data-pid="${esc(x.p.id)}" style="color:inherit;font-weight:500">${money(x.v[c])}</button></td>`).join('')}<td data-l="Total" class="num"><b>${money(x.t)}</b></td></tr>`).join('')}
      </tbody><tfoot><tr><td>Total</td>${cats.map((c) => `<td class="num">${money(totals[c])}</td>`).join('')}<td class="num">${money(grand)}</td></tr></tfoot></table></div>` : empty('No expenses recorded', 'No expense entries in this period.', 'receipt');
    el.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); openExpenseDrawer(b.dataset.pid, b.dataset.cat); }; });
    el.querySelectorAll('[data-go]').forEach((tr) => { tr.onclick = () => (location.hash = `#/project/${encodeURIComponent(tr.dataset.go)}`); });

    const recent = list.flatMap((p) => cats.flatMap((c) => Object.values(p.expenses?.[c]?.txns || {}).map((t) => ({ t, c, p })))).filter((x) => !x.t.void).sort((a, b) => (b.t.createdAt || 0) - (a.t.createdAt || 0)).slice(0, 10);
    el.querySelector('#er').innerHTML = recent.length ? recent.map(({ t, c, p }) => `<a class="list-item" href="#/project/${encodeURIComponent(p.id)}"><div class="feed-ico">${icon(ICO[c])}</div><div class="li-main"><div class="li-title">${esc(t.desc || LABEL[c])}</div><div class="li-sub"><span class="pid">${esc(p.id)}</span> · ${LABEL[c]} · ${date(t.date)}</div></div><b class="amt ${t.kind === 'refund' ? 'neg' : ''}">${t.kind === 'refund' ? '−' : ''}${money(t.amount)}</b></a>`).join('') : empty('No entries', '', 'receipt');
    icons(el);
  }
  if (!cats.length) { el.innerHTML = empty('Restricted', 'You do not have access to any expense category.', 'lock'); return {}; }
  renderF(); update();
  return { update, destroy() { destroyCharts(el); } };
}
