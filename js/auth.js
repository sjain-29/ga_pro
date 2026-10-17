/**
 * Authentication screens: sign-in (username → email mapping), forgot password,
 * one-time administrator bootstrap, forced first-login password change,
 * and demo persona sign-in.
 *
 * Passwords are handled ONLY by Firebase Authentication. Nothing here stores,
 * logs or hard-codes a password.
 */
import { backend } from './db.js';
import { BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL } from './firebase-config.js';
import { templateFor, ROLES } from './permissions.js';
import { DEPARTMENTS } from './demo-data.js';
import { esc, initials } from './format.js';
import { icon, icons, toast, errorMessage, busy, modal } from './ui.js';

const LOGO = `<img class="brand-mark" src="assets/logo.svg" alt="Garuda Aerospace">`;

function shell(root, inner) {
  root.innerHTML = `
  <div class="login">
    <aside class="login-art">
      <div class="grid-lines"></div>
      <div class="brand">${LOGO}<div><div class="brand-name">GARUDA AEROSPACE</div><div class="brand-sub">Project Command Center</div></div></div>
      <div class="login-hero">
        <h1>Projects. Procurement. <em>Profitability.</em> One Platform.</h1>
        <p>Track every Purchase Order from receipt to completion — quotations, expenses, vendor &amp; client payments, deadlines and margins in real time.</p>
      </div>
      <div class="login-feats">
        <div>${icon('radar')}Live deadline monitoring</div>
        <div>${icon('shield-check')}Field-level access control</div>
        <div>${icon('line-chart')}Realtime profitability</div>
      </div>
      <svg class="login-drone" viewBox="0 0 200 120" fill="none" stroke="#fff" stroke-width="3"><circle cx="30" cy="30" r="22"/><circle cx="170" cy="30" r="22"/><circle cx="30" cy="90" r="22"/><circle cx="170" cy="90" r="22"/><path d="M48 44l36 10M152 44l-36 10M48 76l36-10M152 76l-36-10"/><rect x="80" y="46" width="40" height="28" rx="8"/></svg>
    </aside>
    <main class="login-form"><div class="login-box">${inner}</div></main>
  </div>`;
  icons(root);
}

/* ----------------------------------------------------------- sign in */
export function renderLogin(root) {
  if (backend.mode === 'demo') return renderDemoLogin(root);
  shell(root, `
    <h2>Welcome back</h2>
    <p class="sub">Sign in to the Garuda Project Command Center.</p>
    <form id="login-form" novalidate>
      <label class="field"><span>Username or email</span><input class="input" name="user" autocomplete="username" required autocapitalize="none" spellcheck="false"></label>
      <label class="field"><span>Password</span>
        <div class="pw-wrap"><input class="input" name="pw" type="password" autocomplete="current-password" required>
        <button type="button" class="icon-btn" data-eye aria-label="Show password">${icon('eye')}</button></div></label>
      <div id="login-err" class="field-err" role="alert"></div>
      <button class="btn btn-primary btn-block" data-busy="Signing in…">${icon('log-in')}Sign in</button>
      <button type="button" class="link-btn" id="forgot" style="justify-self:center">Forgot password?</button>
    </form>
    <p class="login-foot">${icon('lock', 'small')} Secured by Firebase Authentication · Garuda Aerospace Limited</p>`);
  const form = root.querySelector('#login-form');
  root.querySelector('[data-eye]').onclick = (e) => { const i = form.pw; i.type = i.type === 'password' ? 'text' : 'password'; e.currentTarget.innerHTML = icon(i.type === 'password' ? 'eye' : 'eye-off'); icons(e.currentTarget); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = root.querySelector('#login-err');
    err.textContent = '';
    const user = form.user.value.trim(); const pw = form.pw.value;
    if (!user || !pw) { err.textContent = 'Enter your username and password.'; return; }
    await busy(form.querySelector('.btn-primary'), async () => {
      try {
        const email = await resolveEmail(user);
        if (!email) { err.textContent = 'Incorrect username or password.'; return; }
        await backend.signIn(email, pw);
      } catch (ex) { err.textContent = errorMessage(ex); }
    });
  };
  root.querySelector('#forgot').onclick = () => forgotPassword(form.user.value.trim());
}

/** Map a username to its login email (usernames/{username} is readable per-key only). */
async function resolveEmail(user) {
  if (user.includes('@')) return user;
  const key = user.toLowerCase();
  try {
    const rec = await backend.get(`usernames/${key}`);
    if (rec?.email) return rec.email;
  } catch { /* fall through */ }
  if (key === BOOTSTRAP_ADMIN_USERNAME) return BOOTSTRAP_ADMIN_EMAIL; // before the first admin is claimed
  return null;
}

function forgotPassword(prefill) {
  const m = modal({
    title: 'Reset password', size: 'sm',
    body: `<p class="muted" style="margin-bottom:14px">Enter your username or email. If an account exists, Firebase will email a secure reset link.</p>
      <label class="field"><span>Username or email</span><input class="input" id="fp-user" value="${esc(prefill)}"></label>`,
    footer: `<button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-ok>Send reset link</button>`,
  });
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-ok]').onclick = (e) => busy(e.currentTarget, async () => {
    const email = await resolveEmail(m.el.querySelector('#fp-user').value.trim());
    try { if (email) await backend.sendReset(email); } catch { /* do not reveal whether the account exists */ }
    toast('If the account exists, a reset link has been sent.', 'info');
    m.close();
  });
}

/* ------------------------------------------------------- demo personas */
function renderDemoLogin(root) {
  const people = backend.listPersonas();
  const role = (k) => ROLES.find((r) => r.key === k)?.label || k;
  shell(root, `
    <span class="mode-pill" style="display:inline-block;margin-bottom:12px">Demo mode</span>
    <h2>Explore the Command Center</h2>
    <p class="sub">Firebase is not configured yet, so the app is running on sample data stored only in this browser. Pick a user to see how permissions change what each person can see. No passwords are used in demo mode.</p>
    <div class="persona-list">
      ${people.map((p) => `<button class="persona" data-uid="${esc(p.uid)}" ${p.status !== 'active' ? 'disabled' : ''}>
        <span class="avatar">${esc(initials(p.fullName))}</span>
        <span><b>${esc(p.fullName)}</b><br><span class="muted small">@${esc(p.username)} · ${esc(role(p.role))}</span></span>
        <span class="r">${p.status !== 'active' ? '<span class="badge tone-muted">Inactive</span>' : icon('chevron-right')}</span>
      </button>`).join('')}
    </div>
    <p class="login-foot">To go live, add your Firebase web config in <code>js/firebase-config.js</code> — see README.<br>
    <button class="link-btn" id="reset-demo">Reset demo data</button></p>`);
  root.querySelectorAll('.persona').forEach((b) => { b.onclick = () => backend.signInAs(b.dataset.uid); });
  root.querySelector('#reset-demo').onclick = () => { backend.resetDemo(); toast('Demo data reset.', 'info'); renderDemoLogin(root); };
}

/* --------------------------------------------------- admin bootstrap */
export function renderBootstrap(root, authUser, onDone) {
  shell(root, `
    <h2>One-time administrator setup</h2>
    <p class="sub">You are signed in as <b>${esc(authUser.email)}</b>. No administrator exists yet. Claim this account as the first administrator. This can only happen once — the database rules lock it afterwards.</p>
    <form id="boot-form" class="grid-1" novalidate>
      <label class="field"><span>Full name</span><input class="input" name="fullName" value="Garuda Administrator" required></label>
      <label class="field"><span>Username</span><input class="input" name="username" value="${esc(BOOTSTRAP_ADMIN_USERNAME)}" required autocapitalize="none"></label>
      <div id="boot-err" class="field-err" role="alert"></div>
      <button class="btn btn-primary btn-block" data-busy="Setting up…">${icon('shield-check')}Claim administrator account</button>
      <button type="button" class="btn btn-ghost btn-block" id="boot-out">Sign out</button>
    </form>`);
  const form = root.querySelector('#boot-form');
  root.querySelector('#boot-out').onclick = () => backend.signOut();
  form.onsubmit = (e) => {
    e.preventDefault();
    const username = form.username.value.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) { root.querySelector('#boot-err').textContent = 'Username: 3–30 characters (a–z, 0–9, . _ -).'; return; }
    busy(form.querySelector('.btn-primary'), async () => {
      try {
        const ts = backend.serverTime();
        await backend.update({
          [`users/${authUser.uid}`]: {
            fullName: form.fullName.value.trim(), username, email: authUser.email, department: 'COE', role: 'admin', status: 'active',
            mustChangePassword: true, projectAccess: { all: true }, perms: templateFor('manager'), createdAt: ts,
          },
          [`usernames/${username}`]: { uid: authUser.uid, email: authUser.email },
          'meta/bootstrapped': authUser.uid,
          // Initial organisation setup (only if not already present)
          ...(await backend.get('departments').catch(() => null) ? {} : { departments: Object.fromEntries(DEPARTMENTS.map((d, i) => [d.replace(/\s+/g, '_'), { name: d, active: true, order: i }])) }),
          ...(await backend.get('settings').catch(() => null) ? {} : { settings: { attentionDays: 30, criticalDays: 15, tolerancePaise: 100, companyName: 'Garuda Aerospace Limited' } }),
          'meta/bootstrappedAt': ts,
          [`activityLogs/${backend.pushKey('activityLogs')}`]: { uid: authUser.uid, username, action: 'admin.bootstrap', projectId: '', ts },
        });
        toast('Administrator account created. Please set a new password.', 'success');
        onDone();
      } catch (ex) { root.querySelector('#boot-err').textContent = errorMessage(ex) + ' (Is this email the BOOTSTRAP email in database.rules.json?)'; }
    });
  };
}

/* ------------------------------------------- forced password change */
export function renderChangePassword(root, authUser, profile, onDone) {
  shell(root, `
    <h2>Set a new password</h2>
    <p class="sub">For security, the initial password must be changed before you continue, ${esc(profile.fullName || '')}.</p>
    <form id="pw-form" novalidate>
      <label class="field"><span>Current (initial) password</span><input class="input" name="cur" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>New password</span><input class="input" name="pw1" type="password" autocomplete="new-password" required>
        <small class="field-hint">At least 10 characters with upper- and lower-case letters and a number.</small></label>
      <label class="field"><span>Confirm new password</span><input class="input" name="pw2" type="password" autocomplete="new-password" required></label>
      <div id="pw-err" class="field-err" role="alert"></div>
      <button class="btn btn-primary btn-block" data-busy="Updating…">${icon('key-round')}Update password</button>
      <button type="button" class="btn btn-ghost btn-block" id="pw-out">Sign out</button>
    </form>`);
  const form = root.querySelector('#pw-form');
  root.querySelector('#pw-out').onclick = () => backend.signOut();
  form.onsubmit = (e) => {
    e.preventDefault();
    const err = root.querySelector('#pw-err');
    const { cur, pw1, pw2 } = { cur: form.cur.value, pw1: form.pw1.value, pw2: form.pw2.value };
    err.textContent = passwordProblem(pw1, pw2, cur);
    if (err.textContent) return;
    busy(form.querySelector('.btn-primary'), async () => {
      try {
        await backend.changePassword(cur, pw1);
        await backend.update({ [`users/${authUser.uid}/mustChangePassword`]: false });
        toast('Password updated.', 'success');
        onDone();
      } catch (ex) { err.textContent = errorMessage(ex); }
    });
  };
}

export function passwordProblem(pw1, pw2, cur) {
  if (pw1.length < 10) return 'New password must be at least 10 characters.';
  if (!/[a-z]/.test(pw1) || !/[A-Z]/.test(pw1) || !/\d/.test(pw1)) return 'Use upper- and lower-case letters and at least one number.';
  if (/^garuda/i.test(pw1)) return 'Do not reuse the initial password pattern.';
  if (pw1 === cur) return 'The new password must be different.';
  if (pw1 !== pw2) return 'Passwords do not match.';
  return '';
}

export function renderBlocked(root, title, message) {
  shell(root, `<h2>${esc(title)}</h2><p class="sub">${message}</p><button class="btn btn-ghost btn-block" id="bl-out">${icon('log-out')}Sign out</button>`);
  root.querySelector('#bl-out').onclick = () => backend.signOut();
}
