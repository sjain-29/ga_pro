// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';
import { money, percent } from '../js/format.js';

const R = (rupees) => rupees * 100; // rupees → paise
const tx = (...amts) => Object.fromEntries(amts.map((a, i) => [`t${i}`, typeof a === 'object' ? a : { amount: R(a) }]));

test('rupee input parsing to integer paise (no floating point)', () => {
  assert.equal(C.rupeesToPaise('12,50,000.50'), 125000050);
  assert.equal(C.rupeesToPaise('₹ 4,75,000'), 47500000);
  assert.equal(C.rupeesToPaise('0.1'), 10);
  assert.equal(C.rupeesToPaise('0.29'), 29);
  assert.equal(C.rupeesToPaise(''), null);
  assert.equal(C.rupeesToPaise('abc'), null);
  assert.equal(C.rupeesToPaise('1.234'), null);
});

test('Indian currency formatting', () => {
  assert.equal(money(R(1250000)), '₹12,50,000.00');
  assert.equal(money(125000050), '₹12,50,000.50');
  assert.equal(money(-R(340000)), '−₹3,40,000.00');
  assert.equal(money(null), '—');
  assert.equal(percent(null), 'N/A');
});

test('lowest quotation picks the mathematical minimum, not L1', () => {
  const q = { q1: { amount: R(500000) }, q2: { amount: R(475000) }, q3: { amount: R(490000) } };
  assert.deepEqual(C.lowestQuotation(q), { amount: R(475000), slot: 'q2' });
});

test('lowest quotation ignores empty, zero, negative and invalid values', () => {
  assert.deepEqual(C.lowestQuotation({ q1: { amount: 0 }, q2: {}, q3: { amount: R(10) } }), { amount: R(10), slot: 'q3' });
  assert.deepEqual(C.lowestQuotation({ q1: { amount: -5 }, q2: { amount: 'x' } }), { amount: null, slot: null });
  assert.deepEqual(C.lowestQuotation({}), { amount: null, slot: null }); // UI shows "Not Available"
});

test('total expenses = purchase + transport + pilot + other (quotations excluded)', () => {
  const t = C.expenseTotals({
    purchase: { txns: tx(600000) }, transport: { txns: tx(20000, 10000) },
    pilot: { txns: tx(20000) }, other: { txns: tx(10000) },
  });
  assert.equal(t.total, R(660000));
});

test('refunds subtract and voided entries are ignored (no double counting)', () => {
  const t = C.sumTxns({ a: { amount: R(1000) }, b: { amount: R(200), kind: 'refund' }, c: { amount: R(999), void: true } });
  assert.equal(t, R(800));
});

test('spec example: profit ₹3,40,000 and 34% margin', () => {
  const p = C.profitability(R(1000000), R(660000));
  assert.equal(p.projectedProfit, R(340000));
  assert.equal(p.margin, 34);
  assert.equal(p.indicator, 'positive');
});

test('negative profit and N/A margin when PO is zero', () => {
  const p = C.profitability(R(100000), R(150000));
  assert.equal(p.projectedProfit, -R(50000));
  assert.equal(p.margin, -50);
  assert.equal(p.costOverrun, true);
  assert.equal(C.profitability(0, R(10)).margin, null);
});

test('adjusted profit subtracts LD but not TDS by default', () => {
  const p = C.profitability(R(1000000), R(660000), R(20000), R(10000));
  assert.equal(p.adjustedProfit, R(320000));
  const p2 = C.profitability(R(1000000), R(660000), R(20000), R(10000), { tdsAsExpense: true });
  assert.equal(p2.adjustedProfit, R(310000));
});

test('vendor status: Amount Not Confirmed / Pending / Partial / Complete / Overpaid', () => {
  assert.equal(C.vendorStatus({ txns: tx(5000) }).status, 'Amount Not Confirmed');
  assert.equal(C.vendorStatus({ approvedPayable: R(10000) }).status, 'Pending');
  assert.equal(C.vendorStatus({ approvedPayable: R(10000), txns: tx(4000) }).status, 'Partial');
  assert.equal(C.vendorStatus({ approvedPayable: R(10000), txns: tx(4000, 6000) }).status, 'Complete');
  assert.equal(C.vendorStatus({ approvedPayable: R(10000), txns: tx(12000) }).status, 'Overpaid');
  const v = C.vendorStatus({ approvedPayable: R(10000), txns: tx(4000) });
  assert.equal(v.outstanding, R(6000));
  assert.equal(v.progress, 40);
});

test('vendor completed checkbox never overrides real amounts', () => {
  const v = C.vendorStatus({ approvedPayable: R(10000), txns: tx(4000), completedFlag: true });
  assert.equal(v.status, 'Partial');
  assert.equal(v.flagMismatch, true);
  const nc = C.vendorStatus({ completedFlag: true });
  assert.equal(nc.status, 'Amount Not Confirmed');
});

test('client outstanding = receivable − cash − LD − TDS − adjustments', () => {
  const po = { poValue: R(1000000) };
  const cp = { receipts: tx(900000), deductions: { a: { type: 'LD', amount: R(50000) }, b: { type: 'TDS', amount: R(20000) } } };
  const s = C.clientStatus(po, cp);
  assert.equal(s.outstanding, R(30000));
  assert.equal(s.status, 'Partial');
  assert.equal(s.cashPct, 90);
});

test('client status: Pending, Complete, Settled with Deductions, Closed by Deductions, Excess', () => {
  const po = { poValue: R(100000) };
  assert.equal(C.clientStatus(po, {}).status, 'Pending');
  assert.equal(C.clientStatus(po, { receipts: tx(100000) }).status, 'Complete');
  assert.equal(C.clientStatus(po, { receipts: tx(98000), deductions: { a: { type: 'TDS', amount: R(2000) } } }).status, 'Settled with Deductions');
  assert.equal(C.clientStatus(po, { deductions: { a: { type: 'LD', amount: R(100000) } } }).status, 'Closed by Deductions');
  assert.equal(C.clientStatus(po, { receipts: tx(100500) }).status, 'Excess / Reconciliation Required');
  assert.equal(C.clientStatus({}, {}).status, 'Not Configured');
});

test('tolerance: ₹0.50 short still counts as Complete with ₹1 tolerance', () => {
  const s = C.clientStatus({ poValue: R(1000) }, { receipts: { a: { amount: R(1000) - 50 } } });
  assert.equal(s.status, 'Complete');
});

test('GST exclusive receivable and manual adjustment', () => {
  assert.equal(C.clientReceivable({ poValue: R(100000), gstMode: 'exclusive', gstPercentBp: 1800 }), R(118000));
  assert.equal(C.clientReceivable({ poValue: R(100000), gstMode: 'inclusive', gstPercentBp: 1800 }), R(100000));
  assert.equal(C.clientReceivable({ poValue: R(100000), receivableAdjust: -R(5000) }), R(95000));
});

test('receivable overdue only with a contractual due date', () => {
  const cs = C.clientStatus({ poValue: R(100) }, {});
  assert.equal(C.receivableOverdue({ poValue: R(100) }, cs, '2026-10-16'), false);
  assert.equal(C.receivableOverdue({ poValue: R(100), clientDueDate: '2026-10-01' }, cs, '2026-10-16'), true);
});

test('deadline thresholds (default 30 / 15)', () => {
  const T = '2026-10-16';
  const d = (end, status = 'In Progress') => C.deadlineStatus({ endDate: end, status }, C.DEFAULT_SETTINGS, T).key;
  assert.equal(d('2026-11-20'), 'ontrack');   // 35 days
  assert.equal(d('2026-11-15'), 'attention'); // 30 days
  assert.equal(d('2026-11-01'), 'attention'); // 16 days
  assert.equal(d('2026-10-31'), 'critical');  // 15 days
  assert.equal(d('2026-10-17'), 'critical');  // 1 day
  assert.equal(d('2026-10-16'), 'today');
  assert.equal(d('2026-10-10'), 'overdue');
  assert.equal(d('2026-10-10', 'Completed'), 'closed');
  assert.equal(d('2026-10-10', 'Cancelled'), 'closed');
});

test('deadline thresholds are configurable', () => {
  const s = C.deadlineStatus({ endDate: '2026-11-05', status: 'In Progress' }, { attentionDays: 45, criticalDays: 25 }, '2026-10-16');
  assert.equal(s.key, 'critical');
});

test('Asia/Kolkata date rollover', () => {
  // 20:00 UTC on 15 Oct is 01:30 IST on 16 Oct
  assert.equal(C.todayIST(new Date('2026-10-15T20:00:00Z')), '2026-10-16');
});

test('Indian financial year and quarters', () => {
  assert.deepEqual(C.financialYear('2026-10-16'), { start: '2026-04-01', end: '2027-03-31', label: 'FY 2026-27' });
  assert.equal(C.financialYear('2027-02-01').start, '2026-04-01');
  assert.deepEqual(C.periodRange('quarter', '2026-10-16'), { start: '2026-10-01', end: '2026-12-31' });
  assert.deepEqual(C.periodRange('quarter', '2026-02-10'), { start: '2026-01-01', end: '2026-03-31' });
  assert.deepEqual(C.periodRange('week', '2026-10-16'), { start: '2026-10-12', end: '2026-10-18' });
});

test('procurement variance vs approved value (falls back to lowest quote)', () => {
  const q = { q1: { amount: R(500) }, q2: { amount: R(450) } };
  assert.equal(C.procurementVariance(q, R(480)).variance, R(30));
  assert.equal(C.procurementVariance({ ...q, approvedValue: R(500) }, R(480)).variance, -R(20));
});

test('computeProject marks domains the user cannot read as restricted (null)', () => {
  const r = C.computeProject({ id: 'P1', basic: { status: 'In Progress', endDate: '2026-12-31' }, quotations: {} });
  assert.equal(r.vendor, null);
  assert.equal(r.profit, null);
  assert.equal(r.expenses, null);
  assert.deepEqual(r.lowest, { amount: null, slot: null });
});

test('computeProject uses server summary when expense detail is restricted', () => {
  const r = C.computeProject({ id: 'P1', basic: {}, summary: { projectedProfit: R(10), adjustedProfit: R(5), marginBp: 1234 } });
  assert.equal(r.profit.margin, 12.34);
  assert.equal(r.profitSource, 'summary');
});

test('buildSummary contains only profit figures', () => {
  const s = C.buildSummary({ poValue: R(1000000) }, { purchase: { txns: tx(600000) }, transport: { txns: tx(30000) }, pilot: { txns: tx(20000) }, other: { txns: tx(10000) } }, {});
  assert.deepEqual(Object.keys(s).sort(), ['adjustedProfit', 'costOverrun', 'marginBp', 'projectedProfit']);
  assert.equal(s.marginBp, 3400);
});
