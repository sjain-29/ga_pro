/**
 * Live data store.
 * Subscribes ONLY to the database paths the signed-in user is permitted to read
 * (per access domain and per assigned project), keeps them in memory, and
 * exposes computed project views + write actions. Every write is a single
 * atomic multi-path update that also appends an audit-log entry.
 */
import { backend } from './db.js';
import { CLOUD_FUNCTIONS_DEPLOYED } from './firebase-config.js';
import { DOMAINS, DOMAIN, EXPENSE_DOMAINS, can, isAdmin, allProjects, projectAllowed } from './permissions.js';
import { DEFAULT_SETTINGS, computeProject, buildSummary, todayIST } from './calc.js';

export const state = {
  profile: null,
  uid: null,
  settings: { ...DEFAULT_SETTINGS },
  departments: [],
  data: {},          // domainKey -> { pid -> record }
  loaded: {},        // domainKey -> true after first snapshot
  errors: {},        // domainKey -> message
  users: {},
  logs: {},
  online: true,
  version: 0,
};

const unsubs = [];
const listeners = new Set();
let raf = null;
let computedCache = { v: -1, list: [] };

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() {
  state.version++;
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = null; listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); scheduleSummaryRefresh(); });
}

function watch(path, cb, key, q) {
  const off = backend.onValue(path, (v) => { cb(v); if (key) state.loaded[key] = true; emit(); }, (err) => {
    if (key) { state.errors[key] = err?.code || err?.message || 'error'; state.loaded[key] = true; }
    console.warn('Listener error', path, err?.message || err);
    emit();
  }, q);
  unsubs.push(off);
}

export function stopSync() {
  while (unsubs.length) { try { unsubs.pop()(); } catch { /* ignore */ } }
  state.data = {}; state.loaded = {}; state.errors = {}; state.users = {}; state.logs = {};
}

const accessSig = (p) => JSON.stringify([p?.role, p?.status, p?.perms, p?.projectAccess, p?.modules]);

/** Start (or restart) all subscriptions for this user profile. */
export function startSync(uid, profile, onProfileChange) {
  stopSync();
  state.uid = uid;
  state.profile = profile;
  const sig = accessSig(profile);

  // Own profile: react to deactivation / permission changes instantly.
  watch(`users/${uid}`, (v) => {
    const prev = state.profile;
    state.profile = v;
    if (accessSig(v) !== sig) onProfileChange && onProfileChange(v, prev);
  });
  watch('settings', (v) => { state.settings = { ...DEFAULT_SETTINGS, ...(v || {}) }; }, 'settings');
  watch('departments', (v) => {
    state.departments = Object.entries(v || {}).map(([key, d]) => ({ key, ...d })).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }, 'departments');

  const pids = Object.keys(profile.projectAccess?.ids || {});
  for (const d of DOMAINS) {
    if (d.key === 'comments' || d.key === 'files') continue; // loaded per project page
    if (!can(profile, d.key, 'view')) continue;
    state.data[d.key] = {};
    if (allProjects(profile)) {
      watch(d.path, (v) => { state.data[d.key] = v || {}; }, d.key);
    } else {
      if (!pids.length) state.loaded[d.key] = true;
      pids.forEach((pid, i) => watch(`${d.path}/${pid}`, (v) => {
        if (v) state.data[d.key][pid] = v; else delete state.data[d.key][pid];
        if (i === pids.length - 1) state.loaded[d.key] = true;
      }, null));
      // mark loaded after the first round even if some listeners are slow
      setTimeout(() => { state.loaded[d.key] = true; emit(); }, 1500);
    }
  }
  if (isAdmin(profile)) watch('users', (v) => { state.users = v || {}; }, 'users');
  if (isAdmin(profile) || can(profile, 'audit', 'view')) {
    watch('activityLogs', (v) => { state.logs = v || {}; }, 'logs', { orderBy: 'ts', limitToLast: 400 });
  }
  if (backend.onConnection) unsubs.push(backend.onConnection((on) => { state.online = on; emit(); }));
  emit();
}

/* ------------------------------------------------------------ read models */

export function assemble(pid) {
  const D = state.data, u = state.profile;
  const p = { id: pid, basic: D.basic?.[pid] || null };
  if (can(u, 'client')) p.client = D.client?.[pid] || {};
  if (can(u, 'po')) p.po = D.po?.[pid] || {};
  if (can(u, 'quotations')) p.quotations = D.quotations?.[pid] || {};
  if (can(u, 'vendor')) p.vendor = D.vendor?.[pid] || {};
  for (const c of EXPENSE_DOMAINS) if (can(u, c)) { p.expenses = p.expenses || {}; p.expenses[c] = D[c]?.[pid] || {}; }
  if (can(u, 'clientPay')) p.clientPay = D.clientPay?.[pid] || {};
  if (can(u, 'profit')) p.summary = D.profit?.[pid] || null;
  return p;
}

/** All projects visible to the user, merged and computed. Cached per state version. */
export function projects({ includeArchived = false, includeDeleted = false } = {}) {
  if (computedCache.v !== state.version) {
    const today = todayIST();
    const list = [];
    for (const pid of Object.keys(state.data.basic || {})) {
      const raw = assemble(pid);
      if (!raw.basic) continue;
      const c = computeProject(raw, state.settings, today);
      if (!can(state.profile, 'profit')) c.profit = null; // honour "Profit: No" even if inputs are visible
      list.push({ ...raw, calc: c });
    }
    computedCache = { v: state.version, list };
  }
  return computedCache.list.filter((p) => (includeDeleted || !p.basic.deleted) && (includeArchived || !p.basic.archived || includeDeleted));
}

export function project(pid) { return projects({ includeArchived: true, includeDeleted: true }).find((p) => p.id === pid) || null; }

export const activeDepartments = () => state.departments.filter((d) => d.active !== false);
export const loadedBasic = () => !!state.loaded.basic;

/* ---------------------------------------------------------------- writes */

const strip = (o) => {
  if (o === undefined) return null;
  if (o === null || typeof o !== 'object') return o;
  const out = Array.isArray(o) ? [] : {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = strip(v);
  return out;
};

function logEntry(action, extra = {}) {
  return strip({
    uid: state.uid, username: state.profile?.username || '', action, ts: backend.serverTime(),
    projectId: extra.projectId || '', field: extra.field, prev: extra.prev === undefined ? undefined : String(extra.prev).slice(0, 500),
    next: extra.next === undefined ? undefined : String(extra.next).slice(0, 500),
  });
}

export async function commit(updates, logs = []) {
  const u = { ...updates };
  for (const l of logs) u[`activityLogs/${backend.pushKey('activityLogs')}`] = logEntry(l.action, l);
  for (const k of Object.keys(u)) u[k] = strip(u[k]);
  await backend.update(u);
}

export const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

export async function projectIdExists(pid) {
  try { return (await backend.get(`projectIndex/${pid}`)) === true; } catch { return false; }
}

export async function createProject(f) {
  const u = state.profile;
  if (!can(u, 'basic', 'create')) throw new Error('You do not have permission to create projects.');
  if (!PROJECT_ID_RE.test(f.projectId)) throw new Error('Project ID may contain letters, numbers, - and _ (2–40 characters).');
  if (await projectIdExists(f.projectId)) throw new Error(`Project ID ${f.projectId} already exists.`);
  const pid = f.projectId;
  const ts = backend.serverTime();
  const updates = {
    [`projects/${pid}`]: {
      projectId: pid, description: f.description, clientName: f.clientName, department: f.department, status: f.status,
      poDate: f.poDate || '', endDate: f.endDate || '', remarks: f.remarks || '', archived: false,
      createdAt: ts, createdBy: state.uid, updatedAt: ts, updatedBy: state.uid,
    },
    [`projectIndex/${pid}`]: true,
  };
  if (can(u, 'client', 'edit')) updates[`clientContacts/${pid}`] = { contactPerson: f.contactPerson || '', email: f.clientEmail || '', phone: f.clientPhone || '', updatedAt: ts, updatedBy: state.uid };
  if (can(u, 'po', 'edit') && f.poValue !== null && f.poValue !== undefined) updates[`poValues/${pid}`] = { poValue: f.poValue, gstMode: f.gstMode || 'inclusive', gstPercentBp: f.gstPercentBp ?? 1800, tdsTreatment: 'credit', updatedAt: ts, updatedBy: state.uid };
  await commit(updates, [{ action: 'project.create', projectId: pid, next: f.description }]);
  return pid;
}

/** Patch fields of one domain record. `changes` = [{field,label,prev,next}] for the audit log. */
export async function updateRecord(domainKey, pid, patch, action, changes = []) {
  const path = DOMAIN[domainKey].path;
  const updates = {};
  for (const [k, v] of Object.entries(patch)) updates[`${path}/${pid}/${k}`] = v === undefined ? null : v;
  updates[`${path}/${pid}/updatedAt`] = backend.serverTime();
  updates[`${path}/${pid}/updatedBy`] = state.uid;
  if (domainKey !== 'basic' && can(state.profile, 'basic', 'edit') && projectAllowed(state.profile, pid)) {
    updates[`projects/${pid}/updatedAt`] = backend.serverTime();
    updates[`projects/${pid}/updatedBy`] = state.uid;
  }
  const logs = changes.length ? changes.map((c) => ({ action, projectId: pid, field: c.label || c.field, prev: c.prev, next: c.next })) : [{ action, projectId: pid }];
  await commit(updates, logs);
}

export async function addTxn(domainKey, pid, list, txn, action, summary) {
  const path = DOMAIN[domainKey].path;
  const key = backend.pushKey(path);
  await commit({
    [`${path}/${pid}/${list}/${key}`]: { ...txn, createdAt: backend.serverTime(), createdBy: state.uid },
    [`${path}/${pid}/updatedAt`]: backend.serverTime(),
    [`${path}/${pid}/updatedBy`]: state.uid,
  }, [{ action, projectId: pid, next: summary }]);
  return key;
}

export async function editTxn(domainKey, pid, list, key, txn, action, prev, next) {
  const path = DOMAIN[domainKey].path;
  const updates = {};
  for (const [k, v] of Object.entries(txn)) updates[`${path}/${pid}/${list}/${key}/${k}`] = v;
  updates[`${path}/${pid}/${list}/${key}/editedAt`] = backend.serverTime();
  updates[`${path}/${pid}/${list}/${key}/editedBy`] = state.uid;
  await commit(updates, [{ action, projectId: pid, prev, next }]);
}

/** Transactions are never hard-deleted: they are voided with a reason (audit-safe). */
export async function voidTxn(domainKey, pid, list, key, reason, action, prev) {
  const path = DOMAIN[domainKey].path;
  await commit({
    [`${path}/${pid}/${list}/${key}/void`]: true,
    [`${path}/${pid}/${list}/${key}/voidReason`]: reason || '',
    [`${path}/${pid}/${list}/${key}/voidedBy`]: state.uid,
    [`${path}/${pid}/${list}/${key}/voidedAt`]: backend.serverTime(),
  }, [{ action, projectId: pid, prev, next: `VOID: ${reason || ''}` }]);
}

export async function setArchived(pid, archived) {
  await commit({ [`projects/${pid}/archived`]: archived, [`projects/${pid}/updatedAt`]: backend.serverTime(), [`projects/${pid}/updatedBy`]: state.uid },
    [{ action: archived ? 'project.archive' : 'project.unarchive', projectId: pid }]);
}

export async function setDeleted(pid, deleted) {
  if (!isAdmin(state.profile)) throw new Error('Only administrators can delete projects.');
  await commit({ [`projects/${pid}/deleted`]: deleted, [`projects/${pid}/deletedAt`]: deleted ? backend.serverTime() : null, [`projects/${pid}/deletedBy`]: deleted ? state.uid : null },
    [{ action: deleted ? 'project.delete' : 'project.restore', projectId: pid }]);
}

/* ------------------------------------------------------------ admin ops */

export async function saveSettings(patch) {
  const updates = {};
  for (const [k, v] of Object.entries(patch)) updates[`settings/${k}`] = v;
  await commit(updates, [{ action: 'settings.update', next: JSON.stringify(patch) }]);
}

export async function saveDepartment(key, rec, isNew) {
  await commit({ [`departments/${key}`]: rec }, [{ action: isNew ? 'department.add' : 'department.update', next: `${rec.name} (${rec.active ? 'active' : 'inactive'})` }]);
}

export async function usernameTaken(username) {
  try { return !!(await backend.get(`usernames/${username}`)); } catch { return false; }
}

const randomPassword = () => {
  const a = new Uint32Array(4); crypto.getRandomValues(a);
  return 'Ga!' + Array.from(a, (n) => n.toString(36)).join('').slice(0, 18) + '9z';
};

export async function createUser(f) {
  if (!isAdmin(state.profile)) throw new Error('Only administrators can create users.');
  if (await usernameTaken(f.username)) throw new Error(`Username "${f.username}" is already taken.`);
  const password = f.passwordMode === 'temp' ? f.tempPassword : randomPassword();
  const uid = await backend.createAccount(f.email, password);
  const profile = {
    fullName: f.fullName, username: f.username, email: f.email, department: f.department, role: f.role, status: f.status,
    projectAccess: f.projectAccess, perms: f.perms, modules: f.modules, mustChangePassword: true,
    createdAt: backend.serverTime(), createdBy: state.uid,
  };
  await commit({ [`users/${uid}`]: profile, [`usernames/${f.username}`]: { uid, email: f.email } },
    [{ action: 'user.create', next: `${f.username} (${f.role})` }, { action: 'permissions.update', field: f.username, next: permSummary(f.perms) }]);
  if (f.passwordMode !== 'temp') await backend.sendReset(f.email);
  return uid;
}

export function permSummary(perms = {}) {
  return Object.entries(perms).map(([k, v]) => `${k}:${v.view ? 'V' : '-'}${v.edit ? 'E' : ''}${v.create ? 'C' : ''}`).join(' ');
}

export async function updateUser(uid, before, f) {
  const updates = {};
  for (const k of ['fullName', 'email', 'department', 'role', 'status', 'projectAccess', 'perms', 'modules']) updates[`users/${uid}/${k}`] = f[k];
  updates[`users/${uid}/updatedAt`] = backend.serverTime();
  updates[`users/${uid}/updatedBy`] = state.uid;
  if (f.username !== before.username) {
    if (await usernameTaken(f.username)) throw new Error(`Username "${f.username}" is already taken.`);
    updates[`users/${uid}/username`] = f.username;
    updates[`usernames/${before.username}`] = null;
    updates[`usernames/${f.username}`] = { uid, email: f.email };
  } else if (f.email !== before.email) updates[`usernames/${f.username}`] = { uid, email: f.email };
  const logs = [{ action: 'user.update', field: f.username, prev: `${before.role}/${before.status}`, next: `${f.role}/${f.status}` }];
  if (permSummary(before.perms) !== permSummary(f.perms) || JSON.stringify(before.projectAccess) !== JSON.stringify(f.projectAccess)) {
    logs.push({ action: 'permissions.update', field: f.username, prev: permSummary(before.perms), next: permSummary(f.perms) });
  }
  await commit(updates, logs);
  if (CLOUD_FUNCTIONS_DEPLOYED && before.status !== f.status) {
    await backend.callFunction('setAccountDisabled', { uid, disabled: f.status !== 'active' }).catch((e) => console.warn(e));
  }
}

export async function setUserStatus(uid, user, status) {
  await commit({ [`users/${uid}/status`]: status, [`users/${uid}/updatedAt`]: backend.serverTime() },
    [{ action: status === 'active' ? 'user.activate' : 'user.deactivate', field: user.username, prev: user.status, next: status }]);
  if (CLOUD_FUNCTIONS_DEPLOYED) await backend.callFunction('setAccountDisabled', { uid, disabled: status !== 'active' }).catch((e) => console.warn(e));
}

export async function resetPassword(user) {
  await backend.sendReset(user.email);
  await commit({ [`users/${user.uid}/mustChangePassword`]: true }, [{ action: 'user.passwordReset', field: user.username }]);
}

export async function addComment(pid, text) {
  const key = backend.pushKey('comments');
  await commit({ [`comments/${pid}/${key}`]: { uid: state.uid, name: state.profile.fullName, text: text.slice(0, 2000), ts: backend.serverTime() } },
    [{ action: 'comment.add', projectId: pid, next: text.slice(0, 120) }]);
}

/* --------------------------------------- summaries (no-Cloud-Functions mode) */
/**
 * Users without expense access can still be granted "Profit" view. They read
 * /summaries, which holds ONLY profit figures. With Cloud Functions deployed,
 * the function writes summaries; otherwise any signed-in administrator's
 * browser keeps them current (rules allow only admins to write /summaries).
 */
let summaryTimer = null;
function scheduleSummaryRefresh() {
  if (CLOUD_FUNCTIONS_DEPLOYED || !isAdmin(state.profile)) return;
  if (!['basic', 'po', 'clientPay', ...EXPENSE_DOMAINS, 'profit'].every((k) => state.loaded[k])) return;
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(refreshSummaries, 1200);
}
const norm = (o) => JSON.stringify(Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined).sort()));
async function refreshSummaries() {
  const D = state.data;
  const updates = {};
  for (const pid of Object.keys(D.basic || {})) {
    const s = buildSummary(D.po?.[pid], { purchase: D.purchase?.[pid], transport: D.transport?.[pid], pilot: D.pilot?.[pid], other: D.other?.[pid] }, D.clientPay?.[pid]);
    if (norm(s) !== norm(D.profit?.[pid])) updates[`summaries/${pid}`] = strip(Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null)));
  }
  if (Object.keys(updates).length) {
    try { await backend.update(updates); } catch (e) { console.warn('Summary refresh failed', e.message); }
  }
}
