/** Procurement & Quotations analytics */
import { state, projects, loadedBasic } from '../store.js';
import { can } from '../permissions.js';
import { sumTxns } from '../calc.js';
import { esc, money, percent } from '../format.js';
import { icon, icons, kpi, empty, skeleton, amt, restricted, debounce } from '../ui.js';
import { renderChart, destroyCharts } from '../charts.js';
import { filterBar, wireFilters, applyFilters, projectLink, val } from './common.js';

const f = { period: 'all', dept: '', status: '', client: '', q: '' };

export function mount(el, route, app) {
  const u = state.profile;
  const seePurchase = can(u, 'purchase');
  el.innerHTML = `<div class="page-head"><div><h1>Procurement &amp; Quotations</h1><div class="sub">Compare L1/L2/L3 quotations, the lowest quote, approved value and actual purchase cost.</div></div></div>
    <div id="pf"></div><div class="kpi-grid" id="pk"></div>
    <section class="card chart-card" style="margin-bottom:14px"><div class="card-head"><h3>${icon('bar-chart-3')}Quoted cost vs actual purchase</h3><span class="card-sub">Top 12 projects by quoted value · click to open</span></div><div class="card-body" data-chart id="pc"></div></section>
    <section class="card"><div class="card-head"><h3>${icon('table')}Quotation comparison</h3><div class="search" style="position:relative;width:260px;max-width:100%">${icon('search')}<input class="input" id="pq" placeholder="Search project / vendor" style="padding-left:36px" value="${esc(f.q)}"></div></div><div class="card-body" id="pt">${skeleton(4, 'sk-row')}</div></section>`;
  el.querySelector('.search .ico').style.cssText = 'position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-3)';
  el.querySelector('#pq').oninput = debounce((e) => { f.q = e.target.value; update(); }, 150);
  const renderF = () => { const h = el.querySelector('#pf'); h.innerHTML = filterBar(f, { basis: 'PO Date' }); wireFilters(h, f, () => { renderF(); update(); }); icons(h); };

  function update() {
    if (!loadedBasic()) return;
    const q = f.q.toLowerCase();
    const list = applyFilters(projects(), f).filter((p) => !q || `${p.id} ${p.basic.description} ${['q1', 'q2', 'q3'].map((k) => p.quotations?.[k]?.vendor || '').join(' ')}`.toLowerCase().includes(q));
    const rows = list.map((p) => {
      const qv = p.quotations || {};
      const purchase = seePurchase ? sumTxns(p.expenses?.purchase?.txns) : null;
      const ref = qv.approvedValue > 0 ? qv.approvedValue : p.calc.lowest.amount;
      return { p, qv, low: p.calc.lowest, purchase, ref, variance: purchase !== null && ref && purchase > 0 ? purchase - ref : null };
    });
    const withQuotes = rows.filter((r) => r.low.amount);
    const sum = (fn) => rows.reduce((s, r) => s + (fn(r) || 0), 0);
    el.querySelector('#pk').innerHTML = [
      kpi({ label: 'Projects with quotations', value: `${withQuotes.length} / ${rows.length}`, ico: 'scale', tone: 'navy' }),
      kpi({ label: 'Total lowest quotations', value: amt(sum((r) => r.low.amount)), ico: 'award', tone: 'green', calc: true }),
      kpi({ label: 'Total approved purchase value', value: amt(sum((r) => r.qv.approvedValue)), ico: 'stamp', tone: 'blue' }),
      kpi({ label: 'Actual purchase cost', value: val(seePurchase ? sum((r) => r.purchase) : null), ico: 'package', tone: 'orange' }),
      kpi({ label: 'Net procurement variance', value: val(seePurchase ? sum((r) => r.variance) : null, (v) => `<span class="${v > 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${money(v)}</span>`), ico: 'git-compare', tone: 'purple', calc: true, sub: 'Actual − approved (or lowest) · positive = overspend' }),
    ].join('');

    const top = [...withQuotes].sort((a, b) => b.ref - a.ref).slice(0, 12);
    renderChart(el.querySelector('#pc'), {
      type: 'bar', money: true, labels: top.map((r) => r.p.id),
      datasets: [{ label: 'Lowest quotation', data: top.map((r) => r.low.amount || 0), color: '#16A34A' }, { label: 'Approved value', data: top.map((r) => r.qv.approvedValue || 0), color: '#2563EB' },
        ...(seePurchase ? [{ label: 'Actual purchase', data: top.map((r) => r.purchase || 0), color: '#C62828' }] : [])],
      onClick: (label) => app.go(`#/project/${encodeURIComponent(label)}`),
    });

    const cell = (r, k) => {
      const a = r.qv[k]?.amount;
      return `<td data-l="L${k.slice(1)}" class="num" style="${r.low.slot === k ? 'font-weight:700;color:var(--green)' : ''}">${a > 0 ? amt(a) : '<span class="muted">—</span>'}${r.qv[k]?.vendor ? `<div class="small muted">${esc(r.qv[k].vendor)}</div>` : ''}</td>`;
    };
    el.querySelector('#pt').innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>Project</th><th class="num">L1</th><th class="num">L2</th><th class="num">L3</th><th class="num">Lowest</th><th class="num">Approved</th><th class="num">Actual purchase</th><th class="num">Variance</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="clickable" data-go="${esc(r.p.id)}"><td data-l="Project"><span class="pid">${esc(r.p.id)}</span><div class="small" style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.p.basic.description)}</div></td>
        ${cell(r, 'q1')}${cell(r, 'q2')}${cell(r, 'q3')}
        <td data-l="Lowest" class="num"><b>${r.low.amount ? amt(r.low.amount) : 'Not Available'}</b></td>
        <td data-l="Approved" class="num">${amt(r.qv.approvedValue ?? null)}</td>
        <td data-l="Actual purchase" class="num">${seePurchase ? amt(r.purchase || null) : restricted()}</td>
        <td data-l="Variance" class="num ${r.variance > 0 ? 'neg' : r.variance < 0 ? 'pos' : ''}">${r.variance === null ? '—' : `${r.variance > 0 ? '+' : ''}${money(r.variance)}<div class="small">${percent(r.ref ? (r.variance / r.ref) * 100 : null)}</div>`}</td></tr>`).join('')}
      </tbody></table></div>` : empty('No projects', 'No projects match the filters.', 'search-x');
    el.querySelectorAll('[data-go]').forEach((tr) => { tr.onclick = () => app.go(`#/project/${encodeURIComponent(tr.dataset.go)}`); });
    icons(el);
  }
  renderF(); update();
  return { update, destroy() { destroyCharts(el); } };
}
