/**
 * Permission model.
 *
 * Every sensitive field group lives in its OWN top-level Realtime Database path
 * ("access domain"). Firebase Security Rules grant read/write per domain, per
 * project, so a user who lacks a permission can never download that data —
 * not through dev-tools, the SDK, REST calls, exports or charts.
 *
 * This file is the single source of truth: the UI, the demo-mode rule
 * simulator and firebase/build-rules.mjs all import DOMAINS from here.
 */

export const DOMAINS = [
  { key: 'basic',     path: 'projects',       label: 'Project Basic Details', hint: 'Project ID, description, client name, department, status, dates, remarks', create: true },
  { key: 'client',    path: 'clientContacts', label: 'Client Contact Details', hint: 'Contact person, email, phone' },
  { key: 'po',        path: 'poValues',       label: 'PO Value & Receivable', hint: 'PO value, GST mode, receivable adjustment, client due date, tax treatment' },
  { key: 'quotations',path: 'quotations',     label: 'L1/L2/L3 Quotations', hint: 'Vendor quotations, approved purchase value' },
  { key: 'vendor',    path: 'vendorPayments', label: 'Vendor Payments', hint: 'Approved payable, payment transactions' },
  { key: 'purchase',  path: 'expPurchase',    label: 'Actual Purchase Price', hint: 'Purchase cost transactions' },
  { key: 'transport', path: 'expTransport',   label: 'Transport Expenses', hint: 'Transport cost transactions' },
  { key: 'pilot',     path: 'expPilot',       label: 'Pilot Expenses', hint: 'Pilot cost transactions' },
  { key: 'other',     path: 'expOther',       label: 'Other Expenses', hint: 'Other cost transactions' },
  { key: 'clientPay', path: 'clientPayments', label: 'Client Payments, LD & TDS', hint: 'Receipts, LD/TDS deductions, credit notes' },
  { key: 'profit',    path: 'summaries',      label: 'Profit Remaining & Margin', hint: 'Projected/adjusted profit and margin (read only)', viewOnly: true },
  { key: 'comments',  path: 'comments',       label: 'Internal Comments', hint: 'Project remarks thread' },
  { key: 'files',     path: 'attachments',    label: 'Attachments', hint: 'Secured file uploads' },
];

export const DOMAIN = Object.fromEntries(DOMAINS.map((d) => [d.key, d]));
export const PATH_TO_DOMAIN = Object.fromEntries(DOMAINS.map((d) => [d.path, d.key]));
export const EXPENSE_DOMAINS = ['purchase', 'transport', 'pilot', 'other'];

/** Non-project permissions (feature level). */
export const FEATURES = [
  { key: 'reports', label: 'Reports & Exports', hint: 'Exports only ever include fields the user can view' },
  { key: 'audit',   label: 'Audit Log', hint: 'View activity history' },
];

/** Navigation modules and the domains they need. */
export const MODULES = [
  { key: 'dashboard',   label: 'Dashboard',              icon: 'layout-dashboard', route: 'dashboard' },
  { key: 'projects',    label: 'Projects',               icon: 'folder-kanban',    route: 'projects' },
  { key: 'procurement', label: 'Procurement & Quotations', icon: 'scale',          route: 'procurement', needs: ['quotations'] },
  { key: 'vendors',     label: 'Vendor Payments',        icon: 'wallet',           route: 'vendors', needs: ['vendor'] },
  { key: 'expenses',    label: 'Expense Tracking',       icon: 'receipt',          route: 'expenses', needsAny: EXPENSE_DOMAINS },
  { key: 'clients',     label: 'Client Payments',        icon: 'hand-coins',       route: 'clients', needs: ['clientPay'] },
  { key: 'profit',      label: 'Profitability Analytics',icon: 'trending-up',      route: 'profit', needs: ['profit'] },
  { key: 'reports',     label: 'Reports',                icon: 'file-bar-chart',   route: 'reports', feature: 'reports' },
  { key: 'users',       label: 'User Management',        icon: 'users',            route: 'users', adminOnly: true },
  { key: 'audit',       label: 'Audit Log',              icon: 'history',          route: 'audit', feature: 'audit' },
  { key: 'settings',    label: 'Settings',               icon: 'settings',         route: 'settings' },
];

export const ROLES = [
  { key: 'admin',       label: 'Administrator' },
  { key: 'manager',     label: 'Management' },
  { key: 'finance',     label: 'Finance' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'projects',    label: 'Project Coordinator' },
  { key: 'viewer',      label: 'Viewer' },
];

const V = { view: true, edit: false };
const VE = { view: true, edit: true };
const NO = { view: false, edit: false };

/** Role templates pre-fill the matrix; the admin can then change any cell. */
export const ROLE_TEMPLATES = {
  manager: {
    basic: { ...VE, create: true }, client: VE, po: VE, quotations: VE, vendor: V, purchase: V, transport: V, pilot: V, other: V,
    clientPay: V, profit: V, comments: VE, files: VE, reports: { view: true }, audit: { view: true },
  },
  finance: {
    basic: V, client: V, po: V, quotations: V, vendor: VE, purchase: VE, transport: VE, pilot: VE, other: VE,
    clientPay: VE, profit: NO, comments: VE, files: VE, reports: { view: true }, audit: NO,
  },
  procurement: {
    basic: V, client: V, po: NO, quotations: VE, vendor: VE, purchase: NO, transport: VE, pilot: NO, other: NO,
    clientPay: NO, profit: NO, comments: VE, files: VE, reports: { view: true }, audit: NO,
  },
  projects: {
    basic: { ...VE, create: true }, client: VE, po: V, quotations: V, vendor: NO, purchase: NO, transport: VE, pilot: VE, other: VE,
    clientPay: NO, profit: NO, comments: VE, files: VE, reports: { view: true }, audit: NO,
  },
  viewer: {
    basic: V, client: NO, po: NO, quotations: NO, vendor: NO, purchase: NO, transport: NO, pilot: NO, other: NO,
    clientPay: NO, profit: NO, comments: V, files: V, reports: NO, audit: NO,
  },
};

export function templateFor(role) {
  const t = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.viewer;
  const perms = {};
  for (const d of DOMAINS) {
    const c = t[d.key] || NO;
    perms[d.key] = { view: !!c.view, edit: d.viewOnly ? false : !!c.edit };
    if (d.create) perms[d.key].create = !!c.create;
  }
  for (const f of FEATURES) perms[f.key] = { view: !!(t[f.key] && t[f.key].view) };
  return perms;
}

/* ---------------------------------------------------------------- checks */

export const isActive = (u) => !!u && u.status === 'active';
export const isAdmin = (u) => isActive(u) && u.role === 'admin';

export function can(u, key, action = 'view') {
  if (!isActive(u)) return false;
  if (isAdmin(u)) return !(action === 'edit' && DOMAIN[key]?.viewOnly);
  return u.perms?.[key]?.[action] === true;
}

export function projectAllowed(u, pid) {
  if (!isActive(u)) return false;
  if (isAdmin(u)) return true;
  return u.projectAccess?.all === true || u.projectAccess?.ids?.[pid] === true;
}

export const allProjects = (u) => isAdmin(u) || (isActive(u) && u.projectAccess?.all === true);

export function moduleVisible(u, mod) {
  if (!isActive(u)) return false;
  if (mod.adminOnly) return isAdmin(u);
  if (isAdmin(u)) return true;
  if (u.modules && u.modules[mod.key] === false) return false; // admin-hidden module (UI convenience only)
  if (mod.feature) return can(u, mod.feature, 'view');
  if (mod.needs) return mod.needs.every((d) => can(u, d, 'view'));
  if (mod.needsAny) return mod.needsAny.some((d) => can(u, d, 'view'));
  return true;
}

export const canSeeAllExpenses = (u) => EXPENSE_DOMAINS.every((d) => can(u, d, 'view'));
