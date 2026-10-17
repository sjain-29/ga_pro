/**
 * Garuda Project Command Center — pure financial & deadline calculations.
 *
 * MONEY RULE: every amount is an integer number of PAISE (₹1 = 100 paise).
 * No floating point is used for money; percentages are computed only for display.
 * All functions are pure (no DOM / DB access) so they can be unit-tested in Node
 * and reused by Cloud Functions.
 */

export const DEFAULT_SETTINGS = Object.freeze({
  attentionDays: 30,     // > attentionDays  => On Track
  criticalDays: 15,      // 1..criticalDays => Critical, criticalDays+1..attentionDays => Attention
  tolerancePaise: 100,   // ₹1 tolerance when deciding "Complete"
});

/* ------------------------------------------------------------------ helpers */

/** Coerce to a safe integer of paise; anything invalid becomes null. */
export function toPaise(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Parse a user-typed rupee string ("12,50,000.50" / "₹ 4,75,000") to paise. */
export function rupeesToPaise(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₹,\s]/g, '').trim();
  if (s === '' || s === '-' || s === '.') return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const p = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(p)) return null;
  return neg ? -p : p;
}

/** Sum of a transaction map/array. Refund/correction entries subtract. */
export function sumTxns(txns) {
  if (!txns) return 0;
  const list = Array.isArray(txns) ? txns : Object.values(txns);
  let total = 0;
  for (const t of list) {
    if (!t || t.void) continue;
    const a = toPaise(t.amount);
    if (a === null) continue;
    total += (t.kind === 'refund' || t.kind === 'correction-') ? -Math.abs(a) : a;
  }
  return total;
}

const pct = (num, den) => (den > 0 ? (num / den) * 100 : null);

/* ----------------------------------------------------------- quotations */

/**
 * Lowest valid positive quotation among slots q1..q3.
 * Returns { amount, slot } or { amount: null, slot: null } ("Not Available").
 */
export function lowestQuotation(q = {}) {
  let best = null;
  for (const slot of ['q1', 'q2', 'q3']) {
    const a = toPaise(q?.[slot]?.amount);
    if (a === null || a <= 0) continue;
    if (best === null || a < best.amount) best = { amount: a, slot };
  }
  return best || { amount: null, slot: null };
}

/** Procurement variance = actual purchase − reference (approved value, else lowest quote). */
export function procurementVariance(quotations, purchaseTotal) {
  const low = lowestQuotation(quotations).amount;
  const approved = toPaise(quotations?.approvedValue);
  const reference = approved && approved > 0 ? approved : low;
  if (reference === null || purchaseTotal === null || purchaseTotal === undefined) {
    return { reference, variance: null, variancePct: null, basis: approved ? 'approved' : 'lowest' };
  }
  const variance = purchaseTotal - reference; // positive = overspent vs reference
  return { reference, variance, variancePct: pct(variance, reference), basis: approved ? 'approved' : 'lowest' };
}

/* ------------------------------------------------------------- expenses */

export const EXPENSE_CATEGORIES = ['purchase', 'transport', 'pilot', 'other'];

/**
 * @param {object} exp map { purchase, transport, pilot, other } of category records ({txns})
 * Quotations are intentionally NOT included.
 */
export function expenseTotals(exp = {}) {
  const out = {};
  let total = 0;
  for (const c of EXPENSE_CATEGORIES) {
    out[c] = sumTxns(exp?.[c]?.txns);
    total += out[c];
  }
  out.total = total;
  return out;
}

/* ---------------------------------------------------------- profitability */

/**
 * @param poValue paise
 * @param totalExpenses paise
 * @param ld paise (LD deductions)
 * @param tds paise
 * @param treatment { tdsAsExpense?: boolean }
 */
export function profitability(poValue, totalExpenses, ld = 0, tds = 0, treatment = {}) {
  const po = toPaise(poValue) ?? 0;
  const exp = toPaise(totalExpenses) ?? 0;
  const projectedProfit = po - exp;
  const extraTds = treatment.tdsAsExpense ? (toPaise(tds) ?? 0) : 0;
  const adjustedProfit = po - exp - (toPaise(ld) ?? 0) - extraTds;
  const margin = po > 0 ? (projectedProfit / po) * 100 : null;
  const adjustedMargin = po > 0 ? (adjustedProfit / po) * 100 : null;
  let indicator = 'neutral';
  if (po > 0 || exp > 0) indicator = projectedProfit > 0 ? 'positive' : projectedProfit < 0 ? 'negative' : 'neutral';
  return {
    poValue: po,
    totalExpenses: exp,
    projectedProfit,
    adjustedProfit,
    margin,           // number (%) or null => "N/A"
    adjustedMargin,
    costOverrun: exp > po && po >= 0 && exp > 0,
    indicator,
  };
}

/* -------------------------------------------------------- vendor payments */

/**
 * Vendor payment status is derived from amounts. The "completed" checkbox is a
 * confirmation flag only: it never overrides the transaction totals.
 */
export function vendorStatus(vendor = {}, settings = DEFAULT_SETTINGS) {
  const tol = settings.tolerancePaise ?? DEFAULT_SETTINGS.tolerancePaise;
  const payable = toPaise(vendor?.approvedPayable);
  const paid = sumTxns(vendor?.txns);
  const flagged = vendor?.completedFlag === true;
  const confirmed = payable !== null && payable > 0;
  let status;
  if (!confirmed) status = 'Amount Not Confirmed';
  else if (paid <= 0) status = 'Pending';
  else if (paid > payable + tol) status = 'Overpaid';
  else if (paid >= payable - tol) status = 'Complete';
  else status = 'Partial';
  const outstanding = confirmed ? payable - paid : null;
  return {
    payable: confirmed ? payable : null,
    paid,
    outstanding,
    progress: confirmed ? Math.max(0, Math.min(100, (paid / payable) * 100)) : null,
    status,
    flagged,
    flagMismatch: flagged && status !== 'Complete',
  };
}

/* -------------------------------------------------------- client payments */

/**
 * Receivable amount for the client.
 * gstMode 'exclusive' with gstPercentBp (basis points, 1800 = 18%) adds GST.
 * receivableAdjust (paise, may be negative) applies manual approved changes.
 */
export function clientReceivable(po = {}) {
  const base = toPaise(po?.poValue);
  if (base === null) return null;
  let gst = 0;
  const bp = toPaise(po?.gstPercentBp) ?? 0;
  if (po?.gstMode === 'exclusive' && bp > 0) gst = Math.round((base * bp) / 10000);
  return base + gst + (toPaise(po?.receivableAdjust) ?? 0);
}

export function deductionTotals(deductions) {
  const out = { LD: 0, TDS: 0, ADJ: 0 };
  if (!deductions) return out;
  for (const d of Object.values(deductions)) {
    if (!d || d.void) continue;
    const a = toPaise(d.amount);
    if (a === null) continue;
    const type = out[d.type] !== undefined ? d.type : 'ADJ';
    out[type] += d.kind === 'reversal' ? -Math.abs(a) : a;
  }
  return out;
}

/**
 * Client Adjusted Outstanding = Receivable − Cash Received − LD − TDS − Other Approved Adjustments.
 * Statuses: Not Configured | Pending | Partial | Complete | Settled with Deductions |
 *           Closed by Deductions | Excess / Reconciliation Required
 */
export function clientStatus(po = {}, clientPay = {}, settings = DEFAULT_SETTINGS) {
  const tol = settings.tolerancePaise ?? DEFAULT_SETTINGS.tolerancePaise;
  const receivable = clientReceivable(po);
  const received = sumTxns(clientPay?.receipts);
  const d = deductionTotals(clientPay?.deductions);
  const deductions = d.LD + d.TDS + d.ADJ;
  if (receivable === null || receivable <= 0) {
    return { receivable: null, received, ld: d.LD, tds: d.TDS, adj: d.ADJ, deductions, outstanding: null,
      cashPct: null, settledPct: null, status: 'Not Configured' };
  }
  const outstanding = receivable - received - deductions;
  let status;
  if (outstanding < -tol) status = 'Excess / Reconciliation Required';
  else if (outstanding <= tol) {
    if (deductions <= 0) status = 'Complete';
    else if (received <= 0) status = 'Closed by Deductions';
    else status = 'Settled with Deductions';
  } else status = received > 0 ? 'Partial' : 'Pending';
  return {
    receivable, received, ld: d.LD, tds: d.TDS, adj: d.ADJ, deductions, outstanding,
    cashPct: pct(received, receivable),
    settledPct: Math.max(0, Math.min(100, pct(received + deductions, receivable))),
    status,
  };
}

/** Client payment is overdue only when a contractual due date exists. */
export function receivableOverdue(po = {}, cs, todayISO) {
  if (!po?.clientDueDate || !cs || cs.outstanding === null) return false;
  return cs.outstanding > 0 && po.clientDueDate < todayISO;
}

/* --------------------------------------------------------------- deadlines */

/** Today's date (YYYY-MM-DD) in Asia/Kolkata. */
export function todayIST(now = new Date()) {
  // en-CA gives ISO-like YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function daysBetween(fromISO, toISO) {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * Deadline risk is tracked separately from execution status.
 * Completed / Cancelled projects are "Closed" and never counted as overdue.
 */
export function deadlineStatus(project = {}, settings = DEFAULT_SETTINGS, todayISO = todayIST()) {
  const attention = Number(settings.attentionDays ?? DEFAULT_SETTINGS.attentionDays);
  const critical = Number(settings.criticalDays ?? DEFAULT_SETTINGS.criticalDays);
  if (project.status === 'Completed' || project.status === 'Cancelled') {
    return { key: 'closed', label: project.status === 'Completed' ? 'Completed' : 'Cancelled', tone: 'muted', days: null };
  }
  if (!project.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(project.endDate)) {
    return { key: 'nodate', label: 'No End Date', tone: 'muted', days: null };
  }
  const days = daysBetween(todayISO, project.endDate);
  if (days < 0) return { key: 'overdue', label: 'Overdue', tone: 'red', days };
  if (days === 0) return { key: 'today', label: 'Due Today', tone: 'red', days };
  if (days <= critical) return { key: 'critical', label: 'Critical', tone: 'orange', days };
  if (days <= attention) return { key: 'attention', label: 'Attention', tone: 'yellow', days };
  return { key: 'ontrack', label: 'On Track', tone: 'green', days };
}

/* --------------------------------------------------------- financial year */

/** Indian financial year (Apr 1 – Mar 31) containing the date. */
export function financialYear(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  const start = m >= 4 ? y : y - 1;
  return { start: `${start}-04-01`, end: `${start + 1}-03-31`, label: `FY ${start}-${String(start + 1).slice(2)}` };
}

export function periodRange(period, todayISO = todayIST()) {
  const y = +todayISO.slice(0, 4), m = +todayISO.slice(5, 7);
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (period) {
    case 'today': return { start: todayISO, end: todayISO };
    case 'week': {
      const d = new Date(todayISO + 'T00:00:00Z');
      const dow = (d.getUTCDay() + 6) % 7; // Monday start
      const s = new Date(d.getTime() - dow * 86400000);
      const e = new Date(s.getTime() + 6 * 86400000);
      return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
    }
    case 'month': return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
    case 'quarter': {
      // Indian FY quarters: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar
      const qStartMonth = [1, 4, 7, 10].filter((q) => q <= m).pop();
      const em = qStartMonth + 2;
      return { start: `${y}-${pad(qStartMonth)}-01`, end: `${y}-${pad(em)}-${pad(lastDay(y, em))}` };
    }
    case 'fy': { const f = financialYear(todayISO); return { start: f.start, end: f.end }; }
    default: return null;
  }
}

export function inRange(iso, range) {
  if (!range) return true;
  if (!iso) return false;
  return iso >= range.start && iso <= range.end;
}

/* ----------------------------------------------------------- full rollup */

/**
 * Build a complete computed view of one project from whatever domains the
 * current user can read. Missing domains produce `null` (=> "Restricted").
 */
export function computeProject(p, settings = DEFAULT_SETTINGS, todayISO = todayIST()) {
  const r = { id: p.id, deadline: deadlineStatus(p.basic || {}, settings, todayISO) };
  r.lowest = p.quotations !== undefined ? lowestQuotation(p.quotations || {}) : null;
  r.vendor = p.vendor !== undefined ? vendorStatus(p.vendor || {}, settings) : null;
  const haveAllExp = EXPENSE_CATEGORIES.every((c) => p.expenses?.[c] !== undefined);
  r.expenses = p.expenses ? (() => {
    const t = {};
    for (const c of EXPENSE_CATEGORIES) t[c] = p.expenses[c] !== undefined ? sumTxns(p.expenses[c]?.txns) : null;
    t.total = haveAllExp ? EXPENSE_CATEGORIES.reduce((s, c) => s + t[c], 0) : null;
    return t;
  })() : null;
  r.client = p.po !== undefined && p.clientPay !== undefined ? clientStatus(p.po || {}, p.clientPay || {}, settings) : null;
  if (p.po !== undefined && haveAllExp && p.clientPay !== undefined) {
    const d = deductionTotals(p.clientPay?.deductions);
    r.profit = profitability(p.po?.poValue, r.expenses.total, d.LD, d.TDS, { tdsAsExpense: p.po?.tdsTreatment === 'expense' });
    r.profitSource = 'live';
  } else if (p.summary) {
    r.profit = {
      projectedProfit: p.summary.projectedProfit, adjustedProfit: p.summary.adjustedProfit,
      margin: p.summary.marginBp === null || p.summary.marginBp === undefined ? null : p.summary.marginBp / 100,
      costOverrun: !!p.summary.costOverrun,
      indicator: p.summary.projectedProfit > 0 ? 'positive' : p.summary.projectedProfit < 0 ? 'negative' : 'neutral',
    };
    r.profitSource = 'summary';
  } else r.profit = null;
  if (p.quotations !== undefined && p.expenses?.purchase !== undefined) {
    r.procurement = procurementVariance(p.quotations || {}, sumTxns(p.expenses.purchase?.txns));
  } else r.procurement = null;
  return r;
}

/** Server-side style summary (only profit figures — no PO/expense detail). */
export function buildSummary(poRec, expRecs, clientPayRec) {
  const t = expenseTotals(expRecs);
  const d = deductionTotals(clientPayRec?.deductions);
  const pr = profitability(poRec?.poValue, t.total, d.LD, d.TDS, { tdsAsExpense: poRec?.tdsTreatment === 'expense' });
  return {
    projectedProfit: pr.projectedProfit,
    adjustedProfit: pr.adjustedProfit,
    marginBp: pr.margin === null ? null : Math.max(-1e9, Math.min(1e9, Math.round(pr.margin * 100))),
    costOverrun: pr.costOverrun,
  };
}
