/** Settings: departments, deadline thresholds, tolerance, account, system info. */
import { state, saveSettings, saveDepartment } from '../store.js';
import { backend } from '../db.js';
import { firebaseConfig, CLOUD_FUNCTIONS_DEPLOYED } from '../firebase-config.js';
import { isAdmin } from '../permissions.js';
import { esc, money } from '../format.js';
import { icon, icons, toast, errorMessage, busy, modal, confirmDialog, fieldError } from '../ui.js';
import { passwordProblem } from '../auth.js';

export function mount(el) {
  const admin = isAdmin(state.profile);
  function render() {
    const s = state.settings;
    const depts = [...state.departments];
    el.innerHTML = `<div class="page-head"><div><h1>Settings</h1><div class="sub">${admin ? 'Organisation-wide configuration and your account.' : 'Your account preferences.'}</div></div></div>
    <div class="settings-grid">
      ${admin ? `<section class="card"><div class="card-head"><h3>${icon('building')}Departments</h3><button class="btn btn-sm btn-navy" id="d-add">${icon('plus')}Add</button></div>
        <div class="card-body">${depts.map((d) => `<div class="dept-row"><span class="name">${esc(d.name)}</span>${d.active === false ? '<span class="badge tone-muted">Inactive</span>' : '<span class="badge tone-green">Active</span>'}
          <label class="switch" title="${d.active === false ? 'Activate' : 'Deactivate'}"><input type="checkbox" data-dept="${esc(d.key)}" ${d.active !== false ? 'checked' : ''}></label></div>`).join('')}
          <p class="note">${icon('info')}Inactive departments disappear from new-project forms but stay on historical projects and reports. Departments are listed alphabetically.</p></div></section>
      <section class="card"><div class="card-head"><h3>${icon('alarm-clock')}Deadline thresholds</h3></div><div class="card-body"><form id="th" class="grid-2" novalidate>
          <label class="field"><span>Attention (yellow) when ≤ days</span><input class="input" type="number" min="2" max="365" name="attentionDays" value="${s.attentionDays}"></label>
          <label class="field"><span>Critical (orange) when ≤ days</span><input class="input" type="number" min="1" max="364" name="criticalDays" value="${s.criticalDays}"></label>
          <label class="field span-2"><span>Payment "Complete" tolerance (₹)</span><input class="input" type="number" min="0" max="10000" step="0.01" name="tol" value="${(s.tolerancePaise / 100).toFixed(2)}"><small class="field-hint">Balances within ± this amount count as fully paid / reconciled.</small></label>
          <div class="span-2 small muted">More than ${s.attentionDays} days → On Track · ${s.criticalDays + 1}–${s.attentionDays} → Attention · 1–${s.criticalDays} → Critical · 0 → Due Today · past → Overdue. Asia/Kolkata time.</div>
          <div class="span-2"><button class="btn btn-primary">${icon('save')}Save thresholds</button></div></form></div></section>` : ''}
      <section class="card"><div class="card-head"><h3>${icon('user-round')}My account</h3></div><div class="card-body">
        <div class="kv"><span class="k">Name</span><span class="v">${esc(state.profile.fullName)}</span></div>
        <div class="kv"><span class="k">Username</span><span class="v">@${esc(state.profile.username)}</span></div>
        <div class="kv"><span class="k">Email</span><span class="v">${esc(state.profile.email)}</span></div>
        <div class="kv"><span class="k">Theme</span><span class="v"><label class="switch"><input type="checkbox" id="dark" ${document.documentElement.dataset.theme === 'dark' ? 'checked' : ''}> Dark mode</label></span></div>
        <div class="mod-actions">${backend.mode === 'firebase' ? `<button class="btn btn-sm btn-ghost" id="chpw">${icon('key-round')}Change password</button>` : ''}<button class="btn btn-sm btn-ghost" id="logout">${icon('log-out')}Sign out</button></div>
      </div></section>
      <section class="card"><div class="card-head"><h3>${icon('server')}System</h3></div><div class="card-body">
        <div class="kv"><span class="k">Data mode</span><span class="v">${backend.mode === 'demo' ? '<span class="badge tone-yellow">Demo (this browser only)</span>' : '<span class="badge tone-green">Firebase (live)</span>'}</span></div>
        <div class="kv"><span class="k">Realtime Database</span><span class="v small mono" style="word-break:break-all">${esc(firebaseConfig.databaseURL.replace('https://', ''))}</span></div>
        <div class="kv"><span class="k">Profit summaries</span><span class="v">${CLOUD_FUNCTIONS_DEPLOYED ? 'Cloud Functions' : 'Admin browser'}</span></div>
        <div class="kv"><span class="k">Money storage</span><span class="v">Integer paise (no rounding errors)</span></div>
        <div class="kv"><span class="k">Time zone</span><span class="v">Asia/Kolkata · FY Apr–Mar</span></div>
        ${backend.mode === 'demo' && admin ? `<div class="mod-actions"><button class="btn btn-sm btn-danger" id="reset-demo">${icon('rotate-ccw')}Reset demo data</button></div>` : ''}
      </div></section>
    </div>`;
    wire();
    icons(el);
  }
  function wire() {
    el.querySelector('#dark').onchange = () => document.querySelector('#btn-theme')?.click();
    el.querySelector('#logout').onclick = () => backend.signOut();
    el.querySelector('#chpw')?.addEventListener('click', changePassword);
    el.querySelector('#reset-demo')?.addEventListener('click', async () => { if (await confirmDialog({ title: 'Reset demo data?', message: 'All demo changes in this browser will be replaced with the original sample data.', danger: true, confirmText: 'Reset' })) { backend.resetDemo(); toast('Demo data reset.'); } });
    if (!admin) return;
    el.querySelector('#d-add').onclick = addDept;
    el.querySelectorAll('[data-dept]').forEach((c) => { c.onchange = async () => {
      const d = state.departments.find((x) => x.key === c.dataset.dept);
      try { await saveDepartment(d.key, { name: d.name, active: c.checked, order: d.order ?? 0 }, false); toast(`${d.name} ${c.checked ? 'activated' : 'deactivated'}.`); } catch (e) { c.checked = !c.checked; toast(errorMessage(e), 'error'); }
    }; });
    const th = el.querySelector('#th');
    th.onsubmit = (e) => { e.preventDefault(); busy(th.querySelector('button'), async () => {
      const a = Number(th.attentionDays.value), c = Number(th.criticalDays.value), tol = Math.round(Number(th.tol.value) * 100);
      fieldError(th, 'criticalDays', !(c >= 1 && c < a) ? 'Critical must be at least 1 and less than Attention.' : '');
      fieldError(th, 'attentionDays', !(a >= 2 && a <= 365) ? 'Between 2 and 365.' : '');
      fieldError(th, 'tol', !(tol >= 0 && tol <= 1000000) ? 'Enter 0–10,000.' : '');
      if (!(c >= 1 && c < a && a <= 365 && tol >= 0 && tol <= 1000000)) return;
      try { await saveSettings({ attentionDays: a, criticalDays: c, tolerancePaise: tol }); toast(`Thresholds saved (tolerance ${money(tol)}).`); } catch (ex) { toast(errorMessage(ex), 'error'); }
    }); };
  }
  function addDept() {
    const m = modal({ title: 'Add department', size: 'sm', body: '<label class="field"><span>Department name</span><input class="input" id="dn" maxlength="40"></label>', footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok>Add</button>` });
    m.el.querySelector('[data-x]').onclick = m.close;
    m.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
      const name = m.el.querySelector('#dn').value.trim();
      if (!name) return;
      if (state.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) { toast('That department already exists.', 'error'); return; }
      const key = name.replace(/[.#$[\]/\s]+/g, '_');
      try { await saveDepartment(key, { name, active: true, order: state.departments.length }, true); toast(`${name} added.`); m.close(); } catch (ex) { toast(errorMessage(ex), 'error'); }
    });
  }
  function changePassword() {
    const m = modal({ title: 'Change password', size: 'sm', body: `<form id="cp" novalidate style="display:grid;gap:12px">
      <label class="field"><span>Current password</span><input class="input" type="password" name="cur" autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input class="input" type="password" name="p1" autocomplete="new-password"></label>
      <label class="field"><span>Confirm new password</span><input class="input" type="password" name="p2" autocomplete="new-password"></label>
      <div class="field-err" id="cperr"></div></form>`, footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok>Update</button>` });
    m.el.querySelector('[data-x]').onclick = m.close;
    m.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
      const f = m.el.querySelector('#cp'); const err = m.el.querySelector('#cperr');
      err.textContent = passwordProblem(f.p1.value, f.p2.value, f.cur.value); if (err.textContent) return;
      try { await backend.changePassword(f.cur.value, f.p1.value); toast('Password updated.'); m.close(); } catch (ex) { err.textContent = errorMessage(ex); }
    });
  }
  render();
  return { update: () => { if (!el.querySelector('input:focus')) render(); } };
}
