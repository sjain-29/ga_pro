/**
 * DEMO BACKEND — runs entirely in the browser with sample data.
 *
 * • Never used when Firebase is configured (see firebase-config.js), so demo
 *   data can never mix with production data.
 * • Simulates the Realtime Database Security Rules (firebase/database.rules.json)
 *   so permission behaviour can be tried and tested without Firebase:
 *   a restricted user's listener on a forbidden path fails with PERMISSION_DENIED,
 *   exactly as it would against the real database.
 * • Data is kept in localStorage under a demo-only key (never the production DB).
 *   Open two tabs, sign in as different users, and changes sync live between them.
 */
import { buildDemoTree } from './demo-data.js';
import { PATH_TO_DOMAIN } from './permissions.js';

const KEY = 'garuda-demo-db-v1';
const SESSION = 'garuda-demo-uid';
const SV = '__SERVER_TIMESTAMP__';
const MONEY_NONNEG = new Set(['amount', 'poValue', 'approvedPayable', 'approvedValue', 'gstPercentBp']);
const MONEY_SIGNED = new Set(['receivableAdjust']);

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const segsOf = (path) => String(path).split('/').filter(Boolean);
const getAt = (tree, segs) => segs.reduce((n, s) => (n && typeof n === 'object' ? n[s] : undefined), tree) ?? null;

function setAt(tree, segs, val) {
  if (!segs.length) return val;
  let n = tree;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!n[segs[i]] || typeof n[segs[i]] !== 'object') n[segs[i]] = {};
    n = n[segs[i]];
  }
  const last = segs[segs.length - 1];
  if (val === null || val === undefined) delete n[last]; else n[last] = val;
  return tree;
}

/** Remove empty objects like Firebase does. */
function prune(node) {
  if (!node || typeof node !== 'object') return node;
  for (const k of Object.keys(node)) {
    const v = prune(node[k]);
    if (v === null || v === undefined || (typeof v === 'object' && !Object.keys(v).length)) delete node[k]; else node[k] = v;
  }
  return node;
}

function resolveSV(v, now) {
  if (v === SV) return now;
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = resolveSV(v[k], now); }
  return v;
}

export function createDemoBackend() {
  let tree = load();
  let uid = sessionStorage.getItem(SESSION) || null;
  const listeners = new Set();
  const authCbs = new Set();

  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    const t = buildDemoTree();
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ }
    return t;
  }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch { /* quota */ } };

  /* ------------------------------------------------------- rule simulator */
  function ctxFor(t) {
    const me = uid ? t.users?.[uid] : null;
    const active = !!me && me.status === 'active';
    const admin = active && me.role === 'admin';
    const canP = (d, a) => active && me.perms?.[d]?.[a] === true;
    const projOk = (pid) => admin || (active && (me.projectAccess?.all === true || me.projectAccess?.ids?.[pid] === true));
    const allProj = admin || (active && me.projectAccess?.all === true);
    return { me, active, admin, canP, projOk, allProj };
  }

  function readAt(segs) {
    const c = ctxFor(tree);
    const [a, b] = segs;
    if (segs.length === 0) return false;
    if (a === 'usernames') return segs.length >= 2;
    if (!uid) return false;
    if (a === 'users') return segs.length === 1 ? c.admin : (c.admin || b === uid);
    if (a === 'meta') return true;
    if (a === 'settings' || a === 'departments' || a === 'projectIndex') return c.active;
    if (a === 'activityLogs') return c.admin || c.canP('audit', 'view');
    const dom = PATH_TO_DOMAIN[a];
    if (dom) {
      if (segs.length === 1) return c.admin || (c.allProj && c.canP(dom, 'view'));
      return c.admin || (c.projOk(b) && c.canP(dom, 'view'));
    }
    return false;
  }
  const canRead = (segs) => { for (let i = 1; i <= segs.length; i++) if (readAt(segs.slice(0, i))) return true; return false; };

  function writeAt(segs, nv, ov, post) {
    const c = ctxFor(tree);
    if (!uid || !c.active) return false;
    const [a, b, d] = segs;
    const n = segs.length;
    if (a === 'users') {
      if (n === 2) return c.admin;
      if (n === 3 && b === uid && d === 'mustChangePassword') return nv === false || c.admin;
      if (n === 3 && b === uid && (d === 'lastLoginAt' || d === 'prefs')) return true;
      return false;
    }
    if (a === 'usernames' || a === 'settings' || a === 'departments' || a === 'summaries') return n >= 1 && c.admin;
    if (a === 'projectIndex' && n === 2) return c.admin || (c.canP('basic', 'create') && ov === null && nv === true);
    if (a === 'activityLogs' && n === 2) return ov === null && nv && nv.uid === uid && typeof nv.ts === 'number';
    if (a === 'projects' && n === 2) {
      if (c.admin) return true;
      if (ov === null) return c.canP('basic', 'create') && nv !== null;
      return nv !== null && c.projOk(b) && c.canP('basic', 'edit');
    }
    if ((a === 'comments' || a === 'attachments') && n === 3) {
      const dom = a === 'comments' ? 'comments' : 'files';
      if (c.admin) return true;
      return ov === null && nv && nv.uid === uid && c.projOk(b) && c.canP(dom, 'edit');
    }
    const dom = PATH_TO_DOMAIN[a];
    if (dom && n === 2 && a !== 'projects') {
      if (c.admin) return true;
      return c.projOk(b) && c.canP(dom, 'edit') && getAt(post, ['projects', b]) !== null;
    }
    return false;
  }

  function validate(segs, nv, post) {
    const c = ctxFor(tree);
    const key = segs[segs.length - 1];
    if (nv === null) return true;
    if (MONEY_NONNEG.has(key)) return Number.isSafeInteger(nv) && nv >= 0;
    if (MONEY_SIGNED.has(key)) return Number.isSafeInteger(nv);
    if (segs[0] === 'projects' && key === 'deleted' && segs.length === 3) return c.admin || nv === getAt(tree, segs);
    if (segs[0] === 'users' && segs.length === 3 && key === 'role' && segs[1] === uid && !c.admin) return false;
    if (nv && typeof nv === 'object') return Object.keys(nv).every((k) => validate([...segs, k], nv[k], post));
    return true;
  }

  function canWrite(segs, post) {
    const nv = getAt(post, segs);
    if (!validate(segs, nv, post)) return 'validation';
    for (let i = 1; i <= segs.length; i++) {
      const s = segs.slice(0, i);
      if (writeAt(s, getAt(post, s), getAt(tree, s), post)) return true;
    }
    return false;
  }

  /* ----------------------------------------------------------- listeners */
  function applyQuery(val, q) {
    if (!q || !val || typeof val !== 'object') return val;
    let entries = Object.entries(val);
    if (q.orderBy) {
      if (q.equalTo !== undefined) entries = entries.filter(([, v]) => v && v[q.orderBy] === q.equalTo);
      entries.sort(([, x], [, y]) => (x?.[q.orderBy] ?? 0) > (y?.[q.orderBy] ?? 0) ? 1 : -1);
    }
    if (q.limitToLast) entries = entries.slice(-q.limitToLast);
    return Object.fromEntries(entries);
  }
  function fire(l) {
    const segs = segsOf(l.path);
    if (!canRead(segs)) { l.err && l.err({ code: 'PERMISSION_DENIED', message: 'permission_denied' }); listeners.delete(l); return; }
    const v = clone(applyQuery(getAt(tree, segs), l.q));
    const sig = JSON.stringify(v);
    if (sig === l.last) return;
    l.last = sig;
    l.cb(v);
  }
  const overlaps = (p1, p2) => { const a = segsOf(p1).join('/'), b = segsOf(p2).join('/'); return a === b || a.startsWith(b + '/') || b.startsWith(a + '/') || !a || !b; };

  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try { tree = JSON.parse(e.newValue); } catch { return; }
    for (const l of [...listeners]) fire(l);
  });

  const deny = () => Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });

  return {
    mode: 'demo',
    storageAvailable: false,
    serverTime: () => SV,
    pushKey: () => '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    onValue(path, cb, err, q) {
      const l = { path, cb, err, q, last: undefined };
      listeners.add(l);
      setTimeout(() => listeners.has(l) && fire(l), 0);
      return () => listeners.delete(l);
    },
    async get(path) {
      const segs = segsOf(path);
      if (!canRead(segs)) throw deny();
      return clone(getAt(tree, segs));
    },
    async update(updates) {
      await new Promise((r) => setTimeout(r, 120)); // network-ish latency
      const now = Date.now();
      const post = clone(tree) || {};
      const paths = Object.keys(updates);
      for (const p of paths) setAt(post, segsOf(p), resolveSV(clone(updates[p]), now));
      prune(post);
      for (const p of paths) {
        const ok = canWrite(segsOf(p), post);
        if (ok !== true) throw Object.assign(new Error(ok === 'validation' ? `Validation failed at ${p}` : `PERMISSION_DENIED at ${p}`), { code: 'PERMISSION_DENIED' });
      }
      tree = post;
      persist();
      for (const l of [...listeners]) if (paths.some((p) => overlaps(p, l.path))) fire(l);
    },
    set(path, v) { return this.update({ [path]: v }); },
    onConnection(cb) { cb(true); return () => {}; },

    /* ---- demo auth (persona sign-in; no passwords are used in demo mode) ---- */
    onAuth(cb) { authCbs.add(cb); setTimeout(() => cb(uid ? { uid, email: tree.users?.[uid]?.email } : null), 0); return () => authCbs.delete(cb); },
    async signInAs(id) { uid = id; sessionStorage.setItem(SESSION, id); for (const l of [...listeners]) fire(l); authCbs.forEach((cb) => cb({ uid, email: tree.users?.[uid]?.email })); },
    async signIn() { throw Object.assign(new Error('Demo mode uses persona sign-in.'), { code: 'demo' }); },
    async signOut() { uid = null; sessionStorage.removeItem(SESSION); listeners.clear(); authCbs.forEach((cb) => cb(null)); },
    async changePassword() { /* no passwords in demo */ },
    async sendReset() { /* simulated */ },
    currentUid: () => uid,
    async createAccount() { return 'u_' + Math.random().toString(36).slice(2, 10); },
    async callFunction() { throw new Error('Cloud Functions are not available in demo mode.'); },
    listPersonas() {
      return Object.entries(tree.users || {}).map(([id, u]) => ({ uid: id, ...u }));
    },
    resetDemo() { localStorage.removeItem(KEY); tree = load(); persist(); for (const l of [...listeners]) fire(l); },
    _debugTree: () => tree,
  };
}
