/** Helpers shared by multiple views: filters, aggregation, small renderers. */
import { state, projects, activeDepartments } from '../store.js';
import { can, canSeeAllExpenses, EXPENSE_DOMAINS } from '../permissions.js';
import { periodRange, inRange, todayIST, sumTxns, deductionTotals, receivableOverdue } from '../calc.js';
import { esc, money, date, daysLabel } from '../format.js';
import { icon, badge, options, restricted, amt } from '../ui.js';

export const PROJECT_STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
export const PERIODS = [['all', 'All time'], ['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['quarter', 'This Quarter'], ['fy', 'This FY'], ['custom', 'Custom']];
export const DEADLINE_KEYS = [['ontrack', 'On Track'], ['attention', 'Attention'], ['critical', 'Critical'], ['today', 'Due Today'], ['overdue', 'Overdue'], ['closed', 'Closed'], ['nodate', 'No End Date']];
export const VENDOR_STATUSES = ['Pending', 'Partial', 'Complete', 'Overpaid', 'Amount Not Confirmed'];
export const CLIENT_STATUSES = ['Pending', 'Partial', 'Complete', 'Settled with Deductions', 'Closed by Deductions', 'Excess / Reconciliation Required', 'Not Configured'];

/** All department names ever used (active + inactive + those on historical projects). */
export function departmentNames({ includeInactive = true } = {}) {
  const set = new Set((includeInactive ? state.departments : activeDepartments()).map((d) => d.name));
  if (includeInactive) projects({ includeArchived: true }).forEach((p) => p.basic.department && set.add(p.basic.department));
  return [...set].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}
export const clientNames = () => [...new Set(projects({ includeArchived: true }).map((p) => p.basic.clientName).filter(Boolean))].sort();

/** Standard filter bar (period/department/status/client). f is a mutable filter-state object. */
export function filterBar(f, { period = true, status = true, client = true, basis = 'PO Date', extra = '' } = {}) {
  return `<div class="filters">
    ${period ? `<div class="seg" role="group" aria-label="Period">${PERIODS.map(([k, l]) => `<button type="button" data-period="${k}" class="${f.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
    ${period && f.period === 'custom' ? `<input type="date" class="input" data-f="from" value="${esc(f.from || '')}" aria-label="From date"><input type="date" class="input" data-f="to" value="${esc(f.to || '')}" aria-label="To date">` : ''}
    <select class="input" data-f="dept" aria-label="Department"><option value="">All departments</option>${options(departmentNames(), f.dept)}</select>
    ${status ? `<select class="input" data-f="status" aria-label="Project status"><option value="">All statuses</option>${options(PROJECT_STATUSES, f.status)}</select>` : ''}
    ${client ? `<select class="input" data-f="client" aria-label="Client"><option value="">All clients</option>${options(clientNames(), f.client)}</select>` : ''}
    ${extra}
    ${period ? `<span class="date-basis" title="Which project date the period filter uses">${icon('calendar')}Period filter uses: <b>${esc(basis)}</b></span>` : ''}
  </div>`;
}

/** Wire a filter bar rendered by filterBar(); calls onChange after updating f. */
export function wireFilters(el, f, onChange) {
  el.querySelectorAll('[data-period]').forEach((b) => { b.onclick = () => { f.period = b.dataset.period; onChange(true); }; });
  el.querySelectorAll('[data-f]').forEach((i) => { i.onchange = () => { f[i.dataset.f] = i.value; onChange(i.dataset.f === 'from' || i.dataset.f === 'to' ? false : false); }; });
}

export function rangeOf(f) {
  if (!f.period || f.period === 'all') return null;
  if (f.period === 'custom') return f.from || f.to ? { start: f.from || '0000-01-01', end: f.to || '9999-12-31' } : null;
  return periodRange(f.period, todayIST());
}

export function applyFilters(list, f, dateField = 'poDate') {
  const r = rangeOf(f);
  return list.filter((p) => (!f.dept || p.basic.department === f.dept)
    && (!f.status || p.basic.status === f.status)
    && (!f.client || p.basic.clientName === f.client)
    && (!r || inRange(p.basic[dateField], r)));
}

/** Aggregate figures across projects, only from data the user can read. null = restricted. */
export function aggregate(list) {
  const u = state.profile;
  const A = {
    total: list.length,
    active: list.filter((p) => !['Completed', 'Cancelled'].includes(p.basic.status)).length,
    completed: list.filter((p) => p.basic.status === 'Completed').length,
    critical: list.filter((p) => ['critical', 'today', 'overdue'].includes(p.calc.deadline.key)).length,
    overdue: list.filter((p) => p.calc.deadline.key === 'overdue').length,
    dueToday: list.filter((p) => p.calc.deadline.key === 'today').length,
    upcoming: list.filter((p) => p.calc.deadline.days !== null && p.calc.deadline.days >= 0 && p.calc.deadline.days <= 30).length,
  };
  const sum = (fn) => list.reduce((s, p) => s + (fn(p) || 0), 0);
  A.po = can(u, 'po') ? sum((p) => p.po?.poValue) : null;
  A.expenses = canSeeAllExpenses(u) ? sum((p) => p.calc.expenses?.total) : null;
  A.expByCat = Object.fromEntries(EXPENSE_DOMAINS.map((c) => [c, can(u, c) ? sum((p) => sumTxns(p.expenses?.[c]?.txns)) : null]));
  A.profit = can(u, 'profit') ? sum((p) => p.calc.profit?.projectedProfit) : null;
  A.adjProfit = can(u, 'profit') ? sum((p) => p.calc.profit?.adjustedProfit) : null;
  A.margin = A.profit !== null && A.po ? (A.profit / A.po) * 100 : null;
  if (can(u, 'vendor')) {
    A.vendorPaid = sum((p) => p.calc.vendor?.paid);
    A.vendorPayable = sum((p) => p.calc.vendor?.payable);
    A.vendorOutstanding = sum((p) => Math.max(0, p.calc.vendor?.outstanding || 0));
  } else A.vendorPaid = A.vendorPayable = A.vendorOutstanding = null;
  if (can(u, 'clientPay')) {
    A.received = sum((p) => sumTxns(p.clientPay?.receipts));
    const d = list.map((p) => deductionTotals(p.clientPay?.deductions));
    A.ld = d.reduce((s, x) => s + x.LD, 0); A.tds = d.reduce((s, x) => s + x.TDS, 0); A.adj = d.reduce((s, x) => s + x.ADJ, 0);
    A.clientOutstanding = can(u, 'po') ? sum((p) => Math.max(0, p.calc.client?.outstanding || 0)) : null;
    A.receivable = can(u, 'po') ? sum((p) => p.calc.client?.receivable) : null;
    const t = todayIST();
    A.receivableOverdue = can(u, 'po') ? list.filter((p) => receivableOverdue(p.po, p.calc.client, t)).length : null;
  } else A.received = A.ld = A.tds = A.adj = A.clientOutstanding = A.receivable = A.receivableOverdue = null;
  return A;
}

/** Value or restricted marker */
export const val = (v, render = (x) => amt(x)) => (v === null || v === undefined ? restricted() : render(v));

export function deadlineBadge(d) {
  const ico = { overdue: 'alarm-clock-off', today: 'alarm-clock', critical: 'flame', attention: 'clock', ontrack: 'check', closed: 'circle-check', nodate: 'calendar-x' }[d.key];
  return badge(d.label, { red: 'red', orange: 'orange', yellow: 'yellow', green: 'green', muted: 'muted' }[d.tone], ico);
}

export const projectLink = (p) => `#/project/${encodeURIComponent(p.id)}`;

export function criticalRow(p) {
  const d = p.calc.deadline;
  return `<a class="list-item" href="${projectLink(p)}">
    <div class="li-main"><div class="li-title"><span class="pid">${esc(p.id)}</span> · ${esc(p.basic.description)}</div>
    <div class="li-sub">${esc(p.basic.clientName)} · <span class="dept-tag">${esc(p.basic.department)}</span> · Deadline ${date(p.basic.endDate)}</div></div>
    ${deadlineBadge(d)}<span class="days-pill ${d.days < 0 ? 'neg' : ''}" style="min-width:92px;text-align:right">${daysLabel(d.days)}</span></a>`;
}

/** Month keys (YYYY-MM) for the last n months ending this month. */
export function lastMonths(n = 12) {
  const t = todayIST();
  let y = +t.slice(0, 4), m = +t.slice(5, 7);
  const out = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } }
  return out;
}
export const monthLabel = (k) => new Date(k + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export const statusBadge = (s) => badge(s);
export const fmtMoney = money;
