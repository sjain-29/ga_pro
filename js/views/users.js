/** User Management (administrators only) */
import { state, projects, createUser, updateUser, setUserStatus, resetPassword, activeDepartments } from '../store.js';
import { backend } from '../db.js';
import { DOMAINS, FEATURES, MODULES, ROLES, templateFor, isAdmin } from '../permissions.js';
import { esc, initials, relTime } from '../format.js';
import { icon, icons, badge, toast, errorMessage, drawer, confirmDialog, busy, formData, fieldError, options, empty, debounce } from '../ui.js';
import { passwordProblem } from '../auth.js';

const f = { q: '', role: '', status: '' };

export function mount(el) {
  if (!isAdmin(state.profile)) { el.innerHTML = empty('Administrators only', '', 'lock'); return {}; }
  el.innerHTML = `<div class="page-head"><div><h1>User Management</h1><div class="sub">Create users, assign projects and control exactly which fields each person can view or edit.</div></div>
    <div class="page-actions"><button class="btn btn-primary" id="u-new">${icon('user-plus')}Create user</button></div></div>
    <div class="filters"><div class="search">${icon('search')}<input class="input" id="uq" placeholder="Search name, username, email" value="${esc(f.q)}"></div>
    <select class="input" data-k="role"><option value="">All roles</option>${options(ROLES.map((r) => ({ value: r.key, label: r.label })), f.role)}</select>
    <select class="input" data-k="status"><option value="">All statuses</option>${options([{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }], f.status)}</select></div>
    <section class="card"><div class="card-body" id="ul"></div></section>
    <div class="info-box" style="margin-top:14px">${icon('shield-check')}<div>Permissions are enforced by Firebase Security Rules on the server, not just hidden in the browser. A user without a permission cannot read that data through developer tools, the SDK, REST calls or exports.</div></div>`;
  el.querySelector('#u-new').onclick = () => openUserForm(null);
  el.querySelector('#uq').oninput = debounce((e) => { f.q = e.target.value; update(); }, 150);
  el.querySelectorAll('[data-k]').forEach((s) => { s.onchange = () => { f[s.dataset.k] = s.value; update(); }; });

  function update() {
    const q = f.q.toLowerCase();
    const users = Object.entries(state.users || {}).map(([uid, u]) => ({ uid, ...u }))
      .filter((u) => (!f.role || u.role === f.role) && (!f.status || u.status === f.status) && (!q || `${u.fullName} ${u.username} ${u.email}`.toLowerCase().includes(q)))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const host = el.querySelector('#ul');
    if (!state.loaded.users) { host.innerHTML = '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>'; return; }
    host.innerHTML = users.length ? `<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>User</th><th>Role</th><th>Department</th><th>Projects</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td data-l="User"><div style="display:flex;gap:10px;align-items:center"><span class="avatar" style="width:32px;height:32px;font-size:12px">${esc(initials(u.fullName))}</span><div><b>${esc(u.fullName)}</b><div class="small muted">@${esc(u.username)} · ${esc(u.email)}</div></div></div></td>
        <td data-l="Role">${badge(ROLES.find((r) => r.key === u.role)?.label || u.role, u.role === 'admin' ? 'red' : 'navy')}</td><td data-l="Department">${esc(u.department || '—')}</td>
        <td data-l="Projects">${u.role === 'admin' || u.projectAccess?.all ? 'All projects' : `${Object.keys(u.projectAccess?.ids || {}).length} assigned`}</td>
        <td data-l="Status">${badge(u.status === 'active' ? 'Active' : 'Inactive')}${u.mustChangePassword ? ' <span class="badge tone-yellow" title="Must change password at next login">Pwd change</span>' : ''}</td>
        <td data-l="Last login" class="small">${u.lastLoginAt ? relTime(u.lastLoginAt) : 'Never'}</td>
        <td class="user-row-actions"><button class="btn btn-sm btn-ghost" data-edit="${u.uid}">${icon('pencil')}Edit</button>
          ${u.uid !== state.uid ? `<button class="btn btn-sm btn-ghost" data-toggle="${u.uid}">${icon(u.status === 'active' ? 'user-x' : 'user-check')}${u.status === 'active' ? 'Deactivate' : 'Activate'}</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-reset="${u.uid}" title="Send password reset email">${icon('key-round')}</button></td></tr>`).join('')}
      </tbody></table></div>` : empty('No users found', '', 'users');
    host.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openUserForm(b.dataset.edit); });
    host.querySelectorAll('[data-toggle]').forEach((b) => { b.onclick = async () => {
      const u = { uid: b.dataset.toggle, ...state.users[b.dataset.toggle] }; const next = u.status === 'active' ? 'inactive' : 'active';
      if (next === 'inactive' && !(await confirmDialog({ title: `Deactivate ${esc(u.fullName)}?`, message: 'They will be signed out and blocked from reading any data immediately (enforced by database rules). You can reactivate them later.', confirmText: 'Deactivate', danger: true }))) return;
      try { await setUserStatus(u.uid, u, next); toast(`${u.fullName} ${next === 'active' ? 'activated' : 'deactivated'}.`); } catch (e) { toast(errorMessage(e), 'error'); }
    }; });
    host.querySelectorAll('[data-reset]').forEach((b) => { b.onclick = async () => {
      const u = { uid: b.dataset.reset, ...state.users[b.dataset.reset] };
      if (!(await confirmDialog({ title: 'Send password reset?', message: `A secure reset link will be emailed to <b>${esc(u.email)}</b> by Firebase Authentication. Administrators never see user passwords.`, confirmText: 'Send reset email' }))) return;
      try { await resetPassword(u); toast(backend.mode === 'demo' ? 'Demo mode: reset email simulated.' : 'Password reset email sent.'); } catch (e) { toast(errorMessage(e), 'error'); }
    }; });
    icons(host);
  }
  update();
  return { update };
}

function openUserForm(uid) {
  const before = uid ? { uid, ...state.users[uid] } : null;
  const isSelf = uid === state.uid;
  const u = before || { fullName: '', username: '', email: '', department: '', role: 'viewer', status: 'active', projectAccess: { all: true }, perms: templateFor('viewer'), modules: {} };
  const draft = JSON.parse(JSON.stringify(u));
  draft.perms = { ...templateFor(draft.role === 'admin' ? 'manager' : draft.role), ...(draft.perms || {}) };
  draft.projectAccess = draft.projectAccess || { all: true };
  draft.modules = draft.modules || {};
  let tab = 'profile';
  const d = drawer({ title: before ? `Edit user · ${before.fullName}` : 'Create user', size: 'lg', body: '<div class="tabs" id="ut"></div><div id="ub"></div>',
    footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok>${icon('save')}${before ? 'Save user' : 'Create user'}</button>` });
  const tabs = [['profile', 'Profile'], ['projects', 'Project access'], ['modules', 'Module access'], ['perms', 'Field permissions']];
  const tabHost = d.el.querySelector('#ut'), body = d.el.querySelector('#ub');
  const isAdm = () => draft.role === 'admin';

  function capture() {
    const form = body.querySelector('form'); if (!form) return;
    if (tab === 'profile') Object.assign(draft, formData(form));
    if (tab === 'projects') {
      draft.projectAccess = { all: form.querySelector('[name=pa_all]').checked, ids: {} };
      form.querySelectorAll('[data-pid]:checked').forEach((c) => { draft.projectAccess.ids[c.dataset.pid] = true; });
    }
    if (tab === 'modules') { draft.modules = {}; form.querySelectorAll('[data-mod]').forEach((c) => { if (!c.checked) draft.modules[c.dataset.mod] = false; }); }
    if (tab === 'perms') form.querySelectorAll('[data-perm]').forEach((c) => { const [k, a] = c.dataset.perm.split('.'); draft.perms[k] = draft.perms[k] || {}; draft.perms[k][a] = c.checked; });
  }
  function render() {
    tabHost.innerHTML = tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('');
    tabHost.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { capture(); tab = b.dataset.t; render(); }; });
    if (tab === 'profile') {
      body.innerHTML = `<form class="grid-2" novalidate>
        <label class="field"><span>Full name <b class="req">*</b></span><input class="input" name="fullName" value="${esc(draft.fullName)}" maxlength="100"></label>
        <label class="field"><span>Username <b class="req">*</b></span><input class="input" name="username" value="${esc(draft.username)}" maxlength="30" autocapitalize="none"><small class="field-hint">Used to sign in. a–z, 0–9, . _ -</small></label>
        <label class="field"><span>Email address <b class="req">*</b></span><input class="input" type="email" name="email" value="${esc(draft.email)}" ${before ? 'readonly' : ''}><small class="field-hint">${before ? 'Login email can be changed in Firebase Console → Authentication.' : 'Password-setup and reset emails are sent here.'}</small></label>
        <label class="field"><span>Department</span><select class="input" name="department"><option value="">—</option>${options([...new Set([...activeDepartments().map((x) => x.name), draft.department].filter(Boolean))], draft.department)}</select></label>
        <label class="field"><span>Role</span><select class="input" name="role" ${isSelf ? 'disabled' : ''}>${options(ROLES.map((r) => ({ value: r.key, label: r.label })), draft.role)}</select><small class="field-hint">Choosing a role pre-fills the permission matrix; you can then adjust any cell.</small></label>
        <label class="field"><span>Account status</span><select class="input" name="status" ${isSelf ? 'disabled' : ''}>${options([{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }], draft.status)}</select></label>
        ${before ? '' : `<div class="field span-2"><span>Initial password</span>
          <label class="check"><input type="radio" name="passwordMode" value="reset" ${draft.passwordMode !== 'temp' ? 'checked' : ''}> Email a secure password-setup link (recommended — nobody else knows the password)</label>
          <label class="check"><input type="radio" name="passwordMode" value="temp" ${draft.passwordMode === 'temp' ? 'checked' : ''}> Set a temporary password (user must change it at first login)</label>
          <input class="input ${draft.passwordMode === 'temp' ? '' : 'hidden'}" type="password" name="tempPassword" placeholder="Temporary password (min 10 chars, Aa1)" autocomplete="new-password" value="${esc(draft.tempPassword || '')}"></div>`}
      </form>`;
      const role = body.querySelector('[name=role]');
      if (role) role.onchange = async () => {
        if (role.value === 'admin' || (await confirmDialog({ title: 'Apply role template?', message: `Replace the current field permissions with the default template for <b>${esc(ROLES.find((r) => r.key === role.value).label)}</b>?`, confirmText: 'Apply template' }))) draft.perms = templateFor(role.value === 'admin' ? 'manager' : role.value);
        draft.role = role.value;
      };
      body.querySelectorAll('[name=passwordMode]').forEach((r) => { r.onchange = () => body.querySelector('[name=tempPassword]').classList.toggle('hidden', r.value !== 'temp' || !r.checked); });
    }
    if (tab === 'projects') {
      const list = projects({ includeArchived: true }).sort((a, b) => a.id.localeCompare(b.id));
      body.innerHTML = `<form>${isAdm() ? `<div class="info-box">${icon('shield')}Administrators always have access to every project.</div>` : ''}
        <label class="switch" style="margin:4px 0 14px"><input type="checkbox" name="pa_all" ${draft.projectAccess.all || isAdm() ? 'checked' : ''} ${isAdm() ? 'disabled' : ''}> <b>All projects</b> (current and future)</label>
        <div id="pp" class="${draft.projectAccess.all || isAdm() ? 'hidden' : ''}"><input class="input" id="pps" placeholder="Filter projects…" style="margin-bottom:8px">
        <div class="proj-pick">${list.map((p) => `<label class="check" data-row="${esc(`${p.id} ${p.basic.description} ${p.basic.department}`.toLowerCase())}"><input type="checkbox" data-pid="${esc(p.id)}" ${draft.projectAccess.ids?.[p.id] ? 'checked' : ''}><span class="pid">${esc(p.id)}</span> <span class="small">${esc(p.basic.description)}</span></label>`).join('')}</div>
        <small class="field-hint">The user can only read data for the projects ticked here — enforced per project by the database rules.</small></div></form>`;
      body.querySelector('[name=pa_all]').onchange = (e) => body.querySelector('#pp').classList.toggle('hidden', e.target.checked);
      body.querySelector('#pps').oninput = (e) => { const q = e.target.value.toLowerCase(); body.querySelectorAll('[data-row]').forEach((r) => { r.style.display = r.dataset.row.includes(q) ? '' : 'none'; }); };
    }
    if (tab === 'modules') {
      body.innerHTML = `<form><p class="muted small" style="margin-bottom:12px">Hide navigation sections for this user. A module only appears if the user also has view permission for the data it needs (Field permissions tab).</p>
        <div style="display:grid;gap:10px">${MODULES.filter((m) => !m.adminOnly && m.key !== 'dashboard').map((m) => `<label class="switch"><input type="checkbox" data-mod="${m.key}" ${draft.modules[m.key] !== false ? 'checked' : ''} ${isAdm() ? 'disabled' : ''}>${icon(m.icon)} ${esc(m.label)}</label>`).join('')}</div></form>`;
    }
    if (tab === 'perms') {
      const row = (k, label, hint, opts = {}) => `<tr><td><div class="pl">${esc(label)}</div><div class="ph">${esc(hint)}</div></td>
        <td><input type="checkbox" data-perm="${k}.view" ${isAdm() || draft.perms[k]?.view ? 'checked' : ''} ${isAdm() ? 'disabled' : ''} aria-label="${esc(label)} view"></td>
        <td>${opts.viewOnly ? '<span class="muted small">—</span>' : `<input type="checkbox" data-perm="${k}.edit" ${isAdm() || draft.perms[k]?.edit ? 'checked' : ''} ${isAdm() ? 'disabled' : ''} aria-label="${esc(label)} edit">`}</td>
        <td>${opts.create ? `<input type="checkbox" data-perm="${k}.create" ${isAdm() || draft.perms[k]?.create ? 'checked' : ''} ${isAdm() ? 'disabled' : ''} aria-label="${esc(label)} create">` : '<span class="muted small">—</span>'}</td></tr>`;
      body.innerHTML = `<form>${isAdm() ? `<div class="info-box" style="margin-bottom:12px">${icon('shield')}Administrators have full access to every field.</div>` : ''}
        <div class="filters" style="margin-bottom:10px"><span class="small muted">Quick set:</span><button type="button" class="btn btn-sm btn-ghost" data-q="viewall">View all</button><button type="button" class="btn btn-sm btn-ghost" data-q="none">Clear all</button></div>
        <div class="table-wrap"><table class="perm-matrix"><thead><tr><th>Field / data</th><th>View</th><th>Edit</th><th>Create</th></tr></thead><tbody>
        <tr class="group"><td colspan="4">Project</td></tr>${DOMAINS.filter((x) => ['basic', 'client', 'po'].includes(x.key)).map((x) => row(x.key, x.label, x.hint, x)).join('')}
        <tr class="group"><td colspan="4">Procurement &amp; payments</td></tr>${DOMAINS.filter((x) => ['quotations', 'vendor', 'clientPay'].includes(x.key)).map((x) => row(x.key, x.label, x.hint, x)).join('')}
        <tr class="group"><td colspan="4">Expenses</td></tr>${DOMAINS.filter((x) => ['purchase', 'transport', 'pilot', 'other'].includes(x.key)).map((x) => row(x.key, x.label, x.hint, x)).join('')}
        <tr class="group"><td colspan="4">Profitability &amp; collaboration</td></tr>${DOMAINS.filter((x) => ['profit', 'comments', 'files'].includes(x.key)).map((x) => row(x.key, x.label, x.hint, x)).join('')}
        <tr class="group"><td colspan="4">Features</td></tr>${FEATURES.map((x) => row(x.key, x.label, x.hint, { viewOnly: true })).join('')}
        </tbody></table></div><p class="note">${icon('info')}Edit implies the user can change values; they also need View. Profit is calculated, so it is view-only.</p></form>`;
      body.querySelectorAll('[data-perm$=".edit"],[data-perm$=".create"]').forEach((c) => { c.addEventListener('change', () => { if (c.checked) { const v = body.querySelector(`[data-perm="${c.dataset.perm.split('.')[0]}.view"]`); if (v) v.checked = true; } }); });
      body.querySelectorAll('[data-perm$=".view"]').forEach((c) => { c.addEventListener('change', () => { if (!c.checked) body.querySelectorAll(`[data-perm^="${c.dataset.perm.split('.')[0]}."]`).forEach((x) => { x.checked = false; }); }); });
      body.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => body.querySelectorAll('[data-perm]').forEach((c) => { c.checked = b.dataset.q === 'viewall' ? (c.dataset.perm.endsWith('.view') || c.checked) : false; }); });
    }
    icons(d.el);
  }
  render();
  d.el.querySelector('[data-x]').onclick = d.close;
  d.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
    capture();
    draft.username = (draft.username || '').trim().toLowerCase();
    draft.email = (draft.email || '').trim().toLowerCase();
    const problems = [];
    if (!draft.fullName) problems.push(['fullName', 'Full name is required.']);
    if (!/^[a-z0-9._-]{3,30}$/.test(draft.username)) problems.push(['username', 'Username: 3–30 characters (a–z, 0–9, . _ -).']);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) problems.push(['email', 'Enter a valid email address.']);
    if (!before && draft.passwordMode === 'temp') { const pp = passwordProblem(draft.tempPassword || '', draft.tempPassword || '', ''); if (pp) problems.push(['tempPassword', pp]); }
    if (problems.length) {
      tab = 'profile'; render();
      const form = body.querySelector('form'); problems.forEach(([n, m]) => fieldError(form, n, m));
      return;
    }
    if (!draft.projectAccess.all && !Object.keys(draft.projectAccess.ids || {}).length && draft.role !== 'admin') {
      if (!(await confirmDialog({ title: 'No projects assigned', message: 'This user will not see any projects until you assign some. Continue?', confirmText: 'Save anyway' }))) return;
    }
    const clean = {
      fullName: draft.fullName, username: draft.username, email: draft.email, department: draft.department || '', role: draft.role, status: draft.status,
      projectAccess: draft.role === 'admin' ? { all: true } : { all: !!draft.projectAccess.all, ...(draft.projectAccess.all ? {} : { ids: draft.projectAccess.ids || {} }) },
      perms: Object.fromEntries(Object.entries(draft.perms).map(([k, v]) => [k, { view: !!v.view, edit: !!v.edit, ...(v.create !== undefined ? { create: !!v.create } : {}) }])),
      modules: draft.modules, passwordMode: draft.passwordMode || 'reset', tempPassword: draft.tempPassword,
    };
    try {
      if (before) { await updateUser(uid, before, clean); toast('User updated. Changes apply immediately.'); }
      else { await createUser(clean); toast(clean.passwordMode === 'temp' ? `User ${clean.username} created with a temporary password.` : `User ${clean.username} created. A password-setup email has been sent${backend.mode === 'demo' ? ' (simulated in demo)' : ''}.`); }
      d.close();
    } catch (ex) { toast(errorMessage(ex), 'error'); }
  });
}
