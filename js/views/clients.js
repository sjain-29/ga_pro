/** Client Collection dashboard */
import { state, projects, loadedBasic } from '../store.js';
import { can, projectAllowed } from '../permissions.js';
import { todayIST, daysBetween, receivableOverdue, sumTxns, deductionTotals } from '../calc.js';
import { esc, money, percent, date } from '../format.js';
import { icon, icons, kpi, empty, amt, badge, progress, options, restricted } from '../ui.js';
import { renderChart, destroyCharts } from '../charts.js';
import { departmentNames, clientNames, CLIENT_STATUSES } from './common.js';
import { openTxnForm } from './project-detail.js';

const f = { dept: '', client: '', status: '', due: '' };
const RECONCILED = ['Complete', 'Settled with Deductions', 'Closed by Deductions'];

export function mount(el, route, app) {
  const u = state.profile;
  const poOk = can(u, 'po');
  el.innerHTML = `<div class="page-head"><div><h1>Client Payments &amp; Collections</h1><div class="sub">Cash received, LD/TDS deductions and adjusted outstanding receivables.</div></div></div>
    <div class="filters" id="cf"></div><div class="kpi-grid" id="ck"></div>
    <section class="card chart-card" style="margin-bottom:14px"><div class="card-head"><h3>${icon('bar-chart-horizontal')}Collections progress</h3><span class="card-sub">Top 12 receivables · cash, deductions and outstanding</span></div><div class="card-body" data-chart id="cc"></div></section>
    <section class="card"><div class="card-head"><h3>${icon('list')}Receivables</h3></div><div class="card-body" id="cl"></div></section>`;
  const h = el.querySelector('#cf');
  h.innerHTML = `<select class="input" data-k="dept"><option value="">All departments</option>${options(departmentNames(), f.dept)}</select>
    <select class="input" data-k="client"><option value="">All clients</option>${options(clientNames(), f.client)}</select>
    <select class="input" data-k="status"><option value="">All collection statuses</option>${options([...CLIENT_STATUSES, { value: '__reconciled', label: 'Fully reconciled (any)' }, { value: '__pending', label: 'Pending collections (Pending + Partial)' }], f.status)}</select>
    ${poOk ? `<select class="input" data-k="due"><option value="">Any due date</option>${options([{ value: 'overdue', label: 'Overdue (past contractual due date)' }, { value: 'due30', label: 'Due within 30 days' }, { value: 'nodue', label: 'No contractual due date' }], f.due)}</select>` : ''}
    <span class="date-basis">${icon('info')}Overdue uses the contractual client due date only — never the project end date.</span>`;
  h.querySelectorAll('[data-k]').forEach((s) => { s.onchange = () => { f[s.dataset.k] = s.value; update(); }; });

  function update() {
    if (!loadedBasic()) return;
    const t = todayIST();
    let list = projects().filter((p) => (!f.dept || p.basic.department === f.dept) && (!f.client || p.basic.clientName === f.client));
    const st = (p) => p.calc.client?.status;
    if (f.status === '__reconciled') list = list.filter((p) => RECONCILED.includes(st(p)));
    else if (f.status === '__pending') list = list.filter((p) => ['Pending', 'Partial'].includes(st(p)));
    else if (f.status) list = list.filter((p) => st(p) === f.status);
    if (f.due === 'overdue') list = list.filter((p) => receivableOverdue(p.po, p.calc.client, t));
    if (f.due === 'due30') list = list.filter((p) => p.po?.clientDueDate && p.calc.client?.outstanding > 0 && daysBetween(t, p.po.clientDueDate) >= 0 && daysBetween(t, p.po.clientDueDate) <= 30);
    if (f.due === 'nodue') list = list.filter((p) => !p.po?.clientDueDate);
    const sum = (fn) => list.reduce((s, p) => s + (fn(p) || 0), 0);
    // Without PO access the receivable is unknown, but cash and deductions are still visible.
    const c = (p) => p.calc.client || (() => { const d = deductionTotals(p.clientPay?.deductions); return { received: sumTxns(p.clientPay?.receipts), ld: d.LD, tds: d.TDS, adj: d.ADJ, deductions: d.LD + d.TDS + d.ADJ, outstanding: null }; })();
    el.querySelector('#ck').innerHTML = [
      kpi({ label: 'Total Client Receivables', value: poOk ? amt(sum((p) => c(p).receivable)) : restricted(), ico: 'file-text', tone: 'navy' }),
      kpi({ label: 'Cash Received', value: amt(sum((p) => c(p).received)), ico: 'banknote', tone: 'green' }),
      kpi({ label: 'Outstanding Receivables', value: poOk ? amt(sum((p) => Math.max(0, c(p).outstanding || 0))) : restricted(), ico: 'clock-alert', tone: 'red', calc: true, sub: poOk ? `${list.filter((p) => receivableOverdue(p.po, p.calc.client, t)).length} overdue vs due date` : '' }),
      kpi({ label: 'LD Deductions', value: amt(sum((p) => c(p).ld)), ico: 'scissors', tone: 'purple' }),
      kpi({ label: 'TDS Deductions', value: amt(sum((p) => c(p).tds)), ico: 'landmark', tone: 'teal' }),
      kpi({ label: 'Fully Reconciled Projects', value: list.filter((p) => RECONCILED.includes(st(p))).length, ico: 'circle-check', tone: 'green' }),
      kpi({ label: 'Pending Collections', value: list.filter((p) => ['Pending', 'Partial'].includes(st(p))).length, ico: 'hourglass', tone: 'orange' }),
    ].join('');

    const top = list.filter((p) => c(p).receivable).sort((a, b) => c(b).receivable - c(a).receivable).slice(0, 12);
    renderChart(el.querySelector('#cc'), { type: 'bar', money: true, stacked: true, horizontal: true, labels: top.map((p) => p.id), datasets: [
      { label: 'Cash received', data: top.map((p) => c(p).received), color: '#16A34A' },
      { label: 'LD / TDS / adjustments', data: top.map((p) => c(p).deductions), color: '#0D9488' },
      { label: 'Outstanding', data: top.map((p) => Math.max(0, c(p).outstanding || 0)), color: '#C62828' }],
      onClick: (l) => app.go(`#/project/${encodeURIComponent(l)}`) });

    const rows = [...list].sort((a, b) => (c(b).outstanding || 0) - (c(a).outstanding || 0));
    el.querySelector('#cl').innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>Project</th><th class="num">Receivable</th><th class="num">Cash received</th><th class="num">LD</th><th class="num">TDS</th><th class="num">Outstanding</th><th>Collection</th><th>Due date</th><th></th></tr></thead><tbody>
      ${rows.map((p) => { const x = c(p); const od = receivableOverdue(p.po, p.calc.client, t); const ed = can(u, 'clientPay', 'edit') && projectAllowed(u, p.id);
        return `<tr><td data-l="Project"><a href="#/project/${encodeURIComponent(p.id)}" class="pid">${esc(p.id)}</a><div class="small">${esc(p.basic.clientName)}</div></td>
        <td data-l="Receivable" class="num">${poOk ? amt(x.receivable ?? null) : restricted()}</td><td data-l="Cash received" class="num">${amt(x.received ?? 0)}</td>
        <td data-l="LD" class="num">${amt(x.ld ?? 0)}</td><td data-l="TDS" class="num">${amt(x.tds ?? 0)}</td>
        <td data-l="Outstanding" class="num ${x.outstanding < 0 ? 'neg' : ''}"><b>${x.outstanding === null || x.outstanding === undefined ? '—' : amt(x.outstanding)}</b></td>
        <td data-l="Collection" style="min-width:150px">${x.status ? badge(x.status) : ''}<div style="margin-top:6px">${progress(x.settledPct ?? 0, RECONCILED.includes(x.status) ? 'green' : 'orange')}</div><div class="small muted">Cash ${percent(x.cashPct ?? null, 0, '—')}</div></td>
        <td data-l="Due date">${p.po?.clientDueDate ? `${date(p.po.clientDueDate)}${od ? ` ${badge('Overdue', 'red')}` : ''}` : '<span class="muted small">Not set</span>'}</td>
        <td class="txn-actions">${ed ? `<button class="btn btn-sm btn-navy" data-rec="${esc(p.id)}">${icon('plus')}Receipt</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : empty('No receivables', 'No projects match the filters.', 'search-x');
    el.querySelectorAll('[data-rec]').forEach((b) => { b.onclick = () => openTxnForm(projects().find((p) => p.id === b.dataset.rec), 'clientPay', 'receipts'); });
    icons(el);
  }
  update();
  return { update, destroy() { destroyCharts(el); } };
}
