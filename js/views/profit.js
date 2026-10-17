/** Profitability Analytics */
import { state, projects, loadedBasic } from '../store.js';
import { can, canSeeAllExpenses, EXPENSE_DOMAINS } from '../permissions.js';
import { sumTxns } from '../calc.js';
import { esc, money, percent } from '../format.js';
import { icon, icons, kpi, empty, amt, restricted, badge } from '../ui.js';
import { renderChart, destroyCharts } from '../charts.js';
import { filterBar, wireFilters, applyFilters, aggregate, val, departmentNames, lastMonths, monthLabel } from './common.js';

const f = { period: 'all', dept: '', status: '', client: '' };

export function mount(el, route, app) {
  const u = state.profile;
  el.innerHTML = `<div class="page-head"><div><h1>Profitability Analytics</h1><div class="sub">Projected (recorded cost-based) profit — not audited net profit. Taxes and overheads may not be included.</div></div></div>
    <div id="rf"></div><div class="kpi-grid" id="rk"></div>
    <div class="two-col"><section class="card"><div class="card-head"><h3>${icon('trophy')}Most profitable projects</h3></div><div class="card-body" id="top"></div></section>
    <section class="card"><div class="card-head"><h3>${icon('trending-down')}Loss-making projects</h3></div><div class="card-body" id="loss"></div></section></div>
    <div class="charts-grid">
      <section class="card chart-card"><div class="card-head"><h3>${icon('building')}Department-wise profitability</h3><span class="card-sub">Click to filter</span></div><div class="card-body" data-chart id="rc1"></div></section>
      <section class="card chart-card"><div class="card-head"><h3>${icon('line-chart')}Monthly profitability trend</h3><span class="card-sub">By PO date</span></div><div class="card-body" data-chart id="rc2"></div></section>
      ${canSeeAllExpenses(u) ? `<section class="card chart-card"><div class="card-head"><h3>${icon('pie-chart')}Expense category breakdown</h3></div><div class="card-body" data-chart id="rc3"></div></section>` : ''}
    </div>
    <section class="card"><div class="card-head"><h3>${icon('table')}Project-wise profitability</h3></div><div class="card-body" id="rt"></div></section>`;
  const renderF = () => { const h = el.querySelector('#rf'); h.innerHTML = filterBar(f, { basis: 'PO Date' }); wireFilters(h, f, () => { renderF(); update(); }); icons(h); };

  const row = (p) => `<a class="list-item" href="#/project/${encodeURIComponent(p.id)}"><div class="li-main"><div class="li-title"><span class="pid">${esc(p.id)}</span> · ${esc(p.basic.description)}</div><div class="li-sub">${esc(p.basic.department)} · ${esc(p.basic.clientName)}</div></div>
    <div style="text-align:right"><b class="amt ${p.calc.profit.projectedProfit < 0 ? 'neg' : 'pos'}">${money(p.calc.profit.projectedProfit)}</b><div class="small ${p.calc.profit.margin < 0 ? 'neg' : 'muted'}">${percent(p.calc.profit.margin)}</div></div></a>`;

  function update() {
    if (!loadedBasic()) return;
    const list = applyFilters(projects(), f).filter((p) => p.calc.profit);
    const A = aggregate(list);
    el.querySelector('#rk').innerHTML = [
      kpi({ label: 'PO Value', value: val(A.po), ico: 'file-signature', tone: 'navy' }),
      kpi({ label: 'Total Expenses', value: val(A.expenses), ico: 'receipt', tone: 'orange' }),
      kpi({ label: 'Projected Profit', value: val(A.profit), ico: 'trending-up', tone: A.profit < 0 ? 'red' : 'green', calc: true }),
      kpi({ label: 'Adjusted Profit (after LD)', value: val(A.adjProfit), ico: 'scissors', tone: 'purple', calc: true }),
      kpi({ label: 'Profit Margin', value: A.margin === null ? (can(u, 'po') ? 'N/A' : restricted()) : `<span class="${A.margin < 0 ? 'neg' : ''}">${percent(A.margin)}</span>`, ico: 'percent', tone: 'blue', calc: true }),
      kpi({ label: 'Cost overruns', value: list.filter((p) => p.calc.profit.costOverrun).length, ico: 'alert-triangle', tone: 'red', sub: 'Recorded cost > PO value' }),
    ].join('');
    const sorted = [...list].sort((a, b) => b.calc.profit.projectedProfit - a.calc.profit.projectedProfit);
    el.querySelector('#top').innerHTML = sorted.filter((p) => p.calc.profit.projectedProfit > 0).slice(0, 6).map(row).join('') || empty('No profitable projects yet', '', 'trophy');
    const losses = sorted.filter((p) => p.calc.profit.projectedProfit < 0).reverse();
    el.querySelector('#loss').innerHTML = losses.map(row).join('') || empty('No loss-making projects', 'Every project has recorded costs within its PO value.', 'shield-check');

    const depts = departmentNames().filter((d) => list.some((p) => p.basic.department === d));
    const dSum = (d, fn) => list.filter((p) => p.basic.department === d).reduce((s, p) => s + (fn(p) || 0), 0);
    renderChart(el.querySelector('#rc1'), { type: 'bar', money: true, labels: depts, datasets: [
      { label: 'Projected profit', data: depts.map((d) => dSum(d, (p) => p.calc.profit.projectedProfit)), color: '#16A34A' },
      { label: 'Adjusted profit', data: depts.map((d) => dSum(d, (p) => p.calc.profit.adjustedProfit)), color: '#7C3AED' }], onClick: (l) => { f.dept = l; renderF(); update(); } });
    const months = lastMonths(12);
    const mSum = (m, fn) => list.filter((p) => (p.basic.poDate || '').startsWith(m)).reduce((s, p) => s + (fn(p) || 0), 0);
    renderChart(el.querySelector('#rc2'), { type: 'line', money: true, labels: months.map(monthLabel), datasets: [
      { label: 'Projected profit', data: months.map((m) => mSum(m, (p) => p.calc.profit.projectedProfit)), color: '#16A34A' },
      ...(canSeeAllExpenses(u) ? [{ label: 'Expenses', data: months.map((m) => mSum(m, (p) => p.calc.expenses?.total)), color: '#F59E0B' }] : [])] });
    if (canSeeAllExpenses(u)) {
      const L = { purchase: 'Actual purchase', transport: 'Transport', pilot: 'Pilot', other: 'Other' };
      renderChart(el.querySelector('#rc3'), { type: 'doughnut', money: true, labels: EXPENSE_DOMAINS.map((c) => L[c]), datasets: [{ label: 'Expenses', data: EXPENSE_DOMAINS.map((c) => list.reduce((s, p) => s + sumTxns(p.expenses?.[c]?.txns), 0)), colors: ['#101D35', '#2563EB', '#C62828', '#F59E0B'] }] });
    }
    el.querySelector('#rt').innerHTML = list.length ? `<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>Project</th><th>Dept</th>${can(u, 'po') ? '<th class="num">PO value</th>' : ''}${canSeeAllExpenses(u) ? '<th class="num">Total expenses</th>' : ''}<th class="num">Projected profit</th><th class="num">Adjusted profit</th><th class="num">Margin</th></tr></thead><tbody>
      ${sorted.map((p) => { const r = p.calc.profit; return `<tr class="clickable" data-go="${esc(p.id)}"><td data-l="Project"><span class="pid">${esc(p.id)}</span>${r.costOverrun ? ` ${badge('Over PO', 'red', 'alert-triangle')}` : ''}</td><td data-l="Dept">${esc(p.basic.department)}</td>
        ${can(u, 'po') ? `<td data-l="PO value" class="num">${amt(p.po?.poValue ?? null)}</td>` : ''}${canSeeAllExpenses(u) ? `<td data-l="Total expenses" class="num ${r.costOverrun ? 'neg' : ''}">${amt(p.calc.expenses?.total)}</td>` : ''}
        <td data-l="Projected profit" class="num">${amt(r.projectedProfit)}</td><td data-l="Adjusted profit" class="num">${amt(r.adjustedProfit)}</td><td data-l="Margin" class="num ${r.margin < 0 ? 'neg' : ''}"><b>${percent(r.margin)}</b></td></tr>`; }).join('')}
      </tbody></table></div>` : empty('No data', 'No projects with profitability figures match the filters.', 'search-x');
    el.querySelectorAll('[data-go]').forEach((tr) => { tr.onclick = () => app.go(`#/project/${encodeURIComponent(tr.dataset.go)}`); });
    icons(el);
  }
  renderF(); update();
  return { update, destroy() { destroyCharts(el); } };
}
