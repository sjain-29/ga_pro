// Run: node --test tests/
// Permission model + security-rule behaviour (via the demo-mode rule simulator, which mirrors database.rules.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Minimal browser globals for the demo backend
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.window = { addEventListener() {} };

const P = await import('../js/permissions.js');
const { createDemoBackend } = await import('../js/demo-db.js');

const user = (o = {}) => ({ status: 'active', role: 'viewer', projectAccess: { all: true }, perms: {}, ...o });

test('inactive users have no access at all', () => {
  const u = user({ status: 'inactive', role: 'admin' });
  assert.equal(P.can(u, 'basic'), false);
  assert.equal(P.isAdmin(u), false);
  assert.equal(P.projectAllowed(u, 'X'), false);
});

test('admins can view/edit everything except calculated profit', () => {
  const a = user({ role: 'admin' });
  assert.equal(P.can(a, 'pilot', 'edit'), true);
  assert.equal(P.can(a, 'profit', 'view'), true);
  assert.equal(P.can(a, 'profit', 'edit'), false);
});

test('field-level matrix is honoured per domain', () => {
  const u = user({ perms: { basic: { view: true }, transport: { view: true, edit: true }, pilot: { view: false } } });
  assert.equal(P.can(u, 'transport', 'edit'), true);
  assert.equal(P.can(u, 'pilot'), false);
  assert.equal(P.can(u, 'purchase'), false);
  assert.equal(P.canSeeAllExpenses(u), false);
});

test('project assignment limits access', () => {
  const u = user({ projectAccess: { all: false, ids: { A: true } } });
  assert.equal(P.projectAllowed(u, 'A'), true);
  assert.equal(P.projectAllowed(u, 'B'), false);
  assert.equal(P.allProjects(u), false);
});

test('modules appear only with the data they need', () => {
  const u = user({ perms: { basic: { view: true }, vendor: { view: true } } });
  const vis = P.MODULES.filter((m) => P.moduleVisible(u, m)).map((m) => m.key);
  assert.ok(vis.includes('vendors'));
  assert.ok(!vis.includes('profit'));
  assert.ok(!vis.includes('users'));
  assert.ok(!vis.includes('reports'));
});

test('role templates: finance can record payments but not see profit', () => {
  const t = P.templateFor('finance');
  assert.equal(t.vendor.edit, true);
  assert.equal(t.clientPay.edit, true);
  assert.equal(t.profit.view, false);
});

/* ---------------------------------------------------- rule simulator */
const B = createDemoBackend();
const denied = async (p) => { try { await p; return false; } catch (e) { return /PERMISSION_DENIED|Validation/.test(e.message); } };

test('restricted user cannot read forbidden domains directly', async () => {
  await B.signInAs('u_proc'); // procurement template: no purchase/pilot/other/po/profit
  assert.ok(await denied(B.get('expPurchase')));
  assert.ok(await denied(B.get('expPurchase/GAL-AGRI-2601')));
  assert.ok(await denied(B.get('summaries')));
  assert.ok(await denied(B.get('poValues/GAL-AGRI-2601')));
  assert.ok(await denied(B.get('users')));
  assert.ok(await denied(B.get('activityLogs')));
  assert.ok(await B.get('quotations/GAL-AGRI-2601'));
  assert.ok(await B.get('expTransport'));
});

test('project-scoped user cannot list a whole path or read other projects', async () => {
  await B.signInAs('u_coord');
  assert.ok(await denied(B.get('projects')));
  assert.ok(await denied(B.get('projects/GAL-DEF-2601')));
  assert.ok(await B.get('projects/GAL-AGRI-2601'));
});

test('writes need edit permission and valid integer paise', async () => {
  await B.signInAs('u_proc');
  assert.ok(await denied(B.update({ 'expPurchase/GAL-AGRI-2601/txns/x': { amount: 100, date: '2026-10-01' } })));
  assert.ok(await denied(B.update({ 'quotations/GAL-AGRI-2601/q1/amount': 10.5 })));
  await B.update({ 'quotations/GAL-AGRI-2601/q1/amount': 1050 });
  assert.equal((await B.get('quotations/GAL-AGRI-2601/q1/amount')), 1050);
});

test('users cannot escalate their own role or access', async () => {
  await B.signInAs('u_finance');
  assert.ok(await denied(B.update({ 'users/u_finance/role': 'admin' })));
  assert.ok(await denied(B.update({ 'users/u_finance/perms/profit/view': true })));
  await B.update({ 'users/u_finance/mustChangePassword': false }); // allowed self-field
});

test('only admins can soft-delete projects; audit log is append-only', async () => {
  await B.signInAs('u_coord');
  assert.ok(await denied(B.update({ 'projects/GAL-AGRI-2601/deleted': true })));
  const key = B.pushKey();
  await B.update({ [`activityLogs/${key}`]: { uid: 'u_coord', username: 'karthik.agri', action: 'x', ts: B.serverTime() } });
  assert.ok(await denied(B.update({ [`activityLogs/${key}/action`]: 'tampered' })));
  assert.ok(await denied(B.update({ [`activityLogs/${B.pushKey()}`]: { uid: 'u_admin', username: 'garuda', action: 'forged', ts: B.serverTime() } })));
});

test('deactivated user loses all read access', async () => {
  await B.signInAs('u_inactive');
  assert.ok(await denied(B.get('projects')));
  assert.ok(await denied(B.get('settings')));
});

/* ------------------------------------------- generated database rules */
test('generated rules protect every access domain', () => {
  const r = JSON.parse(readFileSync(new URL('../firebase/database.rules.json', import.meta.url))).rules;
  assert.equal(r['.read'], false);
  assert.equal(r['.write'], false);
  for (const d of P.DOMAINS) {
    const node = r[d.path];
    assert.ok(node, `missing rules for ${d.path}`);
    const pidRead = node.$pid['.read'];
    assert.match(pidRead, new RegExp(`child\\('perms'\\)\\.child\\('${d.key}'\\)\\.child\\('view'\\)`), d.path);
    assert.match(pidRead, /'active'/, `${d.path} requires active status`);
  }
  assert.match(r.summaries.$pid['.write'], /'admin'/);
  assert.ok(!('.write' in r.activityLogs), 'logs list not writable');
  assert.match(r.activityLogs.$id['.write'], /!data\.exists\(\)/);
  assert.equal(r.usernames['.read'], undefined, 'username list must not be enumerable');
});
