/**
 * Reports & Exports (PDF / Excel / CSV).
 * Every column declares the access domains it needs; columns the user cannot
 * view are removed before preview AND export, so exports can never contain
 * restricted fields.
 */
import { state, projects, loadedBasic } from '../store.js';
import { can, canSeeAllExpenses } from '../permissions.js';
import { sumTxns, deductionTotals } from '../calc.js';
import { esc, money, percent, date, dateTime, daysLabel } from '../format.js';
import { icon, icons, toast, empty, busy, options } from '../ui.js';
import { filterBar, wireFilters, applyFilters, departmentNames } from './common.js';

const C = (key, label, get, o = {}) => ({ key, label, get, ...o });
const M = { money: true, total: true };
const vendorNames = (p) => [...new Set(Object.values(p.vendor?.txns || {}).map((t) => t.vendor).filter(Boolean))].join(', ');

const BASE = [C('id', 'Project ID', (p) => p.id), C('desc', 'Description', (p) => p.basic.description), C('client', 'Client', (p) => p.basic.clientName), C('dept', 'Department', (p) => p.basic.department)];

export const REPORTS = {
  all: { title: 'All Projects Report', basis: 'poDate', cols: [...BASE, C('status', 'Status', (p) => p.basic.status), C('poDate', 'PO Date', (p) => p.basic.poDate, { date: true }), C('endDate', 'End Date', (p) => p.basic.endDate, { date: true }),
    C('deadline', 'Deadline', (p) => p.calc.deadline.label), C('po', 'PO Value', (p) => p.po?.poValue ?? null, { ...M, need: ['po'] }),
    C('exp', 'Total Expenses', (p) => p.calc.expenses?.total ?? null, { ...M, needFn: canSeeAllExpenses }), C('profit', 'Projected Profit', (p) => p.calc.profit?.projectedProfit ?? null, { ...M, need: ['profit'] }),
    C('margin', 'Margin %', (p) => p.calc.profit?.margin ?? null, { pct: true, need: ['profit'] }), C('vstatus', 'Vendor Payment', (p) => p.calc.vendor?.status, { need: ['vendor'] }),
    C('cstatus', 'Client Collection', (p) => p.calc.client?.status, { need: ['clientPay', 'po'] })] },
  dept: { title: 'Department-wise Projects', basis: 'poDate', grouped: true, cols: [C('dept', 'Department', (g) => g.dept), C('count', 'Projects', (g) => g.list.length, { total: true }),
    C('active', 'Active', (g) => g.list.filter((p) => !['Completed', 'Cancelled'].includes(p.basic.status)).length, { total: true }), C('completed', 'Completed', (g) => g.list.filter((p) => p.basic.status === 'Completed').length, { total: true }),
    C('critical', 'At Risk', (g) => g.list.filter((p) => ['critical', 'today', 'overdue'].includes(p.calc.deadline.key)).length, { total: true }),
    C('po', 'PO Value', (g) => g.list.reduce((s, p) => s + (p.po?.poValue || 0), 0), { ...M, need: ['po'] }), C('exp', 'Expenses', (g) => g.list.reduce((s, p) => s + (p.calc.expenses?.total || 0), 0), { ...M, needFn: canSeeAllExpenses }),
    C('profit', 'Projected Profit', (g) => g.list.reduce((s, p) => s + (p.calc.profit?.projectedProfit || 0), 0), { ...M, need: ['profit'] }),
    C('received', 'Cash Received', (g) => g.list.reduce((s, p) => s + sumTxns(p.clientPay?.receipts), 0), { ...M, need: ['clientPay'] })] },
  critical: { title: 'Critical Projects', basis: 'endDate', filter: (p) => ['critical', 'today', 'overdue'].includes(p.calc.deadline.key), sort: (a, b) => a.calc.deadline.days - b.calc.deadline.days,
    cols: [...BASE, C('endDate', 'Deadline', (p) => p.basic.endDate, { date: true }), C('days', 'Days Remaining', (p) => p.calc.deadline.days), C('risk', 'Risk', (p) => p.calc.deadline.label), C('status', 'Status', (p) => p.basic.status)] },
  procurement: { title: 'Procurement Comparison', basis: 'poDate', cols: [C('id', 'Project ID', (p) => p.id), C('desc', 'Description', (p) => p.basic.description),
    ...[1, 2, 3].flatMap((n) => [C(`l${n}`, `L${n}`, (p) => (p.quotations?.[`q${n}`]?.amount > 0 ? p.quotations[`q${n}`].amount : null), { money: true, need: ['quotations'] }), C(`v${n}`, `L${n} Vendor`, (p) => p.quotations?.[`q${n}`]?.vendor || '', { need: ['quotations'] })]),
    C('low', 'Lowest Quotation', (p) => p.calc.lowest?.amount ?? null, { ...M, need: ['quotations'] }), C('appr', 'Approved Value', (p) => p.quotations?.approvedValue ?? null, { ...M, need: ['quotations'] }),
    C('purchase', 'Actual Purchase', (p) => (p.expenses?.purchase ? sumTxns(p.expenses.purchase.txns) : null), { ...M, need: ['purchase'] }),
    C('var', 'Variance', (p) => p.calc.procurement?.variance ?? null, { ...M, need: ['quotations', 'purchase'] })] },
  vendor: { title: 'Vendor Payment Report', basis: 'poDate', cols: [...BASE.slice(0, 2), C('vendors', 'Vendors', vendorNames, { need: ['vendor'] }), C('payable', 'Approved Payable', (p) => p.calc.vendor?.payable ?? null, { ...M, need: ['vendor'] }),
    C('paid', 'Paid', (p) => p.calc.vendor?.paid ?? null, { ...M, need: ['vendor'] }), C('out', 'Outstanding', (p) => p.calc.vendor?.outstanding ?? null, { ...M, need: ['vendor'] }), C('vs', 'Status', (p) => p.calc.vendor?.status, { need: ['vendor'] })] },
  expense: { title: 'Expense Report', basis: 'poDate', cols: [...BASE.slice(0, 2), C('dept', 'Department', (p) => p.basic.department),
    ...['purchase', 'transport', 'pilot', 'other'].map((c) => C(c, { purchase: 'Actual Purchase', transport: 'Transport', pilot: 'Pilot', other: 'Other' }[c], (p) => (p.expenses?.[c] ? sumTxns(p.expenses[c].txns) : null), { ...M, need: [c] })),
    C('total', 'Total Expenses', (p) => p.calc.expenses?.total ?? null, { ...M, needFn: canSeeAllExpenses })] },
  client: { title: 'Client Collection Report', basis: 'poDate', cols: [...BASE.slice(0, 3), C('recv', 'Receivable', (p) => p.calc.client?.receivable ?? null, { ...M, need: ['po', 'clientPay'] }),
    C('cash', 'Cash Received', (p) => sumTxns(p.clientPay?.receipts), { ...M, need: ['clientPay'] }), C('ld', 'LD', (p) => deductionTotals(p.clientPay?.deductions).LD, { ...M, need: ['clientPay'] }),
    C('tds', 'TDS', (p) => deductionTotals(p.clientPay?.deductions).TDS, { ...M, need: ['clientPay'] }), C('adj', 'Other Adjustments', (p) => deductionTotals(p.clientPay?.deductions).ADJ, { ...M, need: ['clientPay'] }),
    C('out', 'Adjusted Outstanding', (p) => p.calc.client?.outstanding ?? null, { ...M, need: ['po', 'clientPay'] }), C('cs', 'Status', (p) => p.calc.client?.status, { need: ['po', 'clientPay'] }),
    C('due', 'Contractual Due Date', (p) => p.po?.clientDueDate || '', { date: true, need: ['po'] })] },
  profit: { title: 'Profitability Report', basis: 'poDate', filter: (p) => !!p.calc.profit, cols: [...BASE.slice(0, 2), C('dept', 'Department', (p) => p.basic.department), C('po', 'PO Value', (p) => p.po?.poValue ?? null, { ...M, need: ['po'] }),
    C('exp', 'Total Expenses', (p) => p.calc.expenses?.total ?? null, { ...M, needFn: canSeeAllExpenses }), C('profit', 'Projected Profit', (p) => p.calc.profit?.projectedProfit ?? null, { ...M, need: ['profit'] }),
    C('adj', 'Adjusted Profit', (p) => p.calc.profit?.adjustedProfit ?? null, { ...M, need: ['profit'] }), C('margin', 'Margin %', (p) => p.calc.profit?.margin ?? null, { pct: true, need: ['profit'] })] },
  completion: { title: 'Project Completion Report', basis: 'endDate', cols: [...BASE, C('status', 'Status', (p) => p.basic.status), C('poDate', 'PO Date', (p) => p.basic.poDate, { date: true }), C('endDate', 'End Date', (p) => p.basic.endDate, { date: true }),
    C('days', 'Days vs Deadline', (p) => (p.calc.deadline.key === 'closed' ? '' : daysLabel(p.calc.deadline.days))), C('updated', 'Last Updated', (p) => (p.basic.updatedAt ? dateTime(p.basic.updatedAt) : ''))] },
};

const allowedCols = (rep) => rep.cols.filter((c) => (!c.need || c.need.every((d) => can(state.profile, d))) && (!c.needFn || c.needFn(state.profile)));

export function buildReport(key, f) {
  const rep = REPORTS[key];
  const cols = allowedCols(rep);
  let list = applyFilters(projects(), f, rep.basis);
  if (rep.filter) list = list.filter(rep.filter);
  list.sort(rep.sort || ((a, b) => a.id.localeCompare(b.id)));
  let rows;
  if (rep.grouped) {
    rows = departmentNames().map((d) => ({ dept: d, list: list.filter((p) => p.basic.department === d) })).filter((g) => g.list.length).map((g) => cols.map((c) => c.get(g)));
  } else rows = list.map((p) => cols.map((c) => c.get(p)));
  const totals = cols.map((c, i) => (c.total ? rows.reduce((s, r) => s + (typeof r[i] === 'number' ? r[i] : 0), 0) : null));
  return { rep, cols, rows, totals, count: list.length };
}

const cellText = (c, v) => (v === null || v === undefined || v === '' ? '' : c.money ? money(v) : c.pct ? percent(v) : c.date ? date(v) : String(v));
const cellPlain = (c, v) => (v === null || v === undefined ? '' : c.money ? (v / 100).toFixed(2) : c.pct ? v.toFixed(2) : String(v));
const safeCsv = (s) => { let t = String(s); if (/^[=+\-@\t\r]/.test(t) && isNaN(Number(t))) t = "'" + t; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

const f = { period: 'all', dept: '', status: '', client: '', type: 'all' };

export function mount(el) {
  el.innerHTML = `<div class="page-head"><div><h1>Reports &amp; Exports</h1><div class="sub">Exports include only the fields you are authorised to view.</div></div>
    <div class="page-actions"><button class="btn btn-ghost" data-x="csv">${icon('file-text')}CSV</button><button class="btn btn-ghost" data-x="xlsx">${icon('sheet')}Excel</button><button class="btn btn-navy" data-x="pdf">${icon('file-down')}PDF</button></div></div>
    <div class="filters"><select class="input" id="rtype" aria-label="Report type" style="min-width:260px">${options(Object.entries(REPORTS).map(([k, r]) => ({ value: k, label: r.title })), f.type)}</select></div>
    <div id="rf"></div><section class="card"><div class="card-head"><h3 id="rtitle"></h3><span class="card-sub" id="rmeta"></span></div><div class="card-body" id="rbody"></div></section>`;
  el.querySelector('#rtype').onchange = (e) => { f.type = e.target.value; renderF(); update(); };
  const renderF = () => { const h = el.querySelector('#rf'); h.innerHTML = filterBar(f, { basis: REPORTS[f.type].basis === 'endDate' ? 'Project End Date' : 'PO Date' }); wireFilters(h, f, () => { renderF(); update(); }); icons(h); };
  el.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => busy(b, () => doExport(b.dataset.x)); });

  function update() {
    if (!loadedBasic()) return;
    const R = buildReport(f.type, f);
    el.querySelector('#rtitle').innerHTML = `${icon('file-bar-chart')}${esc(R.rep.title)}`;
    el.querySelector('#rmeta').textContent = `${R.rows.length} row${R.rows.length === 1 ? '' : 's'} · ${R.cols.length} permitted column${R.cols.length === 1 ? '' : 's'}`;
    const hidden = R.rep.cols.length - R.cols.length;
    el.querySelector('#rbody').innerHTML = (hidden ? `<div class="info-box" style="margin-bottom:12px">${icon('lock')}${hidden} column${hidden > 1 ? 's are' : ' is'} hidden because you do not have permission to view ${hidden > 1 ? 'them' : 'it'}. They are excluded from all exports.</div>` : '')
      + (R.rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>${R.cols.map((c) => `<th class="${c.money || c.pct ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${R.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${R.cols[i].money || R.cols[i].pct ? 'num' : ''} ${typeof v === 'number' && v < 0 && R.cols[i].money ? 'neg' : ''}">${R.cols[i].key === 'id' ? `<a class="pid" href="#/project/${encodeURIComponent(v)}">${esc(v)}</a>` : esc(cellText(R.cols[i], v))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${R.totals.some((t) => t !== null) ? `<tfoot><tr>${R.totals.map((t, i) => `<td class="${R.cols[i].money ? 'num' : ''}">${i === 0 ? 'Total' : t === null ? '' : esc(cellText(R.cols[i], t))}</td>`).join('')}</tr></tfoot>` : ''}</table></div>` : empty('No rows', 'Nothing matches the selected filters.', 'file-search'));
    icons(el);
  }

  function filterText() {
    const parts = [];
    if (f.period !== 'all') parts.push(`Period: ${f.period === 'custom' ? `${f.from || '…'} to ${f.to || '…'}` : f.period} (${REPORTS[f.type].basis === 'endDate' ? 'end date' : 'PO date'})`);
    if (f.dept) parts.push(`Department: ${f.dept}`); if (f.status) parts.push(`Status: ${f.status}`); if (f.client) parts.push(`Client: ${f.client}`);
    return parts.join(' · ') || 'All projects';
  }

  async function doExport(kind) {
    const R = buildReport(f.type, f);
    if (!R.rows.length) { toast('Nothing to export for these filters.', 'warn'); return; }
    const generated = dateTime(Date.now());
    const fname = `Garuda_${R.rep.title.replace(/\W+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;
    const head = ['Garuda Aerospace Limited', R.rep.title, `Generated: ${generated} IST by ${state.profile.fullName}`, filterText()];
    const totalsRow = R.totals.some((t) => t !== null) ? R.totals.map((t, i) => (i === 0 ? 'TOTAL' : t === null ? '' : cellPlain(R.cols[i], t))) : null;
    if (kind === 'csv') {
      const lines = [...head.map((h) => safeCsv(h)), '', R.cols.map((c) => safeCsv(c.label + (c.money ? ' (INR)' : ''))).join(','),
        ...R.rows.map((r) => r.map((v, i) => safeCsv(cellPlain(R.cols[i], v))).join(',')), ...(totalsRow ? [totalsRow.map(safeCsv).join(',')] : [])];
      download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), fname + '.csv');
    } else if (kind === 'xlsx') {
      try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'XLSX'); } catch { toast('Excel library unavailable offline — exported CSV instead (opens in Excel).', 'warn'); return doExport('csv'); }
      const X = window.XLSX;
      const aoa = [...head.map((h) => [h]), [], R.cols.map((c) => c.label + (c.money ? ' (₹)' : '')),
        ...R.rows.map((r) => r.map((v, i) => (v === null || v === undefined ? '' : R.cols[i].money ? v / 100 : R.cols[i].pct ? Math.round(v * 100) / 100 : v))),
        ...(totalsRow ? [R.totals.map((t, i) => (i === 0 ? 'TOTAL' : t === null ? '' : R.cols[i].money ? t / 100 : t))] : [])];
      const ws = X.utils.aoa_to_sheet(aoa);
      ws['!cols'] = R.cols.map((c) => ({ wch: Math.max(12, c.label.length + 4, c.key === 'desc' ? 40 : 0) }));
      const range = X.utils.decode_range(ws['!ref']);
      for (let r = 5; r <= range.e.r; r++) R.cols.forEach((c, ci) => { const cell = ws[X.utils.encode_cell({ r, c: ci })]; if (cell && c.money && typeof cell.v === 'number') cell.z = '[$₹-4009]#,##,##0.00'; });
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, R.rep.title.slice(0, 31));
      X.writeFile(wb, fname + '.xlsx');
    } else {
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
      } catch { toast('PDF library unavailable offline — opening print dialog instead.', 'warn'); window.print(); return; }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: R.cols.length > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      doc.setFillColor(16, 29, 53); doc.rect(0, 0, W, 64, 'F');
      doc.setFillColor(198, 40, 40); doc.rect(0, 64, W, 3, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('GARUDA AEROSPACE LIMITED', 32, 30);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text('Project Command Center', 32, 47);
      doc.setTextColor(16, 29, 53); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(R.rep.title, 32, 92);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
      doc.text(`Generated ${generated} IST by ${state.profile.fullName}  ·  ${filterText()}`, 32, 106);
      const pdfMoney = (v) => money(v).replace('₹', 'Rs. ').replace('−', '-'); // core PDF fonts lack the ₹ glyph
      const fmt = (c, v) => (v === null || v === undefined || v === '' ? '' : c.money ? pdfMoney(v) : c.pct ? percent(v) : c.date ? date(v) : String(v));
      doc.autoTable({
        startY: 116, head: [R.cols.map((c) => c.label)], body: R.rows.map((r) => r.map((v, i) => fmt(R.cols[i], v))),
        foot: totalsRow ? [R.totals.map((t, i) => (i === 0 ? 'Total' : t === null ? '' : fmt(R.cols[i], t)))] : undefined,
        styles: { fontSize: 7.5, cellPadding: 4, overflow: 'linebreak' }, headStyles: { fillColor: [16, 29, 53] }, footStyles: { fillColor: [238, 241, 246], textColor: [16, 29, 53], fontStyle: 'bold' },
        columnStyles: Object.fromEntries(R.cols.map((c, i) => [i, c.money || c.pct ? { halign: 'right' } : c.key === 'desc' ? { cellWidth: 140 } : {}])),
        didDrawPage: () => { doc.setFontSize(8); doc.setTextColor(140); doc.text(`Garuda Aerospace Limited · Confidential · Page ${doc.internal.getNumberOfPages()}`, 32, doc.internal.pageSize.getHeight() - 16); },
      });
      doc.save(fname + '.pdf');
    }
    toast('Export ready.', 'success', 2200);
  }

  renderF(); update();
  return { update };
}

function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

const loaded = {};
export function loadScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve();
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('load failed')); }; document.head.appendChild(s); });
  return loaded[src];
}
