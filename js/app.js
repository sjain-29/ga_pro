/**
 * Garuda Project Command Center — application bootstrap, shell & router.
 */
import { initBackend, backend } from './db.js';
import { renderLogin, renderBootstrap, renderChangePassword, renderBlocked } from './auth.js';
import { state, startSync, stopSync, onChange, projects } from './store.js';
import { MODULES, ROLES, moduleVisible, can, isAdmin } from './permissions.js';
import { esc, initials, date, daysLabel } from './format.js';
import { icon, icons, toast, drawer, debounce, $ } from './ui.js';

const root = document.getElementById('root');
const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  projects: () => import('./views/projects.js'),
  project: () => import('./views/project-detail.js'),
  procurement: () => import('./views/procurement.js'),
  vendors: () => import('./views/vendors.js'),
  expenses: () => import('./views/expenses.js'),
  clients: () => import('./views/clients.js'),
  profit: () => import('./views/profit.js'),
  reports: () => import('./views/reports.js'),
  users: () => import('./views/users.js'),
  audit: () => import('./views/audit.js'),
  settings: () => import('./views/settings.js'),
};

let current = null;       // { name, inst }
let shellReady = false;
let routeSeq = 0;

/* ------------------------------------------------------------- routing */
export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').map(decodeURIComponent);
  return { name: parts[0] || 'dashboard', param: parts[1] || null, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

async function route() {
  if (!shellReady) return;
  const seq = ++routeSeq;
  const r = parseHash();
  const mod = MODULES.find((m) => m.route === r.name);
  const el = $('#view');
  document.body.classList.remove('nav-open');
  if (r.name !== 'project' && (!mod || !moduleVisible(state.profile, mod))) {
    if (r.name !== 'dashboard') { go('#/dashboard'); return; }
  }
  if (current?.inst?.destroy) current.inst.destroy();
  current = null;
  el.innerHTML = '';
  el.className = 'view';
  void el.offsetWidth;
  try {
    const m = await VIEWS[r.name]();
    if (seq !== routeSeq) return;
    const inst = m.mount(el, r, appApi) || {};
    current = { name: r.name, inst };
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="card card-pad">${esc(e.message)}</div>`;
  }
  highlightNav(r.name === 'project' ? 'projects' : r.name);
  icons(el);
  window.scrollTo({ top: 0 });
}

/* --------------------------------------------------------------- shell */
function renderShell() {
  const p = state.profile;
  const roleLabel = ROLES.find((r) => r.key === p.role)?.label || p.role;
  const nav = MODULES.filter((m) => moduleVisible(p, m));
  const main = nav.filter((m) => !['users', 'audit', 'settings'].includes(m.key));
  const admin = nav.filter((m) => ['users', 'audit', 'settings'].includes(m.key));
  root.innerHTML = `
  <div class="app">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="brand"><img class="brand-mark" src="assets/logo.svg" alt=""><div><div class="brand-name">GARUDA AEROSPACE</div><div class="brand-sub">Project Command Center</div></div></div>
      <nav class="nav">
        <div class="nav-label">Workspace</div>
        ${main.map((m) => `<a href="#/${m.route}" data-route="${m.route}">${icon(m.icon)}<span>${esc(m.label)}</span>${m.key === 'dashboard' ? '<span class="count hidden" id="nav-crit"></span>' : ''}</a>`).join('')}
        ${admin.length ? `<div class="nav-label">Administration</div>${admin.map((m) => `<a href="#/${m.route}" data-route="${m.route}">${icon(m.icon)}<span>${esc(m.label)}</span></a>`).join('')}` : ''}
      </nav>
      <div class="side-foot"><div class="me">
        <div class="avatar">${esc(initials(p.fullName))}</div>
        <div style="min-width:0"><div class="me-name">${esc(p.fullName)}</div><div class="me-role">${esc(roleLabel)} · @${esc(p.username)}</div></div>
        <button class="icon-btn" id="btn-logout" title="Sign out" aria-label="Sign out">${icon('log-out')}</button>
      </div></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="btn-menu" aria-label="Open menu">${icon('menu')}</button>
        <div class="gsearch">${icon('search')}<input class="input" id="gsearch" placeholder="Search projects, clients, IDs…" autocomplete="off" aria-label="Global search"><kbd>/</kbd><div class="search-pop hidden" id="gsearch-pop"></div></div>
        <div class="top-actions">
          ${backend.mode === 'demo' ? '<span class="mode-pill" title="Sample data in this browser only">Demo</span>' : ''}
          <span class="conn" id="conn"><span class="dot"></span><span>Live</span></span>
          <button class="icon-btn" id="btn-privacy" title="Hide / show amounts" aria-label="Hide or show amounts">${icon('eye')}</button>
          <button class="icon-btn" id="btn-theme" title="Toggle dark mode" aria-label="Toggle dark mode">${icon('moon')}</button>
          <button class="icon-btn" id="btn-notif" title="Notifications" aria-label="Notifications">${icon('bell')}<span class="notif-dot hidden" id="notif-count"></span></button>
          ${can(p, 'basic', 'create') ? `<button class="btn btn-primary" id="btn-add">${icon('plus')}<span class="hide-sm">Add New Project</span></button>` : ''}
        </div>
      </header>
      <div id="banners"></div>
      <main class="content"><div id="view" class="view"></div></main>
    </div>
  </div>`;
  shellReady = true;
  icons(root);
  wireShell();
}

function highlightNav(name) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
}

function wireShell() {
  $('#btn-logout').onclick = () => backend.signOut();
  $('#btn-menu').onclick = () => document.body.classList.toggle('nav-open');
  document.body.addEventListener('click', (e) => { if (document.body.classList.contains('nav-open') && !e.target.closest('#sidebar') && !e.target.closest('#btn-menu')) document.body.classList.remove('nav-open'); });
  $('#btn-theme').onclick = toggleTheme;
  $('#btn-privacy').onclick = togglePrivacy;
  $('#btn-notif').onclick = openNotifications;
  const add = $('#btn-add');
  if (add) add.onclick = async () => (await import('./views/projects.js')).openProjectWizard(appApi);
  setThemeIcon(); setPrivacy(localStorage.getItem('garuda-privacy') === '1');

  const input = $('#gsearch'), pop = $('#gsearch-pop');
  let hl = 0;
  const search = debounce(() => {
    const q = input.value.trim().toLowerCase();
    if (!q) { pop.classList.add('hidden'); return; }
    const res = projects({ includeArchived: true }).filter((p) => [p.id, p.basic.description, p.basic.clientName, p.basic.department].join(' ').toLowerCase().includes(q)).slice(0, 8);
    hl = 0;
    pop.innerHTML = res.length ? res.map((p, i) => `<a href="#/project/${encodeURIComponent(p.id)}" class="${i === 0 ? 'hl' : ''}"><span class="pid">${esc(p.id)}</span><span class="li-main"><span class="li-title">${esc(p.basic.description)}</span><span class="li-sub">${esc(p.basic.clientName)} · ${esc(p.basic.department)}</span></span></a>`).join('')
      : '<div class="muted" style="padding:12px">No matching projects you can access.</div>';
    pop.classList.remove('hidden');
  }, 120);
  input.oninput = search;
  input.onkeydown = (e) => {
    const items = [...pop.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1); items.forEach((a, i) => a.classList.toggle('hl', i === hl)); }
    if (e.key === 'Enter' && items[hl]) { location.hash = items[hl].getAttribute('href'); input.value = ''; pop.classList.add('hidden'); input.blur(); }
    if (e.key === 'Escape') { pop.classList.add('hidden'); input.blur(); }
  };
  pop.onclick = () => { input.value = ''; pop.classList.add('hidden'); };
  input.onblur = () => setTimeout(() => pop.classList.add('hidden'), 150);
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !e.target.closest('input,textarea,select')) { e.preventDefault(); input.focus(); } });
}

function setThemeIcon() { const b = $('#btn-theme'); if (b) { b.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'); icons(b); } }
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('garuda-theme', t); } catch { /* ignore */ }
  setThemeIcon();
  window.dispatchEvent(new Event('themechange'));
}
function setPrivacy(on) {
  document.body.classList.toggle('privacy', on);
  const b = $('#btn-privacy'); if (b) { b.innerHTML = icon(on ? 'eye-off' : 'eye'); b.classList.toggle('on', on); icons(b); }
}
function togglePrivacy() {
  const on = !document.body.classList.contains('privacy');
  setPrivacy(on);
  try { localStorage.setItem('garuda-privacy', on ? '1' : '0'); } catch { /* ignore */ }
  toast(on ? 'Financial values hidden.' : 'Financial values visible.', 'info', 1800);
}

/* -------------------------------------------------------- notifications */
function alertsList() {
  const list = projects();
  const pick = (k) => list.filter((p) => p.calc.deadline.key === k).sort((a, b) => a.calc.deadline.days - b.calc.deadline.days);
  return { overdue: pick('overdue'), today: pick('today'), critical: pick('critical') };
}
function refreshShellIndicators() {
  if (!shellReady) return;
  const a = alertsList();
  const n = a.overdue.length + a.today.length + a.critical.length;
  const seen = localStorage.getItem(`garuda-notif-seen-${state.uid}`);
  const sig = [...a.overdue, ...a.today, ...a.critical].map((p) => p.id + p.calc.deadline.key).join(',');
  const c = $('#notif-count');
  if (c) { c.textContent = n > 99 ? '99+' : n; c.classList.toggle('hidden', !n || seen === sig); }
  const nc = $('#nav-crit'); if (nc) { nc.textContent = a.overdue.length + a.today.length || ''; nc.classList.toggle('hidden', !(a.overdue.length + a.today.length)); }
  const conn = $('#conn'); if (conn) { conn.classList.toggle('off', !state.online); conn.lastElementChild.textContent = state.online ? 'Live' : 'Offline'; }
  const banners = $('#banners');
  if (banners) {
    banners.innerHTML = state.online ? '' : `<div class="banner err">${icon('wifi-off')}You are offline. Changes will sync when the connection to Firebase returns; saving may fail until then.</div>`;
    icons(banners);
  }
}
function openNotifications() {
  const a = alertsList();
  const row = (p) => `<a class="list-item" href="#/project/${encodeURIComponent(p.id)}"><div class="li-main"><div class="li-title"><span class="pid">${esc(p.id)}</span> ${esc(p.basic.description)}</div><div class="li-sub">${esc(p.basic.clientName)} · ${esc(p.basic.department)} · ends ${date(p.basic.endDate)}</div></div><span class="days-pill ${p.calc.deadline.days < 0 ? 'neg' : ''}">${daysLabel(p.calc.deadline.days)}</span></a>`;
  const sec = (t, l) => (l.length ? `<div class="np-section">${t} (${l.length})</div>${l.map(row).join('')}` : '');
  const total = a.overdue.length + a.today.length + a.critical.length;
  const d = drawer({ title: 'Notifications', size: 'sm', body: total ? sec('Overdue', a.overdue) + sec('Due today', a.today) + sec(`Critical (≤ ${state.settings.criticalDays} days)`, a.critical) : `<div class="empty">${icon('bell-off', 'empty-ico')}<h3>All clear</h3><p>No projects are overdue, due today or critical.</p></div>` });
  d.body.onclick = (e) => { if (e.target.closest('a')) d.close(); };
  const sig = [...a.overdue, ...a.today, ...a.critical].map((p) => p.id + p.calc.deadline.key).join(',');
  try { localStorage.setItem(`garuda-notif-seen-${state.uid}`, sig); } catch { /* ignore */ }
  refreshShellIndicators();
}

/* ---------------------------------------------------------------- auth */
async function handleAuth(user) {
  stopSync();
  shellReady = false;
  if (current?.inst?.destroy) current.inst.destroy();
  current = null;
  if (!user) { renderLogin(root); return; }
  let profile = null;
  try { profile = await backend.get(`users/${user.uid}`); } catch (e) { console.warn(e); }
  if (!profile) {
    let boot = null;
    try { boot = await backend.get('meta/bootstrapped'); } catch { /* ignore */ }
    if (!boot) { renderBootstrap(root, user, () => handleAuth(user)); return; }
    renderBlocked(root, 'Account not provisioned', 'Your sign-in worked, but no Command Center profile exists for this account. Ask an administrator to create your user.');
    return;
  }
  if (profile.status !== 'active') { renderBlocked(root, 'Account deactivated', 'This account has been deactivated by an administrator. Contact your administrator if you need access.'); return; }
  if (profile.mustChangePassword && backend.mode !== 'demo') { renderChangePassword(root, user, profile, () => handleAuth(user)); return; }
  backend.update({ [`users/${user.uid}/lastLoginAt`]: backend.serverTime() }).catch(() => {});
  startSync(user.uid, profile, (next) => {
    if (!next || next.status !== 'active') { toast('Your account was deactivated.', 'error'); backend.signOut(); return; }
    toast('Your permissions were updated by an administrator.', 'info');
    handleAuth(user);
  });
  renderShell();
  route();
}

export const appApi = { go, parseHash, refresh: () => current?.inst?.update && current.inst.update() };

onChange(() => {
  refreshShellIndicators();
  if (current?.inst?.update) { try { current.inst.update(); icons($('#view')); } catch (e) { console.error(e); } }
});
window.addEventListener('hashchange', route);
window.addEventListener('load', () => icons());

(async function boot() {
  try {
    await initBackend();
    backend.onAuth(handleAuth);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="boot-screen"><div class="inner" style="max-width:460px;padding:20px">
      <img class="brand-mark" src="assets/logo.svg" alt=""><h2 style="margin-top:14px">Unable to connect</h2>
      <p style="color:#b9c6df;margin:8px 0 18px">${esc(e.message)}. Check your internet connection and Firebase configuration.</p>
      <button class="btn btn-primary" onclick="location.reload()">Retry</button></div></div>`;
  }
})();

export { isAdmin };
