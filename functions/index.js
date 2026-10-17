/**
 * Garuda Project Command Center — Cloud Functions (optional, requires the Blaze plan).
 *
 * What they add on top of the database rules:
 *  1. recomputeSummary  – trusted server-side profit summaries (/summaries) whenever
 *                         PO value, expenses or client deductions change.
 *  2. auditTrail        – a second, server-generated audit log (/auditTrail) of every
 *                         financial/project change with before/after values. Clients
 *                         can never write to it.
 *  3. syncUserAccess    – mirrors each user's status/permissions into Auth custom claims
 *                         (used by storage.rules), disables deactivated accounts in
 *                         Firebase Auth and revokes their sessions immediately.
 *  4. setAccountDisabled – callable used by the admin UI (admins only).
 *
 * Deploy:  cd functions && npm install && cd .. && firebase deploy --only functions
 * Then set CLOUD_FUNCTIONS_DEPLOYED = true in js/firebase-config.js.
 */
import { onValueWritten } from 'firebase-functions/v2/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { buildSummary } from './lib/calc.mjs'; // copied from ../js/calc.js by the predeploy step

const REGION = 'europe-west1';
const INSTANCE = 'garuda-pro-d3022-default-rtdb';
setGlobalOptions({ region: REGION, maxInstances: 10 });
initializeApp();
const db = () => getDatabase();

const FINANCIAL_PATHS = ['poValues', 'expPurchase', 'expTransport', 'expPilot', 'expOther', 'clientPayments'];
const AUDITED_PATHS = ['projects', 'clientContacts', 'poValues', 'quotations', 'vendorPayments', 'expPurchase', 'expTransport', 'expPilot', 'expOther', 'clientPayments'];

/* ------------------------------------------------------------ summaries */
async function writeSummary(pid) {
  const paths = ['poValues', 'expPurchase', 'expTransport', 'expPilot', 'expOther', 'clientPayments', 'projects'];
  const snaps = await Promise.all(paths.map((p) => db().ref(`${p}/${pid}`).get()));
  const [po, purchase, transport, pilot, other, clientPay, project] = snaps.map((s) => s.val());
  if (!project) { await db().ref(`summaries/${pid}`).remove(); return; }
  const s = buildSummary(po, { purchase, transport, pilot, other }, clientPay);
  const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== undefined));
  await db().ref(`summaries/${pid}`).set({ ...clean, computedAt: ServerValue.TIMESTAMP });
}

export const recomputeSummary = FINANCIAL_PATHS.reduce((acc, path) => {
  acc[path] = onValueWritten({ ref: `/${path}/{pid}`, instance: INSTANCE, region: REGION }, async (event) => {
    await writeSummary(event.params.pid);
  });
  return acc;
}, {});

/* ---------------------------------------------------------- audit trail */
function diff(before, after, prefix = '', out = []) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (['updatedAt', 'updatedBy', 'editedAt', 'editedBy'].includes(k)) continue;
    const a = before?.[k], b = after?.[k];
    const isObj = (v) => v && typeof v === 'object';
    if (isObj(a) || isObj(b)) diff(isObj(a) ? a : {}, isObj(b) ? b : {}, `${prefix}${k}/`, out);
    else if (a !== b) out.push({ field: prefix + k, prev: a === undefined ? null : a, next: b === undefined ? null : b });
  }
  return out;
}

export const auditTrail = AUDITED_PATHS.reduce((acc, path) => {
  acc[path] = onValueWritten({ ref: `/${path}/{pid}`, instance: INSTANCE, region: REGION }, async (event) => {
    const before = event.data.before.val(), after = event.data.after.val();
    const changes = diff(before, after).slice(0, 50);
    if (!changes.length) return;
    const actor = after?.updatedBy || after?.createdBy || null;
    await db().ref('auditTrail').push({
      path, projectId: event.params.pid, actorUid: actor, type: !before ? 'create' : !after ? 'delete' : 'update',
      changes: JSON.stringify(changes).slice(0, 8000), ts: ServerValue.TIMESTAMP,
    });
  });
  return acc;
}, {});

/* --------------------------------------------------- user access & claims */
export const syncUserAccess = onValueWritten({ ref: '/users/{uid}', instance: INSTANCE, region: REGION }, async (event) => {
  const uid = event.params.uid;
  const u = event.data.after.val();
  const auth = getAuth();
  try {
    if (!u) { await auth.updateUser(uid, { disabled: true }); await auth.revokeRefreshTokens(uid); return; }
    const active = u.status === 'active';
    const ids = Object.keys(u.projectAccess?.ids || {});
    const claims = {
      active, admin: active && u.role === 'admin',
      fv: active && (u.role === 'admin' || u.perms?.files?.view === true),
      fe: active && (u.role === 'admin' || u.perms?.files?.edit === true),
      // Custom claims are limited to 1000 bytes: very long project lists fall back to "no file access" for unlisted projects.
      pa: u.role === 'admin' || u.projectAccess?.all ? '*' : ids.slice(0, 40),
    };
    await auth.setCustomUserClaims(uid, claims);
    const rec = await auth.getUser(uid);
    if (rec.disabled === active) await auth.updateUser(uid, { disabled: !active });
    if (!active) await auth.revokeRefreshTokens(uid);
  } catch (e) { logger.error('syncUserAccess failed', uid, e); }
});

export const setAccountDisabled = onCall({ region: REGION }, async (req) => {
  const caller = req.auth?.uid;
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in first.');
  const me = (await db().ref(`users/${caller}`).get()).val();
  if (!me || me.status !== 'active' || me.role !== 'admin') throw new HttpsError('permission-denied', 'Administrators only.');
  const { uid, disabled } = req.data || {};
  if (typeof uid !== 'string' || typeof disabled !== 'boolean') throw new HttpsError('invalid-argument', 'uid and disabled are required.');
  if (uid === caller) throw new HttpsError('failed-precondition', 'You cannot disable your own account.');
  await getAuth().updateUser(uid, { disabled });
  if (disabled) await getAuth().revokeRefreshTokens(uid);
  return { ok: true };
});
