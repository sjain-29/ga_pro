/** Management Dashboard */
import { state, projects, loadedBasic } from '../store.js';
import { can, canSeeAllExpenses, isAdmin, EXPENSE_DOMAINS } from '../permissions.js';
import { sumTxns, todayIST, financialYear } from '../calc.js';
import { esc, money, moneyShort, percent, relTime, date } from '../format.js';
import { icon, icons, kpi, skeleton, empty, restricted } from '../ui.js';
import { renderChart, destroyCharts } from '../charts.js';
import { filterBar, wireFilters, applyFilters, aggregate, val, criticalRow, lastMonths, monthLabel, projectLink, VENDOR_STATUSES, CLIENT_STATUSES, PROJECT_STATUSES, departmentNames } from './common.js';

const f = { period: 'fy', dept: '', status: '', client: '', from: '', to: '' };
let watchTab = 'critical';

export function mount(el, route, app) {
  const u = state.profile;
  const fy = financialYear(todayIST());
  el.innerHTML = `
    <div class="page-head"><div><h1>Management Dashboard</h1>
      <div class="sub">${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }))} · ${fy.label} (Apr–Mar) · Asia/Kolkata</div></div></div>
    <div id="dash-filters"></div>
    <div id="dash-body">${skeleton(8)}</div>`;

  const goTo = (q) => app.go(`#/projects?${new URLSearchParams(q)}`);

  function renderFilters() {
    const host = el.querySelector('#dash-filters');
    host.innerHTML = filterBar(f, { basis: 'PO Date' });
    wireFilters(host, f, () => { renderFilters(); update(); });
    icons(host);
  }

  function update() {
    const body = el.querySelector('#dash-body');
    if (!loadedBasic()) { body.innerHTML = `<div class="kpi-grid">${skeleton(8)}</div><div class="charts-grid">${skeleton(2, 'sk-chart')}</div>`; return; }
    const all = projects();
    const list = applyFilters(all, f, 'poDate');
    const A = aggregate(list);
    const deadlineAll = applyFilters(all, { ...f, period: 'all' }); // deadline watch ignores the PO-date period
    const W = {
      critical: deadlineAll.filter((p) => p.calc.deadline.key === 'critical'),
      today: deadlineAll.filter((p) => p.calc.deadline.key === 'today'),
      overdue: deadlineAll.filter((p) => p.calc.deadline.key === 'overdue'),
      within30: deadlineAll.filter((p) => p.calc.deadline.days !== null && p.calc.deadline.days >= 0 && p.calc.deadline.days <= 30),
    };
    for (const k of Object.keys(W)) W[k].sort((a, b) => a.calc.deadline.days - b.calc.deadline.days);

    if (!all.length) {
      destroyCharts(body);
      body.innerHTML = `<div class="card">${empty('No projects yet', can(u, 'basic', 'create') ? 'Create your first project to start tracking POs, expenses and collections.' : 'No projects have been shared with you yet. Ask an administrator to assign projects.', 'folder-plus', can(u, 'basic', 'create') ? `<button class="btn btn-primary" id="dash-add">${icon('plus')}Add New Project</button>` : '')}</div>`;
      body.querySelector('#dash-add')?.addEventListener('click', async () => (await import('./projects.js')).openProjectWizard(app));
      icons(body);
      return;
    }

    const wingSvg = '<svg class="hero-wing" viewBox="0 0 64 64"><path fill="#fff" d="M10 38c8-2 14-7 19-16l3-6 3 6c5 9 11 14 19 16-7 3-13 2-19-2l-3 10-3-10c-6 4-12 5-19 2z"/></svg>';
    const hasCharts = body.querySelector('[data-chart]');
    if (!hasCharts) {
      body.innerHTML = `
        <section class="hero">${wingSvg}
          <div><h2>Good ${greeting()}, ${esc(u.fullName.split(' ')[0])}</h2><p id="hero-text"></p></div>
          <div class="hero-stats" id="hero-stats"></div>
        </section>
        <div class="kpi-section">Projects</div><div class="kpi-grid" id="k-proj"></div>
        <div class="kpi-section">Financials</div><div class="kpi-grid" id="k-fin"></div>
        <div class="kpi-section">Payments &amp; collections</div><div class="kpi-grid" id="k-pay"></div>
        <div class="two-col">
          <section class="card"><div class="card-head"><h3>${icon('siren')}Deadline watch</h3><div class="seg" id="watch-tabs"></div></div><div class="card-body" id="watch-list"></div></section>
          <section class="card"><div class="card-head"><h3>${icon('activity')}Recent activity</h3>${isAdmin(u) || can(u, 'audit') ? '<a class="link-btn small" href="#/audit">View all</a>' : ''}</div><div class="card-body" id="feed"></div></section>
        </div>
        <div class="charts-grid" id="charts"></div>`;
    }
    body.querySelector('#hero-text').textContent = `Live view of ${A.total} project${A.total === 1 ? '' : 's'} in the selected period${f.dept ? ` · ${f.dept}` : ''}. Deadline alerts use your thresholds (attention ≤ ${state.settings.attentionDays} days, critical ≤ ${state.settings.criticalDays} days).`;
    body.querySelector('#hero-stats').innerHTML = [
      ['Active projects', A.active, '#/projects?status=In%20Progress'],
      ['Due today', W.today.length, '#/projects?deadline=today'],
      ['Critical', W.critical.length, '#/projects?deadline=critical'],
      ['Overdue', W.overdue.length, '#/projects?deadline=overdue'],
    ].map(([l, v, h]) => `<a class="hero-stat" href="${h}"><div class="l">${l}</div><div class="v">${v}</div></a>`).join('');

    body.querySelector('#k-proj').innerHTML = [
      kpi({ label: 'Total Projects', value: A.total, ico: 'folder-kanban', tone: 'navy', href: '#/projects' }),
      kpi({ label: 'Active Projects', value: A.active, ico: 'rocket', tone: 'blue', sub: 'Not completed / cancelled', href: '#/projects?active=1' }),
      kpi({ label: 'Completed Projects', value: A.completed, ico: 'badge-check', tone: 'green', href: '#/projects?status=Completed' }),
      kpi({ label: 'Critical Projects', value: A.critical, ico: 'flame', tone: 'red', sub: 'Critical, due today or overdue', href: '#/projects?deadline=risk' }),
      kpi({ label: 'Upcoming Deadlines', value: A.upcoming, ico: 'calendar-clock', tone: 'orange', sub: 'Ending within 30 days', href: '#/projects?deadline=within30' }),
    ].join('');
    body.querySelector('#k-fin').innerHTML = [
      kpi({ label: 'Total PO Value', value: val(A.po), ico: 'file-signature', tone: 'navy' }),
      kpi({ label: 'Total Project Expenses', value: val(A.expenses), ico: 'receipt', tone: 'orange', calc: true }),
      kpi({ label: 'Total Remaining Profit', value: val(A.profit), ico: 'trending-up', tone: A.profit < 0 ? 'red' : 'green', calc: true, sub: A.adjProfit !== null ? `Adjusted (after LD): ${money(A.adjProfit)}` : '' }),
      kpi({ label: 'Overall Profit Margin', value: A.margin === null ? (can(u, 'profit') && can(u, 'po') ? 'N/A' : restricted()) : `<span class="${A.margin < 0 ? 'neg' : ''}">${percent(A.margin)}</span>`, ico: 'percent', tone: 'purple', calc: true }),
    ].join('');
    body.querySelector('#k-pay').innerHTML = [
      kpi({ label: 'Vendor Payments Made', value: val(A.vendorPaid), ico: 'send', tone: 'blue', href: can(u, 'vendor') ? '#/vendors' : '' }),
      kpi({ label: 'Outstanding Vendor Payments', value: val(A.vendorOutstanding), ico: 'hourglass', tone: 'orange', calc: true, href: can(u, 'vendor') ? '#/vendors' : '' }),
      kpi({ label: 'Client Payments Received', value: val(A.received), ico: 'banknote', tone: 'green', href: can(u, 'clientPay') ? '#/clients' : '' }),
      kpi({ label: 'Outstanding Client Payments', value: val(A.clientOutstanding), ico: 'clock-alert', tone: 'red', calc: true, href: can(u, 'clientPay') ? '#/clients' : '' }),
      kpi({ label: 'Total LD Deductions', value: val(A.ld), ico: 'scissors', tone: 'purple' }),
      kpi({ label: 'Total TDS Deductions', value: val(A.tds), ico: 'landmark', tone: 'teal' }),
    ].join('');

    // Deadline watch
    const tabs = [['critical', `Critical (${W.critical.length})`], ['today', `Due today (${W.today.length})`], ['overdue', `Overdue (${W.overdue.length})`], ['within30', `≤ 30 days (${W.within30.length})`]];
    const tabHost = body.querySelector('#watch-tabs');
    tabHost.innerHTML = tabs.map(([k, l]) => `<button data-w="${k}" class="${watchTab === k ? 'on' : ''}">${l}</button>`).join('');
    tabHost.querySelectorAll('button').forEach((b) => { b.onclick = () => { watchTab = b.dataset.w; update(); }; });
    const wl = W[watchTab];
    body.querySelector('#watch-list').innerHTML = wl.length ? wl.slice(0, 8).map(criticalRow).join('') + (wl.length > 8 ? `<a class="link-btn small" href="#/projects?deadline=${watchTab}">View all ${wl.length}</a>` : '')
      : empty('Nothing here', 'No projects in this deadline group.', 'party-popper');

    // Activity feed
    const feed = body.querySelector('#feed');
    if (isAdmin(u) || can(u, 'audit')) {
      const logs = Object.values(state.logs || {}).sort((a, b) => b.ts - a.ts).slice(0, 7);
      feed.innerHTML = logs.length ? logs.map((l) => `<div class="list-item"><div class="feed-ico">${icon(actionIcon(l.action))}</div><div class="li-main"><div class="li-title">${esc(actionLabel(l.action))}${l.projectId ? ` · <a class="pid" href="#/project/${encodeURIComponent(l.projectId)}">${esc(l.projectId)}</a>` : ''}</div><div class="li-sub">@${esc(l.username)} · ${relTime(l.ts)}${l.field ? ` · ${esc(l.field)}` : ''}</div></div></div>`).join('') : empty('No activity yet', '', 'history');
    } else {
      const recent = [...all].sort((a, b) => (b.basic.updatedAt || 0) - (a.basic.updatedAt || 0)).slice(0, 7);
      feed.innerHTML = recent.map((p) => `<a class="list-item" href="${projectLink(p)}"><div class="feed-ico">${icon('pencil-line')}</div><div class="li-main"><div class="li-title"><span class="pid">${esc(p.id)}</span> updated</div><div class="li-sub">${esc(p.basic.description)} · ${relTime(p.basic.updatedAt)}</div></div></a>`).join('');
    }

    renderCharts(body.querySelector('#charts'), list, goTo);
    icons(body);
  }

  renderFilters();
  update();
  const onTheme = () => { destroyCharts(el); el.querySelector('#charts') && (el.querySelector('#charts').innerHTML = ''); update(); };
  window.addEventListener('themechange', onTheme);
  return { update, destroy() { destroyCharts(el); window.removeEventListener('themechange', onTheme); } };
}

function chartCard(id, title, ico, sub = '') {
  return `<section class="card chart-card"><div class="card-head"><h3>${icon(ico)}${title}</h3><span class="card-sub">${sub}</span></div><div class="card-body" data-chart id="${id}"></div></section>`;
}

function renderCharts(host, list, goTo) {
  const u = state.profile;
  const specs = [];
  const depts = departmentNames().filter((d) => list.some((p) => p.basic.department === d));
  specs.push(['c-dept', 'Department-wise projects', 'pie-chart', 'Click a bar to filter', {
    type: 'bar', labels: depts, datasets: [{ label: 'Projects', data: depts.map((d) => list.filter((p) => p.basic.department === d).length), color: '#C62828' }],
    onClick: (l) => goTo({ dept: l }),
  }]);
  const months = lastMonths(12);
  const byMonth = (fn) => months.map((m) => list.filter((p) => (p.basic.poDate || '').startsWith(m)).reduce((s, p) => s + (fn(p) || 0), 0));
  if (can(u, 'po')) specs.push(['c-po', 'Monthly PO value', 'file-signature', 'By PO date, last 12 months', { type: 'bar', money: true, labels: months.map(monthLabel), datasets: [{ label: 'PO value', data: byMonth((p) => p.po?.poValue) }] }]);
  const visibleExp = EXPENSE_DOMAINS.filter((c) => can(u, c));
  if (visibleExp.length) {
    const expByMonth = months.map((m) => list.reduce((s, p) => s + visibleExp.reduce((s2, c) => s2 + sumTxns(Object.fromEntries(Object.entries(p.expenses?.[c]?.txns || {}).filter(([, t]) => (t.date || '').startsWith(m)))), 0), 0));
    specs.push(['c-exp', 'Monthly project expenses', 'receipt', visibleExp.length < 4 ? 'Only categories you can view' : 'By expense date', { type: 'line', money: true, labels: months.map(monthLabel), datasets: [{ label: 'Expenses', data: expByMonth, color: '#F59E0B' }] }]);
  }
  if (can(u, 'profit') && canSeeAllExpenses(u)) {
    specs.push(['c-pve', 'Profit vs expenses', 'scale', 'By PO month', { type: 'bar', money: true, stacked: false, labels: months.map(monthLabel), datasets: [
      { label: 'Expenses', data: byMonth((p) => p.calc.expenses?.total), color: '#F59E0B' },
      { label: 'Projected profit', data: byMonth((p) => p.calc.profit?.projectedProfit), color: '#16A34A' }] }]);
  }
  if (can(u, 'vendor')) {
    const labels = VENDOR_STATUSES.filter((s) => list.some((p) => p.calc.vendor?.status === s));
    specs.push(['c-vendor', 'Vendor payment status', 'wallet', 'Click to filter', { type: 'doughnut', labels, datasets: [{ label: 'Projects', data: labels.map((s) => list.filter((p) => p.calc.vendor?.status === s).length) }], onClick: (l) => goTo({ vstatus: l }) }]);
  }
  if (can(u, 'clientPay') && can(u, 'po')) {
    const labels = CLIENT_STATUSES.filter((s) => list.some((p) => p.calc.client?.status === s));
    specs.push(['c-client', 'Client payment status', 'hand-coins', 'Click to filter', { type: 'doughnut', labels, datasets: [{ label: 'Projects', data: labels.map((s) => list.filter((p) => p.calc.client?.status === s).length) }], onClick: (l) => goTo({ cstatus: l }) }]);
  }
  const sl = PROJECT_STATUSES.filter((s) => list.some((p) => p.basic.status === s));
  specs.push(['c-status', 'Project completion status', 'list-checks', 'Click to filter', { type: 'doughnut', labels: sl, datasets: [{ label: 'Projects', data: sl.map((s) => list.filter((p) => p.basic.status === s).length) }], onClick: (l) => goTo({ status: l }) }]);
  if (can(u, 'profit')) {
    specs.push(['c-dprofit', 'Department-wise profitability', 'trending-up', 'Projected profit', { type: 'bar', money: true, horizontal: true, labels: depts, datasets: [{ label: 'Projected profit', data: depts.map((d) => list.filter((p) => p.basic.department === d).reduce((s, p) => s + (p.calc.profit?.projectedProfit || 0), 0)), color: '#16A34A' }], onClick: (l) => goTo({ dept: l }) }]);
  }
  const ids = specs.map((s) => s[0]).join(',');
  if (host.dataset.ids !== ids) { destroyCharts(host); host.innerHTML = specs.map(([id, t, i, s]) => chartCard(id, t, i, s)).join(''); host.dataset.ids = ids; icons(host); }
  for (const [id, , , , spec] of specs) renderChart(host.querySelector('#' + id), spec);
}

function greeting() {
  const h = +new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date());
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

export function actionLabel(a = '') {
  const map = {
    'project.create': 'Project created', 'project.update': 'Project updated', 'project.archive': 'Project archived', 'project.unarchive': 'Project restored from archive',
    'project.delete': 'Project deleted (soft)', 'project.restore': 'Project restored', 'project.complete': 'Project completed', 'project.status': 'Status changed',
    'quotation.update': 'Quotation changed', 'expense.add': 'Expense added', 'expense.edit': 'Expense edited', 'expense.void': 'Expense voided',
    'vendor.payment': 'Vendor payment recorded', 'vendor.edit': 'Vendor payment edited', 'vendor.void': 'Vendor payment voided', 'vendor.update': 'Vendor payable updated',
    'client.payment': 'Client payment recorded', 'client.edit': 'Client payment edited', 'client.void': 'Client payment voided', 'client.deduction': 'LD/TDS/adjustment recorded',
    'po.update': 'PO / receivable updated', 'client.update': 'Client contact updated', 'comment.add': 'Comment added', 'attachment.add': 'Attachment uploaded',
    'user.create': 'User created', 'user.update': 'User updated', 'user.activate': 'User activated', 'user.deactivate': 'User deactivated', 'user.passwordReset': 'Password reset sent',
    'permissions.update': 'Permissions changed', 'settings.update': 'Settings changed', 'department.add': 'Department added', 'department.update': 'Department updated',
    'admin.bootstrap': 'Administrator set up', 'import.csv': 'Projects imported',
  };
  return map[a] || a;
}
export function actionIcon(a = '') {
  if (a.startsWith('project')) return 'folder-pen';
  if (a.startsWith('quotation')) return 'scale';
  if (a.startsWith('expense')) return 'receipt';
  if (a.startsWith('vendor')) return 'wallet';
  if (a.startsWith('client')) return 'hand-coins';
  if (a.startsWith('user') || a.startsWith('permissions') || a.startsWith('admin')) return 'user-cog';
  if (a.startsWith('comment')) return 'message-square';
  return 'activity';
}
