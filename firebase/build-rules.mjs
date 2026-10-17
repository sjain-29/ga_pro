/**
 * Generates firebase/database.rules.json from the single permission model in
 * js/permissions.js, so UI permissions and server-side rules can never drift.
 *
 *   node firebase/build-rules.mjs
 *
 * Model:
 *  • Each access domain is a separate top-level path keyed by Project ID.
 *  • Read  = admin, OR active user with domain.view AND project access.
 *  • Write = admin, OR active user with domain.edit AND project access.
 *  • Listing a whole path (all projects) additionally needs projectAccess.all.
 *  • Inactive users can read nothing.
 *  • Money is validated as integer paise; timestamps must equal server time.
 */
import { writeFileSync } from 'node:fs';
import { DOMAINS } from '../js/permissions.js';
import { BOOTSTRAP_ADMIN_EMAIL } from '../js/firebase-config.js';

const ME = "root.child('users').child(auth.uid)";
const ACTIVE = `(auth != null && ${ME}.child('status').val() === 'active')`;
const ADMIN = `(${ACTIVE} && ${ME}.child('role').val() === 'admin')`;
const ALLP = `${ME}.child('projectAccess').child('all').val() === true`;
const PROJ = `(${ALLP} || ${ME}.child('projectAccess').child('ids').child($pid).val() === true)`;
const CAN = (d, a) => `${ME}.child('perms').child('${d}').child('${a}').val() === true`;
const BOOT = `(auth != null && !root.child('meta').child('bootstrapped').exists() && auth.token.email === '${BOOTSTRAP_ADMIN_EMAIL}')`;

/* -------------------------------------------------------- validators */
const str = (max, min = 0) => ({ '.validate': `newData.isString() && newData.val().length >= ${min} && newData.val().length <= ${max}` });
const bool = { '.validate': 'newData.isBoolean()' };
const DATE_RE = '/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/';
const dateOrEmpty = { '.validate': `newData.isString() && (newData.val() === '' || newData.val().matches(${DATE_RE}))` };
const date = { '.validate': `newData.isString() && newData.val().matches(${DATE_RE})` };
const int = (min, max = 1e15) => ({ '.validate': `newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= ${min} && newData.val() <= ${max}` });
const oneOf = (list) => ({ '.validate': `newData.isString() && newData.val().matches(/^(${list.join('|')})$/)` });
const stamp = { '.validate': 'newData.val() === now || newData.val() === data.val()' };
const byMe = { '.validate': 'newData.val() === auth.uid || newData.val() === data.val()' };
const created = { createdAt: { '.validate': '(!data.exists() && newData.val() === now) || newData.val() === data.val()' }, createdBy: { '.validate': '(!data.exists() && newData.val() === auth.uid) || newData.val() === data.val()' } };
const updated = { updatedAt: stamp, updatedBy: byMe };
const deny = { $other: { '.validate': false } };

/** A transaction list (payments, receipts, expenses, deductions). Entries are voided, never deleted (except by admins). */
const txnList = (extra = {}, kinds = ['payment', 'receipt', 'expense', 'refund', 'deduction', 'reversal']) => ({
  $tid: {
    '.validate': `newData.hasChildren(['amount', 'date']) && (data.exists() || !newData.child('void').exists())`,
    amount: int(1), date, kind: oneOf(kinds), ref: str(80), remarks: str(300), desc: str(200), vendor: str(120),
    void: { '.validate': `newData.isBoolean() && (newData.val() === true || ${ADMIN})` }, voidReason: str(200), voidedBy: byMe, voidedAt: stamp,
    editedAt: stamp, editedBy: byMe, ...created, ...extra, ...deny,
  },
  '.write': `${ADMIN}`, // removing a whole list is admin-only (edits happen at $pid level)
});
txnList.noWrite = (x, k) => { const t = txnList(x, k); delete t['.write']; return t; };

const SCHEMA = {
  basic: {
    '.validate': `$pid.matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/) && newData.hasChildren(['projectId', 'description', 'clientName', 'department', 'status'])`,
    projectId: { '.validate': 'newData.val() === $pid' }, description: str(1000, 1), clientName: str(200, 1), department: str(40, 1),
    status: oneOf(['Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled']), poDate: dateOrEmpty, endDate: dateOrEmpty, remarks: str(2000),
    archived: bool,
    deleted: { '.validate': `newData.isBoolean() && (${ADMIN} || newData.val() === data.val() || (!data.exists() && newData.val() === false))` },
    deletedAt: { '.validate': `${ADMIN}` }, deletedBy: { '.validate': `${ADMIN} && newData.val() === auth.uid` },
    ...created, ...updated, ...deny,
  },
  client: { contactPerson: str(120), email: str(120), phone: str(30), ...updated, ...deny },
  po: {
    poValue: int(0), gstMode: oneOf(['inclusive', 'exclusive']), gstPercentBp: int(0, 4000), receivableAdjust: int(-1e15),
    clientDueDate: dateOrEmpty, tdsTreatment: oneOf(['credit', 'expense']), ...updated, ...deny,
  },
  quotations: {
    ...Object.fromEntries(['q1', 'q2', 'q3'].map((q) => [q, { amount: int(0), vendor: str(120), ref: str(80), ...deny }])),
    approvedValue: int(0), ...updated, ...deny,
  },
  vendor: { approvedPayable: int(1), completedFlag: bool, txns: txnList.noWrite({}, ['payment', 'refund']), ...updated, ...deny },
  purchase: { txns: txnList.noWrite({}, ['expense', 'refund']), ...updated, ...deny },
  transport: { txns: txnList.noWrite({}, ['expense', 'refund']), ...updated, ...deny },
  pilot: { txns: txnList.noWrite({}, ['expense', 'refund']), ...updated, ...deny },
  other: { txns: txnList.noWrite({}, ['expense', 'refund']), ...updated, ...deny },
  clientPay: {
    receipts: txnList.noWrite({}, ['receipt', 'refund']),
    deductions: txnList.noWrite({ type: oneOf(['LD', 'TDS', 'ADJ']) }, ['deduction', 'reversal']),
    ...updated, ...deny,
  },
  profit: { projectedProfit: int(-1e15), adjustedProfit: int(-1e15), marginBp: int(-1e9, 1e9), costOverrun: bool, computedAt: { '.validate': 'newData.isNumber()' }, ...deny },
};

const rules = {
  '.read': false,
  '.write': false,

  meta: {
    '.read': 'auth != null',
    bootstrapped: { '.write': BOOT, '.validate': 'newData.val() === auth.uid' },
    bootstrappedAt: { '.write': BOOT, '.validate': 'newData.val() === now' },
    $other: { '.write': ADMIN },
  },

  users: {
    '.read': ADMIN,
    '.indexOn': ['username', 'email', 'status'],
    $uid: {
      '.read': `auth != null && (auth.uid === $uid || ${ADMIN})`,
      '.write': `${ADMIN} || (${BOOT} && auth.uid === $uid && newData.child('role').val() === 'admin' && newData.parent().parent().child('meta').child('bootstrapped').val() === auth.uid)`,
      '.validate': "newData.hasChildren(['fullName', 'username', 'email', 'role', 'status'])",
      fullName: str(100, 1), username: { '.validate': 'newData.isString() && newData.val().matches(/^[a-z0-9._-]{3,30}$/)' }, email: str(120, 3), department: str(40),
      role: { '.validate': "newData.isString() && newData.val().matches(/^(admin|manager|finance|procurement|projects|viewer)$/) && (auth.uid !== $uid || !data.exists() || newData.val() === data.val())" },
      status: { '.validate': "(newData.val() === 'active' || newData.val() === 'inactive') && (auth.uid !== $uid || newData.val() === 'active')" },
      mustChangePassword: { '.write': 'auth != null && auth.uid === $uid && newData.val() === false', '.validate': 'newData.isBoolean()' },
      lastLoginAt: { '.write': 'auth != null && auth.uid === $uid', '.validate': 'newData.val() === now' },
      prefs: { '.write': 'auth != null && auth.uid === $uid' },
      projectAccess: { all: bool, ids: { $pid: { '.validate': 'newData.val() === true' } }, ...deny },
      perms: { $perm: { view: bool, edit: bool, create: bool, ...deny } },
      modules: { $mod: { '.validate': 'newData.isBoolean()' } },
      createdAt: stamp, createdBy: byMe, updatedAt: stamp, updatedBy: byMe,
      ...deny,
    },
  },

  // username → login email mapping. Readable one key at a time (needed before sign-in); the list itself cannot be enumerated.
  usernames: {
    $username: {
      '.read': true,
      '.write': `${ADMIN} || (${BOOT} && newData.child('uid').val() === auth.uid)`,
      '.validate': "$username.matches(/^[a-z0-9._-]{3,30}$/) && newData.hasChildren(['uid', 'email'])",
      uid: { '.validate': 'newData.isString()' }, email: str(120, 3), ...deny,
    },
  },

  settings: {
    '.read': ACTIVE, '.write': `${ADMIN} || ${BOOT}`,
    attentionDays: int(2, 365), criticalDays: int(1, 364), tolerancePaise: int(0, 1000000), companyName: str(120),
    $other: { '.validate': true },
  },
  departments: { '.read': ACTIVE, '.write': `${ADMIN} || ${BOOT}`, $key: { name: str(40, 1), active: bool, order: int(0, 1000), ...deny } },

  // Existence index used for duplicate Project ID checks without exposing project data.
  projectIndex: {
    $pid: {
      '.read': ACTIVE,
      '.write': `${ADMIN} || (${ACTIVE} && ${CAN('basic', 'create')} && !data.exists() && newData.val() === true)`,
      '.validate': 'newData.val() === true',
    },
  },

  activityLogs: {
    '.read': `${ADMIN} || (${ACTIVE} && ${CAN('audit', 'view')})`,
    '.indexOn': ['ts', 'projectId', 'uid', 'action'],
    $id: {
      // Append-only: create once, never update or delete (also not by admins).
      '.write': `(${ACTIVE} || ${BOOT}) && !data.exists() && newData.exists()`,
      '.validate': "newData.hasChildren(['uid', 'username', 'action', 'ts']) && newData.child('uid').val() === auth.uid && newData.child('ts').val() === now && newData.child('username').val() === newData.parent().parent().child('users').child(auth.uid).child('username').val()",
      uid: { '.validate': 'newData.isString()' }, username: str(30), action: str(40, 1), projectId: str(40), field: str(120), prev: str(500), next: str(500), ts: { '.validate': 'newData.isNumber()' },
      ...deny,
    },
  },

  // Written only by Cloud Functions (Admin SDK bypasses rules); admins can read.
  auditTrail: { '.read': ADMIN, '.indexOn': ['ts', 'projectId'] },
};

for (const d of DOMAINS) {
  const view = (lvl) => (lvl === 'list' ? `${ADMIN} || (${ACTIVE} && ${ALLP} && ${CAN(d.key, 'view')})` : `${ADMIN} || (${ACTIVE} && ${PROJ} && ${CAN(d.key, 'view')})`);
  if (d.key === 'comments' || d.key === 'files') {
    rules[d.path] = {
      $pid: {
        '.read': view('pid'),
        $id: {
          '.write': `${ADMIN} || (${ACTIVE} && ${PROJ} && ${CAN(d.key, 'edit')} && !data.exists() && newData.exists())`,
          '.validate': "newData.child('uid').val() === auth.uid || data.exists()",
          ...(d.key === 'comments'
            ? { uid: { '.validate': 'newData.isString()' }, name: str(100), text: str(2000, 1), ts: { '.validate': 'newData.val() === now' }, ...deny }
            : { uid: { '.validate': 'newData.isString()' }, by: str(100), name: str(200, 1), size: int(1, 10485760), type: str(120), path: { '.validate': "newData.isString() && newData.val().beginsWith('projects/' + $pid + '/')" }, ts: { '.validate': 'newData.val() === now' }, ...deny }),
        },
      },
    };
    continue;
  }
  let write;
  if (d.key === 'basic') {
    write = `${ADMIN} || (${ACTIVE} && !data.exists() && newData.exists() && ${CAN('basic', 'create')} && newData.parent().parent().child('projectIndex').child($pid).val() === true) || (${ACTIVE} && data.exists() && newData.exists() && ${PROJ} && ${CAN('basic', 'edit')})`;
  } else if (d.key === 'profit') {
    write = `${ADMIN}`; // calculated values — admins' browsers or Cloud Functions only
  } else {
    write = `(${ADMIN} || (${ACTIVE} && ${PROJ} && ${CAN(d.key, 'edit')})) && newData.parent().parent().child('projects').child($pid).exists()`;
  }
  rules[d.path] = {
    '.read': view('list'),
    ...(d.key === 'basic' ? { '.indexOn': ['department', 'status', 'endDate', 'updatedAt'] } : {}),
    $pid: { '.read': view('pid'), '.write': write, ...SCHEMA[d.key] },
  };
}

const out = JSON.stringify({ rules }, null, 2);
writeFileSync(new URL('./database.rules.json', import.meta.url), out + '\n');
console.log(`database.rules.json written (${(out.length / 1024).toFixed(1)} KB, ${DOMAINS.length} access domains, bootstrap email ${BOOTSTRAP_ADMIN_EMAIL})`);
