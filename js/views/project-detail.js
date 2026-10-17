/** Project Workspace — header + independent module cards. */
import { state, project, updateRecord, addTxn, editTxn, voidTxn, addComment, commit } from '../store.js';
import { backend } from '../db.js';
import { can, isAdmin, projectAllowed, EXPENSE_DOMAINS, DOMAIN } from '../permissions.js';
import { rupeesToPaise, todayIST, daysBetween, sumTxns } from '../calc.js';
import { esc, money, percent, date, daysLabel, dateTime, relTime, initials } from '../format.js';
import { icon, icons, badge, toast, errorMessage, modal, drawer, confirmDialog, busy, formData, fieldError, moneyInput, options, empty, restricted, amt, progress } from '../ui.js';
import { deadlineBadge } from './common.js';
import { actionButtons, projectAction } from './projects.js';
import { actionLabel } from './dashboard.js';

const EXP_META = {
  purchase: { label: 'Actual Purchase Price', ico: 'package' },
  transport: { label: 'Transport Expenses', ico: 'truck' },
  pilot: { label: 'Pilot Expenses', ico: 'plane' },
  other: { label: 'Other Expenses', ico: 'shapes' },
};
const openAcc = new Set();

export function mount(el, route, app) {
  const pid = route.param;
  const u = state.profile;
  el.innerHTML = '<div id="ws-main"><div id="ws-header"></div><div class="ws-grid" id="ws-grid"></div></div><div id="ws-missing"></div>';
  const offs = [];

  function update() {
    const p = project(pid);
    const main = el.querySelector('#ws-main');
    const missing = el.querySelector('#ws-missing');
    if (!p) {
      main.classList.add('hidden');
      missing.innerHTML = state.loaded.basic ? `<div class="card">${empty('Project not found', 'It may not exist, or you may not have access to it.', 'folder-x', '<a class="btn btn-ghost" href="#/projects">Back to projects</a>')}</div>` : '<div class="skeleton" style="height:180px"></div>';
      icons(missing); return;
    }
    main.classList.remove('hidden'); missing.innerHTML = '';
    // Replace only the computed cards; comments/attachments keep their state (and any text being typed).
    const head = main.querySelector('#ws-header'); head.innerHTML = header(p);
    const grid = el.querySelector('#ws-grid');
    const cards = [procurementCard(p), vendorCard(p), expensesCard(p), profitCard(p), clientCard(p), detailsCard(p)];
    cards.forEach((html, i) => {
      const tmp = document.createElement('div'); tmp.innerHTML = html.trim();
      const node = tmp.firstElementChild; node.dataset.card = String(i);
      const old = grid.querySelector(`[data-card="${i}"]`);
      if (old) old.replaceWith(node); else grid.insertBefore(node, grid.querySelector('[data-side]'));
    });
    el.querySelectorAll('details.acc').forEach((d) => { d.open = openAcc.has(d.dataset.acc); d.ontoggle = () => (d.open ? openAcc.add(d.dataset.acc) : openAcc.delete(d.dataset.acc)); });
    wire(el.querySelector('#ws-main'), p, app);
    icons(el.querySelector('#ws-main'));
  }

  // Comments & attachments live in their own region so typing is never interrupted by re-renders.
  const side = el.querySelector('#ws-grid');
  const commentsOn = can(u, 'comments') && projectAllowed(u, pid);
  side.innerHTML = `${commentsOn ? `<section class="card mod" data-side id="comments"><div class="card-head"><h3>${icon('message-square')}Internal comments</h3></div><div class="card-body"><div id="c-list" style="max-height:340px;overflow-y:auto"></div>
      ${can(u, 'comments', 'edit') ? `<form id="c-form" style="display:flex;gap:8px;margin-top:10px"><input class="input" name="text" placeholder="Add a remark for the team…" maxlength="2000" aria-label="Comment"><button class="btn btn-navy">${icon('send')}</button></form>` : ''}</div></section>` : ''}
    ${can(u, 'files') && projectAllowed(u, pid) ? `<section class="card mod" data-side id="files"><div class="card-head"><h3>${icon('paperclip')}Attachments</h3></div><div class="card-body" id="f-body"></div></section>` : ''}`;
  if (commentsOn) {
    offs.push(backend.onValue(`comments/${pid}`, (v) => {
      const list = Object.values(v || {}).sort((a, b) => a.ts - b.ts);
      const host = side.querySelector('#c-list');
      host.innerHTML = list.length ? list.map((c) => `<div class="comment"><span class="avatar">${esc(initials(c.name))}</span><div><div class="who">${esc(c.name)}<span class="when">${relTime(c.ts)}</span></div><div class="txt">${esc(c.text)}</div></div></div>`).join('') : '<p class="muted small">No comments yet.</p>';
      host.scrollTop = host.scrollHeight;
    }, () => { side.querySelector('#c-list').innerHTML = restricted(); }));
    const cf = side.querySelector('#c-form');
    if (cf) cf.onsubmit = async (e) => {
      e.preventDefault();
      const t = cf.text.value.trim(); if (!t) return;
      try { await addComment(pid, t); cf.text.value = ''; } catch (ex) { toast(errorMessage(ex), 'error'); }
    };
  }
  if (side.querySelector('#f-body')) mountFiles(side.querySelector('#f-body'), pid, offs);
  icons(side);
  update();
  return { update, destroy() { offs.forEach((f) => f && f()); } };
}

/* ---------------------------------------------------------------- header */
function header(p) {
  const b = p.basic, c = p.calc, u = state.profile;
  return `<section class="ws-head">
    <div class="ws-top">
      <div class="ws-title">
        <div class="ws-crumbs"><a href="#/projects">Projects</a>${icon('chevron-right')}<span class="pid">${esc(p.id)}</span></div>
        <h1>${esc(b.description)}</h1>
        <div class="pcard-badges" style="margin-top:8px">${badge(b.status)}${deadlineBadge(c.deadline)}${b.archived ? badge('Archived') : ''}${b.deleted ? badge('Deleted') : ''}<span class="dept-tag">${esc(b.department)}</span></div>
      </div>
      <div class="page-actions no-print">
        ${actionButtons(p)}
        ${isAdmin(u) || can(u, 'audit') ? `<button class="btn btn-sm btn-ghost" data-act2="history">${icon('history')}History</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-act2="print">${icon('printer')}Print summary</button>
      </div>
    </div>
    <div class="ws-stats">
      <div class="ws-stat"><div class="l">Project ID</div><div class="v mono">${esc(p.id)}</div></div>
      <div class="ws-stat"><div class="l">Client</div><div class="v" title="${esc(b.clientName)}">${esc(b.clientName)}</div></div>
      <div class="ws-stat"><div class="l">PO Value</div><div class="v">${can(u, 'po') ? amt(p.po?.poValue, 'Not set') : restricted()}</div></div>
      <div class="ws-stat"><div class="l">PO Date</div><div class="v">${date(b.poDate)}</div></div>
      <div class="ws-stat"><div class="l">End Date</div><div class="v">${date(b.endDate)}</div></div>
      <div class="ws-stat"><div class="l">Days Remaining</div><div class="v ${c.deadline.days < 0 ? 'neg' : ''}">${c.deadline.key === 'closed' ? '—' : daysLabel(c.deadline.days)}</div></div>
    </div></section>`;
}

const locked = (title, ico, cls = '') => `<section class="card mod ${cls}"><div class="card-head"><h3>${icon(ico)}${title}</h3></div><div class="card-body">${empty('Restricted', 'You do not have permission to view this module for this project.', 'lock')}</div></section>`;
const editable = (dom, p) => can(state.profile, dom, 'edit') && projectAllowed(state.profile, p.id) && !p.basic.deleted;

/* ------------------------------------------------------------ procurement */
function procurementCard(p) {
  if (p.quotations === undefined) return locked('Procurement', 'scale');
  const q = p.quotations || {}, low = p.calc.lowest;
  const slot = (k, n) => {
    const a = q[k]?.amount; const valid = a > 0;
    return `<div class="qslot ${low.slot === k ? 'lowest' : ''}"><span class="tag">L${n}</span>
      <div style="min-width:0"><div class="vend">${esc(q[k]?.vendor || 'Vendor not specified')}${q[k]?.ref ? ` · ${esc(q[k].ref)}` : ''}</div></div>
      <div class="val">${valid ? amt(a) : '<span class="muted">—</span>'}${low.slot === k ? `<div class="small pos" style="font-weight:700">${icon('award', '')} Lowest</div>` : ''}</div></div>`;
  };
  const proc = p.calc.procurement;
  return `<section class="card mod"><div class="card-head"><h3><span class="mod-ico tone-navy">${icon('scale')}</span>Procurement</h3>${editable('quotations', p) ? `<button class="btn btn-sm btn-ghost" data-m="quotes">${icon('pencil')}Edit</button>` : ''}</div>
    <div class="card-body"><div class="quote-slots">${slot('q1', 1)}${slot('q2', 2)}${slot('q3', 3)}</div>
    <div class="lowest-box"><div><div class="l">Lowest Quotation <span class="calc-tag" style="background:rgba(255,255,255,.15);color:#fff">auto</span></div><div class="small" style="color:#b9c6df">${low.slot ? esc(q[low.slot]?.vendor || `L${low.slot.slice(1)}`) : 'No valid quotations'}</div></div><div class="v">${low.amount ? amt(low.amount) : 'Not Available'}</div></div>
    <div class="kv" style="margin-top:8px"><span class="k">Approved purchase value</span><span class="v">${amt(q.approvedValue ?? null, 'Not set')}</span></div>
    ${proc ? `<div class="kv"><span class="k">Variance vs ${proc.basis === 'approved' ? 'approved' : 'lowest quote'}</span><span class="v ${proc.variance > 0 ? 'neg' : 'pos'}">${proc.variance === null ? '—' : `${proc.variance > 0 ? '+' : ''}${money(proc.variance)}`}</span></div>` : ''}
    </div></section>`;
}

/* ----------------------------------------------------------------- vendor */
function txnTable(p, dom, list, items, cols, kindName) {
  const ed = editable(dom, p);
  const rows = Object.entries(items || {}).sort(([, a], [, b]) => (b.date || '').localeCompare(a.date || ''));
  if (!rows.length) return '<p class="muted small" style="padding:10px 12px">No transactions recorded yet.</p>';
  return `<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}<th></th></tr></thead><tbody>
    ${rows.map(([k, t]) => `<tr class="${t.void ? 'void' : ''}" title="${t.void ? `Voided: ${esc(t.voidReason || '')}` : `Recorded ${dateTime(t.createdAt)}`}">
      ${cols.map((c) => `<td data-l="${c.label}" class="${c.num ? 'num' : ''}">${c.render(t)}</td>`).join('')}
      <td class="txn-actions">${ed && !t.void ? `<button class="icon-btn" data-edit="${dom}|${list}|${k}" aria-label="Edit">${icon('pencil')}</button><button class="icon-btn" data-void="${dom}|${list}|${k}" aria-label="Void">${icon('ban')}</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}
const kindAmt = (t) => `${t.kind === 'refund' || t.kind === 'reversal' ? '<span class="badge tone-purple" style="height:20px">Refund</span> ' : ''}${amt(t.kind === 'refund' || t.kind === 'reversal' ? -Math.abs(t.amount) : t.amount)}`;

function vendorCard(p) {
  if (p.vendor === undefined) return locked('Vendor Payment', 'wallet');
  const v = p.calc.vendor, ed = editable('vendor', p);
  const tone = { Complete: 'green', Partial: 'orange', Pending: 'red', Overpaid: 'purple' }[v.status] || 'slate';
  return `<section class="card mod"><div class="card-head"><h3><span class="mod-ico tone-blue">${icon('wallet')}</span>Vendor Payment</h3>${badge(v.status)}</div>
    <div class="card-body">
      <div class="kv"><span class="k">Approved payable</span><span class="v">${v.payable === null ? '<span class="badge tone-slate">Amount Not Confirmed</span>' : amt(v.payable)}</span></div>
      <div class="kv"><span class="k">Total paid <span class="calc-tag">auto</span></span><span class="v">${amt(v.paid)}</span></div>
      <div class="kv"><span class="k">Outstanding <span class="calc-tag">auto</span></span><span class="v ${v.outstanding < 0 ? 'neg' : ''}">${v.outstanding === null ? '—' : amt(v.outstanding)}</span></div>
      <div style="margin:10px 0 4px;display:flex;justify-content:space-between" class="small"><span class="muted">Payment progress</span><b>${v.progress === null ? '—' : percent(v.progress, 0)}</b></div>
      ${progress(v.progress, tone, 'Vendor payment progress')}
      <label class="check" style="margin-top:12px"><input type="checkbox" data-vflag ${v.flagged ? 'checked' : ''} ${ed ? '' : 'disabled'}> Vendor Payment Completed</label>
      ${v.flagMismatch ? `<div class="warn-box mismatch">${icon('alert-triangle')}<div>Marked completed, but the recorded payments show <b>${esc(v.status)}</b>${v.outstanding > 0 ? ` with ${money(v.outstanding)} outstanding` : ''}. Status follows the actual amounts.</div></div>` : ''}
      ${ed ? `<div class="mod-actions"><button class="btn btn-sm btn-navy" data-m="vpay">${icon('plus')}Record payment</button><button class="btn btn-sm btn-ghost" data-m="vpayable">${icon('badge-indian-rupee')}Set payable</button></div>` : ''}
      <details class="acc" data-acc="v-${p.id}"><summary>${icon('list')}Payment transactions (${Object.keys(p.vendor?.txns || {}).length})${icon('chevron-down', 'chev')}</summary>
        ${txnTable(p, 'vendor', 'txns', p.vendor?.txns, [
          { label: 'Date', render: (t) => date(t.date) }, { label: 'Vendor', render: (t) => esc(t.vendor || '—') },
          { label: 'Amount', num: true, render: kindAmt }, { label: 'UTR / Ref', render: (t) => `<span class="mono">${esc(t.ref || '—')}</span>` },
          { label: 'Remarks', render: (t) => esc(t.remarks || '') }])}</details>
    </div></section>`;
}

/* --------------------------------------------------------------- expenses */
function expensesCard(p) {
  const u = state.profile;
  const visible = EXPENSE_DOMAINS.filter((c) => can(u, c));
  if (!visible.length) return locked('Expenses', 'receipt');
  const e = p.calc.expenses;
  return `<section class="card mod"><div class="card-head"><h3><span class="mod-ico tone-orange">${icon('receipt')}</span>Expenses</h3><span class="card-sub">Click a card for transactions</span></div>
    <div class="card-body"><div class="exp-cards">
      ${EXPENSE_DOMAINS.map((c) => {
        const m = EXP_META[c];
        if (!can(u, c)) return `<div class="exp-card locked"><div class="l">${icon(m.ico)}${m.label}</div><div class="v">${restricted()}</div></div>`;
        const n = Object.values(p.expenses?.[c]?.txns || {}).filter((t) => !t.void).length;
        return `<button class="exp-card" data-exp="${c}"><div class="l">${icon(m.ico)}${m.label}</div><div class="v">${amt(e?.[c] ?? 0)}</div><div class="c">${n} entr${n === 1 ? 'y' : 'ies'}</div></button>`;
      }).join('')}
    </div>
    <div class="kv total"><span class="k">Total Project Expenses <span class="calc-tag">auto</span></span><span class="v">${e?.total === null || e?.total === undefined ? restricted('Partial access') : amt(e.total)}</span></div>
    <div class="note">${icon('info')}Total = Actual Purchase Price + Transport + Pilot + Other. Quotations are not counted as expenses.</div>
    </div></section>`;
}

/* ------------------------------------------------------------ profitability */
function profitCard(p) {
  const pr = p.calc.profit;
  if (!pr) return locked('Profitability', 'trending-up');
  const cls = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : '');
  const ed = editable('po', p);
  return `<section class="card mod"><div class="card-head"><h3><span class="mod-ico tone-green">${icon('trending-up')}</span>Profitability</h3>${pr.costOverrun ? badge('Cost exceeds PO', 'red', 'alert-triangle') : ''}</div>
    <div class="card-body"><div class="profit-hero">
      <div class="pbox ${cls(pr.projectedProfit)}"><div class="l">Projected profit</div><div class="v">${amt(pr.projectedProfit)}</div></div>
      <div class="pbox ${cls(pr.margin)}"><div class="l">Profit margin</div><div class="v">${percent(pr.margin)}</div></div>
      <div class="pbox ${cls(pr.adjustedProfit)}"><div class="l">Adjusted profit (after LD)</div><div class="v">${amt(pr.adjustedProfit)}</div></div>
      <div class="pbox"><div class="l">Adjusted margin</div><div class="v">${pr.adjustedMargin !== undefined ? percent(pr.adjustedMargin) : percent(null)}</div></div>
    </div>
    ${pr.poValue !== undefined ? `<div class="kv" style="margin-top:8px"><span class="k">PO value − total expenses</span><span class="v">${money(pr.poValue)} − ${money(pr.totalExpenses)}</span></div>` : ''}
    ${p.po ? `<div class="kv"><span class="k">TDS treatment</span><span class="v">${ed ? `<select class="input" data-tds style="height:32px;width:auto">${options([{ value: 'credit', label: 'Tax credit (not deducted)' }, { value: 'expense', label: 'Treat as cost' }], p.po.tdsTreatment || 'credit')}</select>` : esc(p.po.tdsTreatment === 'expense' ? 'Treated as cost' : 'Tax credit')}</span></div>` : ''}
    <div class="note">${icon('info')}Projected, recorded cost-based profit — not audited net profit. Taxes, overheads and other accounting adjustments may not be included.${p.calc.profitSource === 'summary' ? ' Figures provided by the secure summary service.' : ''}</div>
    </div></section>`;
}

/* ------------------------------------------------------------- client pay */
function clientCard(p) {
  if (p.clientPay === undefined) return locked('Client Collections', 'hand-coins', 'wide');
  const u = state.profile, cs = p.calc.client, ed = editable('clientPay', p), cp = p.clientPay || {};
  const haveRecv = cs && cs.receivable !== null;
  const received = cs ? cs.received : sumTxns(cp.receipts);
  const fullyCash = cs && cs.status === 'Complete';
  const tone = { Complete: 'green', 'Settled with Deductions': 'teal', 'Closed by Deductions': 'teal', Partial: 'orange', Pending: 'red' }[cs?.status] || 'purple';
  return `<section class="card mod wide"><div class="card-head"><h3><span class="mod-ico tone-teal">${icon('hand-coins')}</span>Client Collections</h3>${cs ? badge(cs.status) : ''}</div>
    <div class="card-body">
      <div class="breakdown">
        <div><div class="l">Original PO value</div><div class="v">${can(u, 'po') ? amt(p.po?.poValue ?? null, 'Not set') : restricted()}</div></div>
        <div><div class="l">Receivable${p.po?.gstMode === 'exclusive' ? ' (incl. GST)' : ''}</div><div class="v">${haveRecv ? amt(cs.receivable) : can(u, 'po') ? '—' : restricted()}</div></div>
        <div><div class="l">Cash received</div><div class="v pos">${amt(received)}</div></div>
        <div><div class="l">LD deducted</div><div class="v">${amt(cs ? cs.ld : 0)}</div></div>
        <div><div class="l">TDS deducted</div><div class="v">${amt(cs ? cs.tds : 0)}</div></div>
        <div><div class="l">Other adjustments</div><div class="v">${amt(cs ? cs.adj : 0)}</div></div>
      </div>
      <div class="grid-2">
        <div><div class="kv total" style="margin-top:0;border-top:0"><span class="k">Adjusted outstanding <span class="calc-tag">auto</span></span><span class="v ${cs?.outstanding < 0 ? 'neg' : ''}">${haveRecv ? amt(cs.outstanding) : '—'}</span></div>
          <div class="small muted">Receivable − cash received − LD − TDS − other approved adjustments</div></div>
        <div><div style="display:flex;justify-content:space-between" class="small"><span class="muted">Cash collected</span><b>${percent(cs?.cashPct ?? null, 1, '—')}</b></div>
          ${progress(cs?.cashPct ?? 0, 'green', 'Cash collection')}
          <div style="display:flex;justify-content:space-between;margin-top:8px" class="small"><span class="muted">Settled incl. deductions</span><b>${percent(cs?.settledPct ?? null, 1, '—')}</b></div>
          ${progress(cs?.settledPct ?? 0, tone, 'Settlement')}</div>
      </div>
      <label class="check" style="margin-top:12px" title="Derived automatically from recorded amounts"><input type="checkbox" disabled ${received > 0 ? 'checked' : ''}> Client payment received ${received > 0 ? (fullyCash ? '— in full (cash)' : cs?.status === 'Settled with Deductions' || cs?.status === 'Closed by Deductions' ? '— balance closed by deductions, not cash' : '— partially') : ''}</label>
      ${p.po?.clientDueDate ? `<div class="small muted" style="margin-top:6px">${icon('calendar-check', '')} Contractual payment due date: <b>${date(p.po.clientDueDate)}</b></div>` : ''}
      ${ed || editable('po', p) ? `<div class="mod-actions">
        ${ed ? `<button class="btn btn-sm btn-navy" data-m="crecv">${icon('plus')}Record receipt</button><button class="btn btn-sm btn-ghost" data-m="cded">${icon('scissors')}Record LD / TDS / adjustment</button>` : ''}
        ${editable('po', p) ? `<button class="btn btn-sm btn-ghost" data-m="recv">${icon('settings-2')}Receivable settings</button>` : ''}</div>` : ''}
      <div class="grid-2">
      <details class="acc" data-acc="cr-${p.id}"><summary>${icon('banknote')}Receipts (${Object.keys(cp.receipts || {}).length})${icon('chevron-down', 'chev')}</summary>
        ${txnTable(p, 'clientPay', 'receipts', cp.receipts, [{ label: 'Date', render: (t) => date(t.date) }, { label: 'Amount', num: true, render: kindAmt }, { label: 'UTR / Ref', render: (t) => `<span class="mono">${esc(t.ref || '—')}</span>` }, { label: 'Remarks', render: (t) => esc(t.remarks || '') }])}</details>
      <details class="acc" data-acc="cd-${p.id}"><summary>${icon('scissors')}Deductions &amp; adjustments (${Object.keys(cp.deductions || {}).length})${icon('chevron-down', 'chev')}</summary>
        ${txnTable(p, 'clientPay', 'deductions', cp.deductions, [{ label: 'Date', render: (t) => date(t.date) }, { label: 'Type', render: (t) => badge({ LD: 'LD', TDS: 'TDS', ADJ: 'Adjustment' }[t.type] || t.type, t.type === 'LD' ? 'red' : t.type === 'TDS' ? 'teal' : 'purple') }, { label: 'Amount', num: true, render: kindAmt }, { label: 'Reference', render: (t) => esc(t.ref || '') }])}</details>
      </div>
    </div></section>`;
}

function detailsCard(p) {
  const b = p.basic, c = p.client;
  const who = (uid) => (uid === state.uid ? 'you' : state.users?.[uid]?.fullName || (uid ? 'a team member' : '—'));
  return `<section class="card mod"><div class="card-head"><h3><span class="mod-ico tone-slate">${icon('building-2')}</span>Client &amp; details</h3></div>
    <div class="card-body">
      <div class="kv"><span class="k">Client</span><span class="v">${esc(b.clientName)}</span></div>
      ${c === undefined ? `<div class="kv"><span class="k">Contact</span><span class="v">${restricted()}</span></div>` : `
      <div class="kv"><span class="k">Contact person</span><span class="v">${esc(c.contactPerson || '—')}</span></div>
      <div class="kv"><span class="k">Email</span><span class="v">${c.email ? `<a href="mailto:${esc(c.email)}" class="link-btn">${esc(c.email)}</a>` : '—'}</span></div>
      <div class="kv"><span class="k">Phone</span><span class="v">${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}" class="link-btn">${esc(c.phone)}</a>` : '—'}</span></div>`}
      <div class="kv"><span class="k">Department</span><span class="v">${esc(b.department)}</span></div>
      ${b.remarks ? `<div style="margin-top:10px" class="small"><b>Remarks</b><p class="muted" style="white-space:pre-wrap;margin-top:2px">${esc(b.remarks)}</p></div>` : ''}
      <div class="meta-line"><span>${icon('clock', '')} Updated ${relTime(b.updatedAt)} by ${esc(who(b.updatedBy))}</span><span>Created ${dateTime(b.createdAt)}</span></div>
    </div></section>`;
}

/* ----------------------------------------------------------------- wiring */
function wire(root, p, app) {
  root.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => projectAction(b.dataset.act, b.dataset.id, app); });
  root.querySelector('[data-act2="print"]')?.addEventListener('click', () => window.print());
  root.querySelector('[data-act2="history"]')?.addEventListener('click', () => openHistory(p.id));
  root.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => MODALS[b.dataset.m](p); });
  root.querySelectorAll('[data-exp]').forEach((b) => { b.onclick = () => openExpenseDrawer(p.id, b.dataset.exp); });
  root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const [dom, list, k] = b.dataset.edit.split('|'); openTxnForm(p, dom, list, k); }; });
  root.querySelectorAll('[data-void]').forEach((b) => { b.onclick = () => { const [dom, list, k] = b.dataset.void.split('|'); doVoid(p, dom, list, k); }; });
  const vf = root.querySelector('[data-vflag]');
  if (vf) vf.onchange = async () => {
    try {
      await updateRecord('vendor', p.id, { completedFlag: vf.checked }, 'vendor.update', [{ label: 'Vendor payment completed flag', prev: String(!vf.checked), next: String(vf.checked) }]);
      if (vf.checked && p.calc.vendor.status !== 'Complete') toast(`Marked completed — but recorded amounts show "${p.calc.vendor.status}".`, 'warn');
    } catch (e) { vf.checked = !vf.checked; toast(errorMessage(e), 'error'); }
  };
  const tds = root.querySelector('[data-tds]');
  if (tds) tds.onchange = async () => {
    try { await updateRecord('po', p.id, { tdsTreatment: tds.value }, 'po.update', [{ label: 'TDS treatment', prev: p.po.tdsTreatment || 'credit', next: tds.value }]); toast('Tax treatment updated.'); } catch (e) { toast(errorMessage(e), 'error'); }
  };
}

/* ------------------------------------------------------------- modals */
const MODALS = {
  quotes: openQuotes,
  vpay: (p) => openTxnForm(p, 'vendor', 'txns'),
  vpayable: openPayable,
  crecv: (p) => openTxnForm(p, 'clientPay', 'receipts'),
  cded: (p) => openTxnForm(p, 'clientPay', 'deductions'),
  recv: openReceivable,
};

function openQuotes(p) {
  const q = p.quotations || {};
  const slot = (k, n) => `<div class="card card-pad" style="padding:14px"><b>L${n} Quotation</b><div class="grid-3" style="margin-top:10px">
    <label class="field"><span>Amount (₹)</span>${moneyInput(`${k}_amount`, q[k]?.amount || null)}</label>
    <label class="field"><span>Vendor (optional)</span><input class="input" name="${k}_vendor" value="${esc(q[k]?.vendor || '')}" maxlength="120"></label>
    <label class="field"><span>Quotation ref (optional)</span><input class="input" name="${k}_ref" value="${esc(q[k]?.ref || '')}" maxlength="80"></label></div></div>`;
  const m = modal({ title: `Vendor quotations · ${p.id}`, size: 'lg', body: `<form id="qf" novalidate style="display:grid;gap:10px">
      ${slot('q1', 1)}${slot('q2', 2)}${slot('q3', 3)}
      <div class="grid-2"><label class="field"><span>Approved purchase value (₹)</span>${moneyInput('approvedValue', q.approvedValue ?? null)}<small class="field-hint">Used for procurement variance. Leave blank to compare against the lowest quote.</small></label>
      <div class="field"><span>Lowest quotation <span class="calc-tag">auto</span></span><div class="input" id="q-low" style="display:flex;align-items:center;font-weight:700"></div></div></div>
    </form>`, footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok>${icon('save')}Save quotations</button>` });
  const form = m.el.querySelector('#qf');
  const recalc = () => {
    const vals = ['q1', 'q2', 'q3'].map((k, i) => ({ k, n: i + 1, a: rupeesToPaise(form[`${k}_amount`].value) })).filter((x) => x.a !== null && x.a > 0);
    const low = vals.sort((a, b) => a.a - b.a)[0];
    m.el.querySelector('#q-low').textContent = low ? `${money(low.a)}  (L${low.n})` : 'Not Available';
  };
  form.oninput = recalc; recalc();
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
    const fd = formData(form); const patch = {}; const changes = []; let ok = true;
    for (const [k, n] of [['q1', 1], ['q2', 2], ['q3', 3]]) {
      const raw = fd[`${k}_amount`]; const a = raw ? rupeesToPaise(raw) : 0;
      if (raw && (a === null || a < 0)) { fieldError(form, `${k}_amount`, 'Enter a valid non-negative amount.'); ok = false; continue; }
      fieldError(form, `${k}_amount`, '');
      const next = { amount: a || 0, vendor: fd[`${k}_vendor`], ref: fd[`${k}_ref`] };
      if (JSON.stringify(next) !== JSON.stringify({ amount: q[k]?.amount || 0, vendor: q[k]?.vendor || '', ref: q[k]?.ref || '' })) {
        patch[k] = next; changes.push({ label: `L${n}`, prev: q[k]?.amount ? money(q[k].amount) : '—', next: a ? `${money(a)}${next.vendor ? ' · ' + next.vendor : ''}` : '—' });
      }
    }
    const ap = fd.approvedValue ? rupeesToPaise(fd.approvedValue) : null;
    if (fd.approvedValue && (ap === null || ap < 0)) { fieldError(form, 'approvedValue', 'Enter a valid amount.'); ok = false; }
    if (!ok) return;
    if ((ap ?? null) !== (q.approvedValue ?? null)) { patch.approvedValue = ap; changes.push({ label: 'Approved value', prev: money(q.approvedValue ?? null), next: money(ap) }); }
    if (!changes.length) { m.close(); return; }
    try { await updateRecord('quotations', p.id, patch, 'quotation.update', changes); toast('Quotations saved. Lowest quotation recalculated.'); m.close(); } catch (ex) { toast(errorMessage(ex), 'error'); }
  });
  icons(m.el);
}

function openPayable(p) {
  const v = p.vendor || {};
  const sug = p.quotations?.approvedValue || p.calc.lowest?.amount || null;
  const m = modal({ title: 'Approved vendor payable', size: 'sm', body: `<form id="pf" novalidate>
    <label class="field"><span>Approved payable amount (₹)</span>${moneyInput('payable', v.approvedPayable ?? null)}
    <small class="field-hint">Payment status compares recorded payments against this amount. Leave blank if not yet confirmed.</small></label>
    ${sug && p.quotations ? `<button type="button" class="link-btn small" id="use-sug" style="margin-top:8px">Use ${p.quotations.approvedValue ? 'approved value' : 'lowest quotation'}: ${money(sug)}</button>` : ''}</form>`,
    footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok>Save</button>` });
  const form = m.el.querySelector('#pf');
  m.el.querySelector('#use-sug')?.addEventListener('click', () => { form.payable.value = (sug / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }); });
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
    const raw = form.payable.value; const a = raw ? rupeesToPaise(raw) : null;
    if (raw && (a === null || a <= 0)) { fieldError(form, 'payable', 'Enter a positive amount, or leave blank.'); return; }
    try { await updateRecord('vendor', p.id, { approvedPayable: a }, 'vendor.update', [{ label: 'Approved payable', prev: money(v.approvedPayable ?? null), next: money(a) }]); toast('Approved payable saved.'); m.close(); } catch (ex) { toast(errorMessage(ex), 'error'); }
  });
}

function openReceivable(p) {
  const po = p.po || {};
  const m = modal({ title: 'Receivable settings', size: 'md', body: `<form id="rf" novalidate class="grid-2">
    <label class="field"><span>PO value is</span><select class="input" name="gstMode">${options([{ value: 'inclusive', label: 'Inclusive of GST' }, { value: 'exclusive', label: 'Exclusive of GST' }], po.gstMode || 'inclusive')}</select></label>
    <label class="field"><span>GST rate (%)</span><input class="input" name="gst" inputmode="decimal" value="${((po.gstPercentBp ?? 1800) / 100).toString()}"></label>
    <label class="field"><span>Receivable adjustment (₹)</span>${moneyInput('adj', po.receivableAdjust ?? null)}<small class="field-hint">Approved change to the amount receivable (may be negative, e.g. scope reduction).</small></label>
    <label class="field"><span>Contractual client payment due date</span><input class="input" type="date" name="due" value="${esc(po.clientDueDate || '')}"><small class="field-hint">Receivables are flagged overdue only against this date.</small></label>
    <div class="span-2 info-box">${icon('info')}<div>Use <b>Record LD / TDS / adjustment</b> for credit notes and other approved financial adjustments against collections.</div></div></form>`,
    footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok>Save</button>` });
  const form = m.el.querySelector('#rf');
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
    const fd = formData(form);
    const g = Number(fd.gst); const adj = fd.adj ? rupeesToPaise(fd.adj) : null;
    if (!Number.isFinite(g) || g < 0 || g > 40) { fieldError(form, 'gst', 'GST must be 0–40%.'); return; }
    if (fd.adj && adj === null) { fieldError(form, 'adj', 'Enter a valid amount.'); return; }
    const patch = { gstMode: fd.gstMode, gstPercentBp: Math.round(g * 100), receivableAdjust: adj, clientDueDate: fd.due };
    try { await updateRecord('po', p.id, patch, 'po.update', [{ label: 'Receivable settings', prev: `${po.gstMode || 'inclusive'} ${(po.gstPercentBp ?? 1800) / 100}% adj ${money(po.receivableAdjust ?? null)} due ${po.clientDueDate || '—'}`, next: `${fd.gstMode} ${g}% adj ${money(adj)} due ${fd.due || '—'}` }]); toast('Receivable settings saved.'); m.close(); } catch (ex) { toast(errorMessage(ex), 'error'); }
  });
}

/** Generic add/edit transaction form. */
function openTxnForm(p, dom, list, editKey = null) {
  const recs = { vendor: p.vendor, clientPay: p.clientPay, ...(p.expenses || {}) };
  const existing = editKey ? recs[dom]?.[list]?.[editKey] : null;
  const isVendor = dom === 'vendor', isDed = list === 'deductions', isRecv = list === 'receipts', isExp = EXPENSE_DOMAINS.includes(dom);
  const title = (editKey ? 'Edit ' : 'Record ') + (isVendor ? 'vendor payment' : isDed ? 'deduction / adjustment' : isRecv ? 'client receipt' : EXP_META[dom].label.toLowerCase());
  const defVendor = existing?.vendor ?? (p.quotations?.[p.calc.lowest?.slot]?.vendor || Object.values(p.vendor?.txns || {})[0]?.vendor || '');
  const kinds = isDed ? [{ value: 'deduction', label: 'Deduction' }, { value: 'reversal', label: 'Reversal (reduces deductions)' }]
    : [{ value: isVendor ? 'payment' : isRecv ? 'receipt' : 'expense', label: isVendor ? 'Payment' : isRecv ? 'Receipt' : 'Expense' }, { value: 'refund', label: 'Refund / correction (subtracts)' }];
  const m = modal({ title, size: 'md', body: `<form id="tf" novalidate class="grid-2">
      ${isDed ? `<label class="field"><span>Type <b class="req">*</b></span><select class="input" name="type">${options([{ value: 'LD', label: 'LD – Liquidated damages' }, { value: 'TDS', label: 'TDS – Tax deducted at source' }, { value: 'ADJ', label: 'Credit note / approved adjustment' }], existing?.type || 'TDS')}</select></label>` : ''}
      ${isVendor ? `<label class="field"><span>Vendor name <b class="req">*</b></span><input class="input" name="vendor" value="${esc(defVendor)}" maxlength="120"></label>` : ''}
      <label class="field"><span>Amount (₹) <b class="req">*</b></span>${moneyInput('amount', existing?.amount ?? null)}</label>
      <label class="field"><span>${isExp ? 'Expense' : 'Payment'} date <b class="req">*</b></span><input class="input" type="date" name="date" value="${esc(existing?.date || todayIST())}"></label>
      <label class="field"><span>Entry type</span><select class="input" name="kind">${options(kinds, existing?.kind || kinds[0].value)}</select></label>
      ${isExp ? `<label class="field span-2"><span>Description <b class="req">*</b></span><input class="input" name="desc" value="${esc(existing?.desc || '')}" maxlength="200"></label>` : ''}
      <label class="field"><span>${isExp ? 'Supporting reference (invoice / bill no.)' : isDed ? 'Reference (clause / certificate)' : 'Payment reference / UTR'}</span><input class="input" name="ref" value="${esc(existing?.ref || '')}" maxlength="80"></label>
      ${!isExp ? `<label class="field ${isDed ? '' : 'span-2'}"><span>Remarks</span><input class="input" name="remarks" value="${esc(existing?.remarks || '')}" maxlength="300"></label>` : ''}
    </form>`, footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok>${icon('save')}${editKey ? 'Save changes' : 'Save'}</button>` });
  const form = m.el.querySelector('#tf');
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
    const fd = formData(form); let ok = true;
    const err = (n, msg) => { fieldError(form, n, msg); if (msg) ok = false; };
    const a = rupeesToPaise(fd.amount);
    err('amount', a === null ? 'Enter a valid amount.' : a <= 0 ? 'Amount must be greater than zero. Use "Refund / correction" to subtract.' : '');
    err('date', !fd.date ? 'Date is required.' : daysBetween(todayIST(), fd.date) > 31 ? 'Date is more than a month in the future.' : '');
    if (isVendor) err('vendor', fd.vendor ? '' : 'Vendor name is required.');
    if (isExp) err('desc', fd.desc ? '' : 'Description is required.');
    if (!ok) return;
    const txn = { amount: a, date: fd.date, kind: fd.kind, ref: fd.ref || '' };
    if (isVendor) txn.vendor = fd.vendor;
    if (isExp) txn.desc = fd.desc; else txn.remarks = fd.remarks || '';
    if (isDed) txn.type = fd.type;
    const action = isVendor ? 'vendor.payment' : isDed ? 'client.deduction' : isRecv ? 'client.payment' : 'expense.add';
    const label = `${isDed ? txn.type + ' ' : isExp ? EXP_META[dom].label + ': ' : ''}${fd.kind === 'refund' || fd.kind === 'reversal' ? '−' : ''}${money(a)} on ${fd.date}${txn.ref ? ' · ' + txn.ref : ''}`;
    // Duplicate guard: same amount + date + reference already recorded
    const dup = Object.entries(recs[dom]?.[list] || {}).find(([k, t]) => k !== editKey && !t.void && t.amount === a && t.date === fd.date && (t.ref || '') === (txn.ref || ''));
    if (dup && !(await confirmDialog({ title: 'Possible duplicate', message: `An entry of ${money(a)} on ${date(fd.date)} with the same reference already exists. Record it again?`, confirmText: 'Record anyway' }))) return;
    try {
      if (editKey) await editTxn(dom, p.id, list, editKey, txn, action.replace(/\.(add|payment|deduction)$/, '.edit'), `${money(existing.amount)} on ${existing.date}`, label);
      else await addTxn(dom, p.id, list, txn, action, label);
      toast(editKey ? 'Entry updated.' : 'Entry recorded. Totals recalculated.'); m.close();
    } catch (ex) { toast(errorMessage(ex), 'error'); }
  });
  icons(m.el);
}

async function doVoid(p, dom, list, key) {
  const recs = { vendor: p.vendor, clientPay: p.clientPay, ...(p.expenses || {}) };
  const t = recs[dom]?.[list]?.[key]; if (!t) return;
  const reason = await confirmDialog({ title: 'Void this entry?', message: `${money(t.amount)} on ${date(t.date)} will be excluded from totals. The entry is kept (struck through) for the audit trail.`, confirmText: 'Void entry', danger: true, reason: true });
  if (!reason) return;
  const action = dom === 'vendor' ? 'vendor.void' : dom === 'clientPay' ? 'client.void' : 'expense.void';
  try { await voidTxn(dom, p.id, list, key, reason, action, `${money(t.amount)} on ${t.date}`); toast('Entry voided.'); } catch (e) { toast(errorMessage(e), 'error'); }
}

/** Expense category drawer: list + add (live). */
function openExpenseDrawer(pid, cat) {
  const meta = EXP_META[cat];
  const d = drawer({ title: `${meta.label} · ${pid}`, size: 'lg', body: '<div id="xd"></div>' });
  const host = d.el.querySelector('#xd');
  const render = () => {
    const p = project(pid); if (!p) return;
    const rec = p.expenses?.[cat] || {};
    const total = sumTxns(rec.txns);
    host.innerHTML = `<div class="breakdown" style="grid-template-columns:repeat(2,1fr)"><div><div class="l">Category total</div><div class="v">${amt(total)}</div></div><div><div class="l">Entries</div><div class="v">${Object.values(rec.txns || {}).filter((t) => !t.void).length}</div></div></div>
      ${editable(cat, p) ? `<button class="btn btn-navy btn-sm" id="x-add" style="margin-bottom:12px">${icon('plus')}Add ${meta.label.toLowerCase()} entry</button>` : `<div class="info-box" style="margin-bottom:12px">${icon('eye')}View only — you cannot edit this category.</div>`}
      ${txnTable(p, cat, 'txns', rec.txns, [{ label: 'Date', render: (t) => date(t.date) }, { label: 'Description', render: (t) => esc(t.desc || '') }, { label: 'Amount', num: true, render: kindAmt }, { label: 'Reference', render: (t) => `<span class="mono">${esc(t.ref || '—')}</span>` }])}`;
    host.querySelector('#x-add')?.addEventListener('click', () => openTxnForm(p, cat, 'txns'));
    host.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const [, , k] = b.dataset.edit.split('|'); openTxnForm(p, cat, 'txns', k); }; });
    host.querySelectorAll('[data-void]').forEach((b) => { b.onclick = () => { const [, , k] = b.dataset.void.split('|'); doVoid(p, cat, 'txns', k); }; });
    icons(host);
  };
  render();
  import('../store.js').then(({ onChange }) => { const off = onChange(() => { if (d.el.isConnected) render(); else off(); }); });
}

/** Audit history for one project (admins / audit viewers). */
function openHistory(pid) {
  const d = drawer({ title: `Change history · ${pid}`, size: 'lg', body: '<div id="hist"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>' });
  const off = backend.onValue('activityLogs', (v) => {
    const list = Object.values(v || {}).sort((a, b) => b.ts - a.ts);
    const host = d.el.querySelector('#hist'); if (!host) { off(); return; }
    host.innerHTML = list.length ? `<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Field</th><th>Previous</th><th>New</th></tr></thead><tbody>
      ${list.map((l) => `<tr><td data-l="When">${dateTime(l.ts)}</td><td data-l="User">@${esc(l.username)}</td><td data-l="Action">${esc(actionLabel(l.action))}</td><td data-l="Field">${esc(l.field || '')}</td><td data-l="Previous" class="muted">${esc(l.prev || '')}</td><td data-l="New">${esc(l.next || '')}</td></tr>`).join('')}</tbody></table></div>`
      : empty('No history yet', '', 'history');
    icons(host);
  }, (e) => { d.el.querySelector('#hist').innerHTML = restricted('You cannot view the audit log'); }, { orderBy: 'projectId', equalTo: pid });
  const close = d.close; d.close = () => { off(); close(); };
}

/* ------------------------------------------------------------- attachments */
function mountFiles(host, pid, offs) {
  const canUp = can(state.profile, 'files', 'edit');
  if (!backend.storageAvailable) {
    host.innerHTML = `<p class="muted small">${icon('cloud-off')} Attachments use secured Firebase Storage. They are enabled once Firebase and the Cloud Functions (which issue file-access claims) are deployed — see README.</p>`;
    return;
  }
  host.innerHTML = `<div id="f-list"></div>${canUp ? `<label class="btn btn-sm btn-ghost" style="margin-top:10px">${icon('upload')}Upload file<input type="file" id="f-in" hidden accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.doc,.csv,.txt"></label><small class="field-hint" style="display:block;margin-top:6px">Max 10 MB · PDF, images, Office, CSV</small>` : ''}`;
  offs.push(backend.onValue(`attachments/${pid}`, (v) => {
    const list = Object.entries(v || {}).sort(([, a], [, b]) => b.ts - a.ts);
    const l = host.querySelector('#f-list');
    l.innerHTML = list.length ? list.map(([k, f]) => `<div class="list-item"><div class="feed-ico">${icon('file')}</div><div class="li-main"><div class="li-title">${esc(f.name)}</div><div class="li-sub">${(f.size / 1024).toFixed(0)} KB · ${esc(f.by)} · ${relTime(f.ts)}</div></div><button class="btn btn-sm btn-ghost" data-dl="${esc(f.path)}">${icon('download')}</button></div>`).join('') : '<p class="muted small">No attachments.</p>';
    l.querySelectorAll('[data-dl]').forEach((b) => { b.onclick = async () => { try { window.open(await backend.downloadUrl(b.dataset.dl), '_blank', 'noopener'); } catch (e) { toast(errorMessage(e), 'error'); } }; });
    icons(l);
  }, () => {}));
  const inp = host.querySelector('#f-in');
  if (inp) inp.onchange = async () => {
    const file = inp.files[0]; inp.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('File is larger than 10 MB.', 'error'); return; }
    const key = backend.pushKey('attachments');
    const path = `projects/${pid}/${key}-${file.name.replace(/[^\w.-]+/g, '_')}`;
    try {
      toast('Uploading…', 'info', 1500);
      await backend.upload(path, file);
      await commit({ [`attachments/${pid}/${key}`]: { name: file.name, size: file.size, type: file.type, path, uid: state.uid, by: state.profile.fullName, ts: backend.serverTime() } }, [{ action: 'attachment.add', projectId: pid, next: file.name }]);
      toast('File uploaded.');
    } catch (e) { toast(errorMessage(e), 'error'); }
  };
}

export { DOMAIN, openTxnForm, openPayable, openExpenseDrawer };
