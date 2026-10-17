/** Projects: listing, multi-step creation wizard, edit drawer, archive/delete, CSV import. */
import { state, projects, loadedBasic, createProject, commit, setArchived, setDeleted, projectIdExists, PROJECT_ID_RE, activeDepartments } from '../store.js';
import { backend } from '../db.js';
import { can, isAdmin, projectAllowed } from '../permissions.js';
import { rupeesToPaise, todayIST, daysBetween } from '../calc.js';
import { esc, money, percent, date, daysLabel, paiseToInput } from '../format.js';
import { icon, icons, badge, toast, errorMessage, modal, drawer, confirmDialog, busy, formData, fieldError, moneyInput, options, empty, skeleton, restricted, amt, debounce, searchableSelect } from '../ui.js';
import { PROJECT_STATUSES, DEADLINE_KEYS, VENDOR_STATUSES, CLIENT_STATUSES, departmentNames, deadlineBadge, projectLink } from './common.js';

const F = { q: '', dept: '', status: '', deadline: '', vstatus: '', cstatus: '', sort: 'updated', view: 'cards', scope: 'active', active: '' };
const expanded = new Set();

export function mount(el, route, app) {
  const u = state.profile;
  Object.assign(F, { dept: '', status: '', deadline: '', vstatus: '', cstatus: '', active: '' }, route.query || {});
  el.innerHTML = `
    <div class="page-head"><div><h1>Projects</h1><div class="sub">Every Purchase Order from receipt to completion.</div></div>
      <div class="page-actions">
        ${isAdmin(u) ? `<button class="btn btn-ghost" id="btn-import">${icon('upload')}Import CSV</button>` : ''}
        ${can(u, 'basic', 'create') ? `<button class="btn btn-primary" id="btn-new">${icon('plus')}Add New Project</button>` : ''}
      </div></div>
    <div class="filters">
      <div class="search">${icon('search')}<input class="input" id="p-q" placeholder="Search by Project ID, description or client" value="${esc(F.q)}" aria-label="Search projects"></div>
      <select class="input" data-k="dept" aria-label="Department"><option value="">All departments</option>${options(departmentNames(), F.dept)}</select>
      <select class="input" data-k="status" aria-label="Status"><option value="">All statuses</option>${options(PROJECT_STATUSES, F.status)}</select>
      <select class="input" data-k="deadline" aria-label="Deadline"><option value="">All deadlines</option>${options([...DEADLINE_KEYS.map(([v, l]) => ({ value: v, label: l })), { value: 'risk', label: 'At risk (critical/today/overdue)' }, { value: 'within30', label: 'Ending within 30 days' }], F.deadline)}</select>
      ${can(u, 'vendor') ? `<select class="input" data-k="vstatus" aria-label="Vendor payment"><option value="">Vendor payment: any</option>${options(VENDOR_STATUSES, F.vstatus)}</select>` : ''}
      ${can(u, 'clientPay') && can(u, 'po') ? `<select class="input" data-k="cstatus" aria-label="Client payment"><option value="">Client payment: any</option>${options(CLIENT_STATUSES, F.cstatus)}</select>` : ''}
      <select class="input" data-k="sort" aria-label="Sort">${options([{ value: 'updated', label: 'Recently updated' }, { value: 'end', label: 'End date (soonest)' }, ...(can(u, 'po') ? [{ value: 'po', label: 'PO value (highest)' }] : []), ...(can(u, 'profit') ? [{ value: 'margin', label: 'Profit margin (highest)' }] : []), { value: 'id', label: 'Project ID' }], F.sort)}</select>
      <div class="seg" id="scope">${[['active', 'Current'], ['archived', 'Archived'], ...(isAdmin(u) ? [['deleted', 'Trash']] : [])].map(([k, l]) => `<button data-scope="${k}" class="${F.scope === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg view-toggle"><button data-view="cards" class="${F.view === 'cards' ? 'on' : ''}" aria-label="Card view">${icon('layout-grid')}</button><button data-view="table" class="${F.view === 'table' ? 'on' : ''}" aria-label="Table view">${icon('rows-3')}</button></div>
    </div>
    <div id="chips"></div>
    <div id="p-list">${skeleton(6, 'sk-card')}</div>`;

  el.querySelector('#p-q').oninput = debounce((e) => { F.q = e.target.value; update(); }, 150);
  el.querySelectorAll('[data-k]').forEach((s) => { s.onchange = () => { F[s.dataset.k] = s.value; update(); }; });
  el.querySelectorAll('[data-scope]').forEach((b) => { b.onclick = () => { F.scope = b.dataset.scope; el.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('on', x === b)); update(); }; });
  el.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { F.view = b.dataset.view; el.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b)); update(); }; });
  el.querySelector('#btn-new')?.addEventListener('click', () => openProjectWizard(app));
  el.querySelector('#btn-import')?.addEventListener('click', () => openImport());

  function filtered() {
    let list = projects({ includeArchived: true, includeDeleted: F.scope === 'deleted' });
    list = list.filter((p) => (F.scope === 'deleted' ? p.basic.deleted : F.scope === 'archived' ? p.basic.archived && !p.basic.deleted : !p.basic.archived && !p.basic.deleted));
    const q = F.q.trim().toLowerCase();
    if (q) list = list.filter((p) => `${p.id} ${p.basic.description} ${p.basic.clientName}`.toLowerCase().includes(q));
    if (F.dept) list = list.filter((p) => p.basic.department === F.dept);
    if (F.status) list = list.filter((p) => p.basic.status === F.status);
    if (F.active) list = list.filter((p) => !['Completed', 'Cancelled'].includes(p.basic.status));
    if (F.deadline === 'risk') list = list.filter((p) => ['critical', 'today', 'overdue'].includes(p.calc.deadline.key));
    else if (F.deadline === 'within30') list = list.filter((p) => p.calc.deadline.days !== null && p.calc.deadline.days >= 0 && p.calc.deadline.days <= 30);
    else if (F.deadline) list = list.filter((p) => p.calc.deadline.key === F.deadline);
    if (F.vstatus) list = list.filter((p) => p.calc.vendor?.status === F.vstatus);
    if (F.cstatus) list = list.filter((p) => p.calc.client?.status === F.cstatus);
    const by = {
      updated: (a, b) => (b.basic.updatedAt || 0) - (a.basic.updatedAt || 0),
      end: (a, b) => (a.basic.endDate || '9999').localeCompare(b.basic.endDate || '9999'),
      po: (a, b) => (b.po?.poValue || 0) - (a.po?.poValue || 0),
      margin: (a, b) => (b.calc.profit?.margin ?? -1e9) - (a.calc.profit?.margin ?? -1e9),
      id: (a, b) => a.id.localeCompare(b.id),
    }[F.sort] || (() => 0);
    return list.sort(by);
  }

  function chips() {
    const labels = { dept: 'Department', status: 'Status', deadline: 'Deadline', vstatus: 'Vendor', cstatus: 'Client', active: 'Active only' };
    const act = Object.keys(labels).filter((k) => F[k]);
    const host = el.querySelector('#chips');
    host.innerHTML = act.length ? `<div class="filters">${act.map((k) => `<span class="chip">${labels[k]}${k === 'active' ? '' : `: ${esc(DEADLINE_KEYS.find(([v]) => v === F[k])?.[1] || F[k])}`}<button data-clear="${k}" aria-label="Clear filter">${icon('x')}</button></span>`).join('')}<button class="link-btn small" id="clear-all">Clear all</button></div>` : '';
    host.querySelectorAll('[data-clear]').forEach((b) => { b.onclick = () => { F[b.dataset.clear] = ''; const s = el.querySelector(`[data-k="${b.dataset.clear}"]`); if (s) s.value = ''; update(); }; });
    host.querySelector('#clear-all')?.addEventListener('click', () => { for (const k of act) { F[k] = ''; const s = el.querySelector(`[data-k="${k}"]`); if (s) s.value = ''; } update(); });
    icons(host);
  }

  function update() {
    chips();
    const host = el.querySelector('#p-list');
    if (!loadedBasic()) { host.innerHTML = `<div class="plist">${skeleton(6)}</div>`; return; }
    const list = filtered();
    if (!list.length) {
      host.innerHTML = `<div class="card">${empty(F.scope === 'deleted' ? 'Trash is empty' : F.scope === 'archived' ? 'No archived projects' : 'No projects match', F.q || Object.values(F).some(Boolean) ? 'Try clearing filters or searching for something else.' : '', 'search-x')}</div>`;
      icons(host); return;
    }
    host.innerHTML = F.view === 'cards' ? `<div class="plist">${list.map(card).join('')}</div>` : table(list);
    host.querySelectorAll('[data-open]').forEach((c) => {
      c.onclick = (e) => { if (e.target.closest('[data-act],[data-exp]')) return; app.go(`#/project/${encodeURIComponent(c.dataset.open)}`); };
      c.onkeydown = (e) => { if (e.key === 'Enter') app.go(`#/project/${encodeURIComponent(c.dataset.open)}`); };
    });
    host.querySelectorAll('[data-exp]').forEach((b) => { b.onclick = () => { const id = b.dataset.exp; expanded.has(id) ? expanded.delete(id) : expanded.add(id); update(); }; });
    host.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => projectAction(b.dataset.act, b.dataset.id, app); });
    icons(host);
  }

  update();
  return { update };
}

function card(p) {
  const u = state.profile, c = p.calc, d = c.deadline;
  const stripe = { red: '#C62828', orange: '#F59E0B', yellow: '#CA8A04', green: '#16A34A', muted: '#CBD5E1' }[d.tone];
  return `<article class="pcard" tabindex="0" data-open="${esc(p.id)}" aria-label="Project ${esc(p.id)}">
    <span class="stripe" style="background:${stripe}"></span>
    <div class="pcard-top"><div style="min-width:0"><div class="pid">${esc(p.id)}</div><h3>${esc(p.basic.description)}</h3></div><span class="dept-tag">${esc(p.basic.department)}</span></div>
    <div class="pcard-meta"><span>${icon('building-2')}${esc(p.basic.clientName)}</span><span>${icon('calendar')}${date(p.basic.endDate)}</span>${d.key === 'closed' ? '' : `<span>${icon('timer')}${daysLabel(d.days)}</span>`}</div>
    <div class="pcard-badges">${badge(p.basic.status)}${d.key === 'closed' ? '' : deadlineBadge(d)}${p.basic.archived ? badge('Archived') : ''}${p.basic.deleted ? badge('Deleted') : ''}</div>
    <div class="pcard-stats">
      <div><div class="l">PO value</div><div class="v">${can(u, 'po') ? amt(p.po?.poValue, 'Not set') : restricted()}</div></div>
      <div><div class="l">${can(u, 'clientPay') && can(u, 'po') ? 'Collection' : 'Vendor'}</div><div class="v">${can(u, 'clientPay') && can(u, 'po') ? badge(c.client?.status || '—') : can(u, 'vendor') ? badge(c.vendor?.status || '—') : restricted()}</div></div>
      <div><div class="l">Margin</div><div class="v">${c.profit ? `<span class="${c.profit.margin < 0 ? 'neg' : 'pos'}">${percent(c.profit.margin)}</span>` : restricted()}</div></div>
    </div></article>`;
}

function table(list) {
  const u = state.profile;
  return `<div class="card"><div class="table-wrap"><table class="tbl tbl-cards">
    <thead><tr><th></th><th>Project</th><th>Client</th><th>Dept</th>${can(u, 'po') ? '<th class="num">PO value</th>' : ''}<th>Status</th><th>Deadline</th>${can(u, 'vendor') ? '<th>Vendor</th>' : ''}${can(u, 'clientPay') && can(u, 'po') ? '<th>Client</th>' : ''}${can(u, 'profit') ? '<th class="num">Margin</th>' : ''}</tr></thead>
    <tbody>${list.map((p) => {
      const c = p.calc; const open = expanded.has(p.id);
      return `<tr class="clickable" data-open="${esc(p.id)}">
        <td data-l=""><button class="icon-btn" data-exp="${esc(p.id)}" aria-expanded="${open}" aria-label="Expand">${icon(open ? 'chevron-down' : 'chevron-right')}</button></td>
        <td data-l="Project"><div class="pid">${esc(p.id)}</div><div style="max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.basic.description)}</div></td>
        <td data-l="Client">${esc(p.basic.clientName)}</td><td data-l="Dept"><span class="dept-tag">${esc(p.basic.department)}</span></td>
        ${can(u, 'po') ? `<td data-l="PO value" class="num">${amt(p.po?.poValue, 'Not set')}</td>` : ''}
        <td data-l="Status">${badge(p.basic.status)}</td><td data-l="Deadline">${deadlineBadge(c.deadline)} <span class="muted small">${daysLabel(c.deadline.days)}</span></td>
        ${can(u, 'vendor') ? `<td data-l="Vendor">${badge(c.vendor?.status || '—')}</td>` : ''}
        ${can(u, 'clientPay') && can(u, 'po') ? `<td data-l="Client">${badge(c.client?.status || '—')}</td>` : ''}
        ${can(u, 'profit') ? `<td data-l="Margin" class="num ${c.profit?.margin < 0 ? 'neg' : ''}">${percent(c.profit?.margin)}</td>` : ''}
      </tr>${open ? `<tr><td colspan="10" style="background:var(--surface-2)">
        <div class="grid-3 small" style="padding:6px 4px">
          <div><b>PO date:</b> ${date(p.basic.poDate)}<br><b>End date:</b> ${date(p.basic.endDate)}</div>
          <div>${can(u, 'quotations') ? `<b>Lowest quote:</b> ${p.calc.lowest?.amount ? money(p.calc.lowest.amount) : 'Not Available'}<br>` : ''}${p.calc.expenses?.total !== null && p.calc.expenses ? `<b>Total expenses:</b> ${money(p.calc.expenses.total)}` : ''}</div>
          <div class="txn-actions" style="justify-content:flex-start">${actionButtons(p)}</div>
        </div>${p.basic.remarks ? `<div class="small muted" style="padding:0 4px 6px">${esc(p.basic.remarks)}</div>` : ''}</td></tr>` : ''}`;
    }).join('')}</tbody></table></div></div>`;
}

export function actionButtons(p) {
  const u = state.profile;
  const out = [];
  if (p.basic.deleted) { if (isAdmin(u)) out.push(`<button class="btn btn-sm btn-ghost" data-act="restore" data-id="${esc(p.id)}">${icon('undo-2')}Restore</button>`); return out.join(''); }
  if (can(u, 'basic', 'edit') && projectAllowed(u, p.id)) {
    out.push(`<button class="btn btn-sm btn-ghost" data-act="edit" data-id="${esc(p.id)}">${icon('pencil')}Edit</button>`);
    out.push(`<button class="btn btn-sm btn-ghost" data-act="${p.basic.archived ? 'unarchive' : 'archive'}" data-id="${esc(p.id)}">${icon(p.basic.archived ? 'archive-restore' : 'archive')}${p.basic.archived ? 'Unarchive' : 'Archive'}</button>`);
  }
  if (isAdmin(u)) out.push(`<button class="btn btn-sm btn-danger" data-act="delete" data-id="${esc(p.id)}">${icon('trash-2')}Delete</button>`);
  return out.join('');
}

export async function projectAction(act, pid, app) {
  const p = projects({ includeArchived: true, includeDeleted: true }).find((x) => x.id === pid);
  if (!p) return;
  try {
    if (act === 'edit') return openEditProject(p);
    if (act === 'archive') { if (await confirmDialog({ title: 'Archive project?', message: `${esc(pid)} will be hidden from active lists and dashboards. All financial records are kept and it can be unarchived any time.`, confirmText: 'Archive' })) { await setArchived(pid, true); toast('Project archived.'); } }
    if (act === 'unarchive') { await setArchived(pid, false); toast('Project restored from archive.'); }
    if (act === 'delete') {
      if (await confirmDialog({ title: 'Delete project?', danger: true, requireText: pid, confirmText: 'Delete project',
        message: `This moves <b>${esc(pid)}</b> to Trash (soft delete). Financial records are preserved for audit and an administrator can restore it from Projects → Trash.` })) {
        await setDeleted(pid, true); toast('Project moved to Trash.'); if (app && location.hash.startsWith('#/project/')) app.go('#/projects');
      }
    }
    if (act === 'restore') { await setDeleted(pid, false); toast('Project restored.'); }
  } catch (e) { toast(errorMessage(e), 'error'); }
}

/* ---------------------------------------------------------------- wizard */

function dateWarnings(poDate, endDate, isNew) {
  const w = []; const t = todayIST();
  if (poDate && daysBetween(t, poDate) > 30) w.push('PO date is more than 30 days in the future.');
  if (poDate && daysBetween(poDate, t) > 730) w.push('PO date is more than 2 years in the past.');
  if (endDate && poDate && daysBetween(poDate, endDate) > 1095) w.push('Project duration is longer than 3 years.');
  if (isNew && endDate && endDate < t) w.push('End date is already in the past — the project will show as Overdue.');
  return w;
}

export function openProjectWizard(app) {
  const u = state.profile;
  if (!can(u, 'basic', 'create')) { toast('You do not have permission to create projects.', 'error'); return; }
  const showContact = can(u, 'client', 'edit'), showPO = can(u, 'po', 'edit');
  const steps = ['Project', 'Client', ...(showPO ? ['Commercials'] : []), 'Review'];
  let step = 0;
  const data = { status: 'Not Started', department: '', gstMode: 'inclusive', gstPercent: '18' };
  const m = drawer({ title: 'Add New Project', size: 'md', body: '<div id="wz"></div>',
    footer: `<button class="btn btn-ghost" data-back>${icon('arrow-left')}Back</button><span style="flex:1"></span><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-next>Next${icon('arrow-right')}</button>` });
  const host = m.el.querySelector('#wz');
  const back = m.el.querySelector('[data-back]'), next = m.el.querySelector('[data-next]');
  m.el.querySelector('[data-cancel]').onclick = m.close;

  const depts = activeDepartments().map((d) => d.name);
  function render() {
    const s = steps[step];
    host.innerHTML = `<div class="stepper">${steps.map((t, i) => `<div class="step ${i === step ? 'on' : i < step ? 'done' : ''}"><span class="n">${i < step ? '✓' : i + 1}</span><span class="t">${t}</span></div>`).join('')}</div><form id="wz-form" novalidate>${stepBody(s)}</form>`;
    back.style.visibility = step ? 'visible' : 'hidden';
    next.innerHTML = step === steps.length - 1 ? `${icon('check')}Create project` : `Next${icon('arrow-right')}`;
    next.dataset.busy = 'Creating…';
    icons(m.el);
    searchableSelect(host.querySelector('select[name=department]'));
    host.querySelector('input,textarea,select')?.focus();
    host.querySelector('#wz-form').onsubmit = (e) => { e.preventDefault(); next.click(); };
  }
  function stepBody(s) {
    if (s === 'Project') return `<div class="grid-2">
      <label class="field"><span>Project ID <b class="req">*</b></span><input class="input" name="projectId" value="${esc(data.projectId || '')}" placeholder="e.g. GAL-AGRI-2603" autocomplete="off" autocapitalize="characters" maxlength="40"><small class="field-hint">Unique. Letters, numbers, - and _ only.</small></label>
      <label class="field"><span>Internal Department <b class="req">*</b></span><select class="input" name="department"><option value="">Select…</option>${options(depts, data.department)}</select></label>
      <label class="field span-2"><span>Project Description <b class="req">*</b></span><textarea class="input" name="description" maxlength="1000">${esc(data.description || '')}</textarea></label>
      <label class="field"><span>PO Date <b class="req">*</b></span><input class="input" type="date" name="poDate" value="${esc(data.poDate || '')}"></label>
      <label class="field"><span>Project End Date <b class="req">*</b></span><input class="input" type="date" name="endDate" value="${esc(data.endDate || '')}"></label>
      <label class="field"><span>Project Status</span><select class="input" name="status">${options(PROJECT_STATUSES, data.status)}</select></label>
      <label class="field span-2"><span>Remarks</span><textarea class="input" name="remarks" maxlength="2000" style="min-height:64px">${esc(data.remarks || '')}</textarea></label>
      <div class="span-2" id="date-warn"></div></div>`;
    if (s === 'Client') return `<div class="grid-2">
      <label class="field span-2"><span>Client Name <b class="req">*</b></span><input class="input" name="clientName" value="${esc(data.clientName || '')}" maxlength="200"></label>
      ${showContact ? `<label class="field"><span>Client Contact Person</span><input class="input" name="contactPerson" value="${esc(data.contactPerson || '')}" maxlength="120"></label>
      <label class="field"><span>Client Phone Number</span><input class="input" name="clientPhone" type="tel" value="${esc(data.clientPhone || '')}" maxlength="30" placeholder="+91 98xxx xxxxx"></label>
      <label class="field span-2"><span>Client Email</span><input class="input" name="clientEmail" type="email" value="${esc(data.clientEmail || '')}" maxlength="120"></label>`
      : `<div class="span-2 info-box">${icon('lock')}You do not have permission to enter client contact details. An authorised user can add them later.</div>`}</div>`;
    if (s === 'Commercials') return `<div class="grid-2">
      <label class="field span-2"><span>PO Value (₹) <b class="req">*</b></span>${moneyInput('poValue', data.poValue ?? null)}<small class="field-hint">Enter the PO amount. It cannot be negative.</small></label>
      <label class="field"><span>PO value is</span><select class="input" name="gstMode">${options([{ value: 'inclusive', label: 'Inclusive of GST' }, { value: 'exclusive', label: 'Exclusive of GST' }], data.gstMode)}</select></label>
      <label class="field"><span>GST rate (%)</span><input class="input" name="gstPercent" inputmode="decimal" value="${esc(data.gstPercent)}"><small class="field-hint">When exclusive, GST is added to the client receivable.</small></label></div>`;
    // Review
    const rows = [['Project ID', data.projectId], ['Description', data.description], ['Department', data.department], ['Status', data.status], ['PO date', date(data.poDate)], ['End date', date(data.endDate)],
      ['Client', data.clientName], ...(showContact ? [['Contact', [data.contactPerson, data.clientPhone, data.clientEmail].filter(Boolean).join(' · ') || '—']] : []),
      ...(showPO ? [['PO value', money(data.poValue)], ['GST', `${data.gstMode === 'exclusive' ? 'Exclusive' : 'Inclusive'} · ${data.gstPercent}%`]] : []), ['Remarks', data.remarks || '—']];
    const w = dateWarnings(data.poDate, data.endDate, true);
    return `<dl class="review-list">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${w.length ? `<div class="warn-box" style="margin-top:14px">${icon('alert-triangle')}<div>${w.map(esc).join('<br>')}</div></div>` : ''}`;
  }

  async function validate() {
    const form = host.querySelector('#wz-form');
    const fd = formData(form);
    const s = steps[step];
    let ok = true;
    const err = (n, msg) => { fieldError(form, n, msg); if (msg) ok = false; };
    if (s === 'Project') {
      fd.projectId = (fd.projectId || '').toUpperCase();
      err('projectId', !fd.projectId ? 'Project ID is required.' : !PROJECT_ID_RE.test(fd.projectId) ? 'Use 2–40 letters, numbers, - or _.' : '');
      err('department', fd.department ? '' : 'Choose a department.');
      err('description', fd.description ? '' : 'Description is required.');
      err('poDate', fd.poDate ? '' : 'PO date is required.');
      err('endDate', !fd.endDate ? 'End date is required.' : fd.poDate && fd.endDate < fd.poDate ? 'End date cannot be before the PO date.' : '');
      if (ok && await projectIdExists(fd.projectId)) err('projectId', `Project ID ${fd.projectId} already exists.`);
      const w = dateWarnings(fd.poDate, fd.endDate, true);
      host.querySelector('#date-warn').innerHTML = w.length ? `<div class="warn-box">${icon('alert-triangle')}<div>${w.map(esc).join('<br>')}<br><b>You can continue if these dates are correct.</b></div></div>` : '';
      icons(host);
    }
    if (s === 'Client') {
      err('clientName', fd.clientName ? '' : 'Client name is required.');
      if (fd.clientEmail !== undefined) err('clientEmail', fd.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fd.clientEmail) ? 'Enter a valid email.' : '');
      if (fd.clientPhone !== undefined) err('clientPhone', fd.clientPhone && !/^[+\d][\d\s()-]{6,}$/.test(fd.clientPhone) ? 'Enter a valid phone number.' : '');
    }
    if (s === 'Commercials') {
      fd.poValue = rupeesToPaise(fd.poValue);
      err('poValue', fd.poValue === null ? 'Enter a valid PO value.' : fd.poValue < 0 ? 'PO value cannot be negative.' : '');
      const g = Number(fd.gstPercent);
      err('gstPercent', !Number.isFinite(g) || g < 0 || g > 40 ? 'GST must be between 0 and 40%.' : '');
    }
    if (ok) Object.assign(data, fd);
    return ok;
  }

  back.onclick = () => { if (step) { Object.assign(data, formData(host.querySelector('#wz-form'))); step--; render(); } };
  next.onclick = async () => {
    if (step < steps.length - 1) { if (await validate()) { step++; render(); } return; }
    await busy(next, async () => {
      try {
        const pid = await createProject({ ...data, gstPercentBp: Math.round(Number(data.gstPercent || 0) * 100) });
        toast(`Project ${pid} created.`, 'success');
        m.close();
        app && app.go(`#/project/${encodeURIComponent(pid)}`);
      } catch (e) { toast(errorMessage(e), 'error'); }
    });
  };
  render();
}

/* ------------------------------------------------------------------ edit */
export function openEditProject(p) {
  const u = state.profile;
  const canBasic = can(u, 'basic', 'edit'), canClient = can(u, 'client', 'edit') && p.client !== undefined, canPO = can(u, 'po', 'edit') && p.po !== undefined;
  const depts = [...new Set([...activeDepartments().map((d) => d.name), p.basic.department])];
  const b = p.basic, c = p.client || {}, po = p.po || {};
  const m = drawer({ title: `Edit ${p.id}`, size: 'md', body: `<form id="ed" novalidate class="grid-2">
      <label class="field"><span>Project ID</span><input class="input" value="${esc(p.id)}" readonly><small class="field-hint">Project IDs cannot be changed.</small></label>
      <label class="field"><span>Department</span><select class="input" name="department" ${canBasic ? '' : 'disabled'}>${options(depts, b.department)}</select></label>
      <label class="field span-2"><span>Description</span><textarea class="input" name="description" ${canBasic ? '' : 'disabled'}>${esc(b.description)}</textarea></label>
      <label class="field"><span>PO Date</span><input class="input" type="date" name="poDate" value="${esc(b.poDate)}" ${canBasic ? '' : 'disabled'}></label>
      <label class="field"><span>End Date</span><input class="input" type="date" name="endDate" value="${esc(b.endDate)}" ${canBasic ? '' : 'disabled'}></label>
      <label class="field"><span>Status</span><select class="input" name="status" ${canBasic ? '' : 'disabled'}>${options(PROJECT_STATUSES, b.status)}</select></label>
      <label class="field"><span>Client Name</span><input class="input" name="clientName" value="${esc(b.clientName)}" ${canBasic ? '' : 'disabled'}></label>
      ${canClient ? `<label class="field"><span>Contact Person</span><input class="input" name="contactPerson" value="${esc(c.contactPerson || '')}"></label>
        <label class="field"><span>Phone</span><input class="input" name="clientPhone" value="${esc(c.phone || '')}"></label>
        <label class="field span-2"><span>Client Email</span><input class="input" type="email" name="clientEmail" value="${esc(c.email || '')}"></label>` : ''}
      ${canPO ? `<label class="field"><span>PO Value (₹)</span>${moneyInput('poValue', po.poValue ?? null)}</label>
        <label class="field"><span>Client payment due date</span><input class="input" type="date" name="clientDueDate" value="${esc(po.clientDueDate || '')}"><small class="field-hint">Used for overdue receivables (contractual date).</small></label>` : ''}
      <label class="field span-2"><span>Remarks</span><textarea class="input" name="remarks" ${canBasic ? '' : 'disabled'}>${esc(b.remarks || '')}</textarea></label>
      <div class="span-2" id="ed-warn"></div></form>`,
    footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-save>${icon('save')}Save changes</button>` });
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-save]').onclick = (e) => busy(e.currentTarget, async () => {
    const form = m.el.querySelector('#ed');
    const fd = formData(form);
    let ok = true;
    const err = (n, msg) => { fieldError(form, n, msg); if (msg) ok = false; };
    if (canBasic) {
      err('description', fd.description ? '' : 'Description is required.');
      err('clientName', fd.clientName ? '' : 'Client name is required.');
      err('endDate', fd.endDate && fd.poDate && fd.endDate < fd.poDate ? 'End date cannot be before the PO date.' : '');
    }
    let poPaise;
    if (canPO) { poPaise = rupeesToPaise(fd.poValue); err('poValue', fd.poValue && (poPaise === null || poPaise < 0) ? 'Enter a valid, non-negative PO value.' : ''); }
    if (canClient) err('clientEmail', fd.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fd.clientEmail) ? 'Enter a valid email.' : '');
    if (!ok) return;
    const updates = {}; const logs = []; const ts = backend.serverTime();
    if (canBasic) {
      for (const k of ['description', 'department', 'poDate', 'endDate', 'status', 'clientName', 'remarks']) {
        if ((fd[k] || '') !== (b[k] || '')) {
          updates[`projects/${p.id}/${k}`] = fd[k];
          logs.push({ action: k === 'status' ? (fd[k] === 'Completed' ? 'project.complete' : 'project.status') : 'project.update', projectId: p.id, field: k, prev: b[k] || '', next: fd[k] });
        }
      }
    }
    if (canClient) {
      const map = { contactPerson: 'contactPerson', clientPhone: 'phone', clientEmail: 'email' };
      for (const [fk, dk] of Object.entries(map)) if ((fd[fk] || '') !== (c[dk] || '')) { updates[`clientContacts/${p.id}/${dk}`] = fd[fk]; logs.push({ action: 'client.update', projectId: p.id, field: dk, prev: c[dk] || '', next: fd[fk] }); }
      if (Object.keys(updates).some((k) => k.startsWith('clientContacts'))) { updates[`clientContacts/${p.id}/updatedAt`] = ts; updates[`clientContacts/${p.id}/updatedBy`] = state.uid; }
    }
    if (canPO) {
      if ((poPaise ?? null) !== (po.poValue ?? null)) { updates[`poValues/${p.id}/poValue`] = poPaise; logs.push({ action: 'po.update', projectId: p.id, field: 'PO value', prev: money(po.poValue ?? null), next: money(poPaise ?? null) }); }
      if ((fd.clientDueDate || '') !== (po.clientDueDate || '')) { updates[`poValues/${p.id}/clientDueDate`] = fd.clientDueDate; logs.push({ action: 'po.update', projectId: p.id, field: 'Client due date', prev: po.clientDueDate || '', next: fd.clientDueDate }); }
      if (Object.keys(updates).some((k) => k.startsWith('poValues'))) { updates[`poValues/${p.id}/updatedAt`] = ts; updates[`poValues/${p.id}/updatedBy`] = state.uid; }
    }
    if (!logs.length) { toast('No changes to save.', 'info'); m.close(); return; }
    if (canBasic) { updates[`projects/${p.id}/updatedAt`] = ts; updates[`projects/${p.id}/updatedBy`] = state.uid; }
    const w = canBasic ? dateWarnings(fd.poDate, fd.endDate, false) : [];
    if (w.length && !(await confirmDialog({ title: 'Unusual dates', message: w.map(esc).join('<br>') + '<br><br>Save anyway?', confirmText: 'Save' }))) return;
    try { await commit(updates, logs); toast('Project updated.'); m.close(); } catch (ex) { toast(errorMessage(ex), 'error'); }
  });
  icons(m.el);
}

/* ------------------------------------------------------------ CSV import */
const CSV_COLS = ['projectId', 'description', 'clientName', 'contactPerson', 'clientEmail', 'clientPhone', 'department', 'poValue', 'poDate', 'endDate', 'status', 'remarks'];

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function openImport() {
  const m = modal({ title: 'Import projects from CSV', size: 'lg', body: `
    <div class="info-box" style="margin-bottom:14px">${icon('info')}<div>Columns: <code>${CSV_COLS.join(', ')}</code>. Dates as YYYY-MM-DD, PO value in rupees. Rows with errors are skipped. Existing Project IDs are never overwritten.
    <br><button class="link-btn" id="tpl">Download template</button></div></div>
    <input type="file" accept=".csv,text/csv" class="input" id="csv-file" style="padding-top:8px">
    <div id="csv-preview" style="margin-top:14px"></div>`,
    footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok disabled>${icon('upload')}Import</button>` });
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('#tpl').onclick = () => {
    const blob = new Blob([CSV_COLS.join(',') + '\nGAL-AGRI-2699,Sample spraying drones,Sample Client,R. Name,client@example.com,+91 9840000000,Agri,1250000,2026-10-01,2027-01-31,Not Started,Imported\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'garuda-projects-template.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  let valid = [];
  m.el.querySelector('#csv-file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const rows = parseCSV(await file.text());
    const head = rows.shift()?.map((h) => h.trim()) || [];
    const missing = ['projectId', 'description', 'clientName', 'department', 'poDate', 'endDate'].filter((c) => !head.includes(c));
    const prev = m.el.querySelector('#csv-preview');
    if (missing.length) { prev.innerHTML = `<div class="warn-box">${icon('alert-triangle')}Missing required columns: ${missing.join(', ')}</div>`; icons(prev); return; }
    const existing = new Set(projects({ includeArchived: true, includeDeleted: true }).map((p) => p.id));
    const seen = new Set();
    const depts = new Set(state.departments.map((d) => d.name));
    const parsed = rows.map((r) => {
      const o = Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()]));
      o.projectId = o.projectId.toUpperCase();
      const errs = [];
      if (!PROJECT_ID_RE.test(o.projectId)) errs.push('invalid ID');
      if (existing.has(o.projectId) || seen.has(o.projectId)) errs.push('duplicate ID');
      seen.add(o.projectId);
      if (!o.description) errs.push('no description');
      if (!o.clientName) errs.push('no client');
      if (!depts.has(o.department)) errs.push('unknown department');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(o.poDate) || !/^\d{4}-\d{2}-\d{2}$/.test(o.endDate)) errs.push('bad date');
      else if (o.endDate < o.poDate) errs.push('end before PO');
      o.status = PROJECT_STATUSES.includes(o.status) ? o.status : 'Not Started';
      o.poPaise = o.poValue ? rupeesToPaise(o.poValue) : null;
      if (o.poValue && (o.poPaise === null || o.poPaise < 0)) errs.push('bad PO value');
      return { o, errs };
    });
    valid = parsed.filter((x) => !x.errs.length).map((x) => x.o);
    prev.innerHTML = `<p style="margin-bottom:8px"><b>${valid.length}</b> valid · <b>${parsed.length - valid.length}</b> with errors</p>
      <div class="table-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>Project ID</th><th>Description</th><th>Dept</th><th class="num">PO value</th><th>Result</th></tr></thead>
      <tbody>${parsed.map(({ o, errs }) => `<tr><td class="pid">${esc(o.projectId)}</td><td>${esc(o.description)}</td><td>${esc(o.department)}</td><td class="num">${o.poPaise !== null ? money(o.poPaise) : '—'}</td><td>${errs.length ? badge(errs.join(', '), 'red') : badge('Ready', 'green')}</td></tr>`).join('')}</tbody></table></div>`;
    m.el.querySelector('[data-ok]').disabled = !valid.length;
  };
  m.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
    try {
      const ts = backend.serverTime();
      for (let i = 0; i < valid.length; i += 50) {
        const updates = {};
        for (const o of valid.slice(i, i + 50)) {
          updates[`projects/${o.projectId}`] = { projectId: o.projectId, description: o.description, clientName: o.clientName, department: o.department, status: o.status, poDate: o.poDate, endDate: o.endDate, remarks: o.remarks || '', archived: false, createdAt: ts, createdBy: state.uid, updatedAt: ts, updatedBy: state.uid };
          updates[`projectIndex/${o.projectId}`] = true;
          updates[`clientContacts/${o.projectId}`] = { contactPerson: o.contactPerson || '', email: o.clientEmail || '', phone: o.clientPhone || '', updatedAt: ts, updatedBy: state.uid };
          if (o.poPaise !== null) updates[`poValues/${o.projectId}`] = { poValue: o.poPaise, gstMode: 'inclusive', gstPercentBp: 1800, tdsTreatment: 'credit', updatedAt: ts, updatedBy: state.uid };
        }
        await commit(updates, [{ action: 'import.csv', next: `${Object.keys(updates).filter((k) => k.startsWith('projects/')).length} projects` }]);
      }
      toast(`${valid.length} projects imported.`); m.close();
    } catch (ex) { toast(errorMessage(ex), 'error'); }
  });
  icons(m.el);
}

export { paiseToInput };
