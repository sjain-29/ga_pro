# GARUDA AEROSPACE – PROJECT COMMAND CENTER

*Projects. Procurement. Profitability. One Platform.*

A realtime web application for **Garuda Aerospace Limited** that tracks every project from Purchase Order receipt to completion: quotations, expenses, vendor payments, client collections (with LD/TDS), deadlines, profitability and department performance — with **field-level access control enforced on the server**.

- Static frontend (HTML5, CSS3, ES modules) → hosts directly on **GitHub Pages**
- **Firebase Realtime Database** (live sync across users/devices) + **Firebase Authentication**
- **Security Rules generated from one permission model** so UI and server can never disagree
- Optional **Cloud Functions** for trusted profit summaries, a server-side audit trail and account disabling
- Chart.js charts, Lucide icons, PDF (jsPDF) and Excel (SheetJS) exports, dark mode, mobile layouts
- A **demo mode** with sample data runs automatically until you add your Firebase web config

---

## Contents

1. [Quick start (demo mode)](#1-quick-start-demo-mode)
2. [Architecture](#2-architecture)
3. [Navigation](#3-navigation)
4. [Firebase data model](#4-firebase-data-model)
5. [Security strategy](#5-security-strategy)
6. [Firebase setup — step by step](#6-firebase-setup--step-by-step)
7. [Create the first administrator](#7-create-the-first-administrator)
8. [Deploy to GitHub Pages](#8-deploy-to-github-pages)
9. [Optional: Cloud Functions & attachments](#9-optional-cloud-functions--attachments)
10. [Calculations](#10-calculations)
11. [Tests](#11-tests)
12. [Project structure](#12-project-structure)
13. [Operating notes & limitations](#13-operating-notes--limitations)

---

## 1. Quick start (demo mode)

```bash
cd garuda-project-command-center
python3 -m http.server 8080        # or: npx serve .
# open http://localhost:8080
```

While `js/firebase-config.js` still contains `REPLACE_WITH…`, the app runs in **demo mode**:

- Sample data (12 projects across all 9 departments) lives **only in that browser** (`localStorage` key `garuda-demo-db-v1`). It is never sent to Firebase.
- The login screen shows **personas** (Administrator, Finance, Procurement, Project Coordinator, plus an inactive user). Pick one to see how permissions change what is visible. Demo mode uses no passwords.
- Demo mode simulates the same security rules as production: a restricted persona that tries `backend.get('expPurchase')` in the console gets `PERMISSION_DENIED`.
- Open two tabs, sign in as different personas, and changes appear in the other tab in real time.
- Reset sample data from the login screen or **Settings → Reset demo data**.

> ES modules do not load from `file://`. Always use a local web server (or GitHub Pages).
> Add `?demo` to the URL to force demo mode even after Firebase is configured.

---

## 2. Architecture

```
Browser (GitHub Pages, static)                    Firebase (project garuda-pro-d3022)
┌───────────────────────────────────┐            ┌──────────────────────────────────────┐
│ index.html + css/ + js/ (modules) │──Auth────▶ │ Authentication (email/password)      │
│                                   │            │                                      │
│ store.js ── subscribes ONLY to    │──RTDB────▶ │ Realtime Database                    │
│   paths the user may read         │◀─live──────│   one top-level path per access      │
│ calc.js ── pure money/deadline    │            │   domain, keyed by Project ID        │
│   maths (integer paise)           │            │   + database.rules.json (enforced)   │
│ views/ ── dashboard, workspace…   │            │                                      │
└───────────────────────────────────┘            │ Cloud Functions (optional)           │
                                                 │   summaries · auditTrail · claims    │
                                                 │ Storage (optional attachments)       │
                                                 └──────────────────────────────────────┘
```

- **No server of your own.** GitHub Pages serves static files; all data access goes straight to Firebase, which enforces the rules. No Java server is required. Privileged extras run as Firebase Cloud Functions.
- **Every write is one atomic multi-path update** that changes the record *and* appends an audit-log entry, so data and history can't diverge.
- **Calculated values are never stored by users.** Lowest quotation, totals, statuses, outstanding balances and profit are computed from the transactions. Profit summaries for users who may see profit but not expenses are written only by admins' browsers or by the Cloud Function.
- **Money is stored as integer paise** (₹1 = 100 paise). The rules reject non-integers, so floating-point errors cannot enter the database.

---

## 3. Navigation

Left sidebar (collapsible drawer on mobile):

| Section | What it shows |
|---|---|
| Dashboard | 15 summary cards, deadline watch (critical / due today / overdue / ≤30 days), recent activity, 8 interactive charts (click to filter). Filters: Today, Week, Month, Quarter, Indian FY (Apr–Mar), custom range, department, status, client. |
| Projects | Search, filters (department, status, deadline, vendor/client payment status), sorting, card or compact table view with expandable rows, Current / Archived / Trash. **+ Add New Project** opens a 4-step wizard. Admins can import CSV. |
| Project workspace | Header (ID, client, department, PO value, dates, status, deadline badge, days remaining) and cards: Procurement (L1–L3, auto lowest), Vendor Payment, Expenses (4 categories with transaction drawers), Profitability, Client Collections (receipts, LD, TDS, adjustments), Client & details, Comments, Attachments, History, Print summary. |
| Procurement & Quotations | Quotation comparison across projects, lowest vs approved vs actual purchase, variance and chart. |
| Vendor Payments | Payable, paid, outstanding, pending/partial/fully paid; record payments without seeing profit. |
| Expense Tracking | Category totals, monthly stacked chart, project-wise table, latest entries. |
| Client Payments | Receivables, cash received, LD/TDS, reconciled vs pending, overdue only against a contractual due date. |
| Profitability Analytics | Projected vs adjusted profit, most profitable, loss-making, department and monthly trends, cost overruns in red. |
| Reports | 9 report types, filters, PDF / Excel / CSV export with company name, title, generated time and totals. |
| User Management (admin) | Create/edit users, role templates, project assignment, module access, **field permission matrix**, activate/deactivate, password reset emails. |
| Audit Log | Append-only history with user, action, project, previous/new values and server time. |
| Settings | Departments (add/deactivate), deadline thresholds, payment tolerance, dark mode, change password. |

Clicking any project anywhere (cards, tables, charts, search, notifications) opens its workspace at `#/project/<ID>`.

---

## 4. Firebase data model

Every sensitive field group is a **separate top-level path** keyed by Project ID, so rules can grant or deny each one independently. (Rules cannot hide individual children of a node a user can read — hence the split.)

| Path | Access domain (matrix row) | Contents |
|---|---|---|
| `projects/{pid}` | Project Basic Details | projectId, description, clientName, department, status, poDate, endDate, remarks, archived, deleted, created/updated by & at |
| `clientContacts/{pid}` | Client Contact Details | contactPerson, email, phone |
| `poValues/{pid}` | PO Value & Receivable | poValue, gstMode, gstPercentBp, receivableAdjust, clientDueDate, tdsTreatment |
| `quotations/{pid}` | L1/L2/L3 Quotations | q1/q2/q3 {amount, vendor, ref}, approvedValue |
| `vendorPayments/{pid}` | Vendor Payments | approvedPayable, completedFlag, txns/{id} |
| `expPurchase/{pid}` | Actual Purchase Price | txns/{id} |
| `expTransport/{pid}` | Transport Expenses | txns/{id} |
| `expPilot/{pid}` | Pilot Expenses | txns/{id} |
| `expOther/{pid}` | Other Expenses | txns/{id} |
| `clientPayments/{pid}` | Client Payments, LD & TDS | receipts/{id}, deductions/{id} (type LD / TDS / ADJ) |
| `summaries/{pid}` | Profit Remaining & Margin | projectedProfit, adjustedProfit, marginBp, costOverrun (calculated) |
| `comments/{pid}/{id}` | Internal Comments | uid, name, text, ts |
| `attachments/{pid}/{id}` | Attachments | file metadata (file itself in Storage) |
| `users/{uid}` | – | profile, role, status, projectAccess {all, ids}, perms {domain: {view, edit, create}}, modules, mustChangePassword |
| `usernames/{username}` | – | {uid, email} — maps login username to email |
| `projectIndex/{pid}` | – | `true` — duplicate-ID check without revealing data |
| `departments/{key}` | – | name, active, order |
| `settings` | – | attentionDays, criticalDays, tolerancePaise |
| `activityLogs/{id}` | Audit Log feature | uid, username, action, projectId, field, prev, next, ts |
| `auditTrail/{id}` | – | server-generated change log (Cloud Functions) |
| `meta` | – | bootstrapped (first admin UID) |

Transactions (`txns`, `receipts`, `deductions`) share one shape: `amount` (positive integer paise), `date` (YYYY-MM-DD), `kind` (payment/receipt/expense/deduction or refund/reversal, which subtract), `ref`, `remarks`/`desc`/`vendor`, `createdAt/By`, and — instead of deletion — `void`, `voidReason`, `voidedBy/At`.

---

## 5. Security strategy

1. **Authentication** – Firebase Authentication (email/password). Users sign in with a *username*; the app looks up `usernames/{username}` → email, then calls Firebase. Passwords never touch the database, the code or the repository.
2. **Authorisation in the database rules** (`firebase/database.rules.json`, generated by `firebase/build-rules.mjs` from `js/permissions.js`):
   - Default deny at the root.
   - Read `{domain}/{pid}` = admin, **or** active user with `perms.{domain}.view` **and** access to that project.
   - Listing a whole domain (`{domain}`) additionally requires `projectAccess.all`. Project-scoped users subscribe per project.
   - Write = admin, or active user with `perms.{domain}.edit` and project access; creation requires `perms.basic.create`.
   - Inactive users can read nothing; deactivation takes effect immediately for open sessions.
   - Users cannot change their own role, status or permissions (only `mustChangePassword → false`, `lastLoginAt`, `prefs`).
   - Values are validated: integer paise, date formats, enumerations, string lengths, timestamps equal to server time, `createdBy`/`updatedBy` must equal the signed-in UID, unknown fields rejected.
   - Projects are **soft-deleted** (admin only) and transactions are **voided**, never removed, so financial history can't be lost accidentally.
   - `activityLogs` is **append-only**: entries can be created once with the writer's own UID/username and server time, never edited or deleted — not even by admins.
3. **What the browser receives** – the app only subscribes to paths the user can read, so restricted values are not in memory, dev-tools, charts, dashboard totals or exports. Reports remove columns the user can't view *before* building PDF/Excel/CSV.
4. **Profit for users without expense access** – `summaries/{pid}` holds only profit figures (no PO or cost detail). Only admins or Cloud Functions can write it.
5. **Defence in depth (optional Functions)** – server-side audit trail, account disabling + token revocation on deactivation, and custom claims for Storage rules.

> The UI hides what users can't use, but **security does not depend on it** — the rules reject the same reads and writes made from the console, REST API or another SDK.

---

## 6. Firebase setup — step by step

You already have the project **`garuda-pro-d3022`** and database
`https://garuda-pro-d3022-default-rtdb.europe-west1.firebasedatabase.app/`.

### 6.1 Get the web app configuration (required)
The database URL alone is **not** enough — Authentication needs the web-app config.

1. [Firebase Console](https://console.firebase.google.com) → project **garuda-pro-d3022** → ⚙ **Project settings** → **General**.
2. Under **Your apps**, click **</> (Web)** if no web app exists → name it *Command Center* → **Register app** (Hosting not needed).
3. Copy the `firebaseConfig` values into **`js/firebase-config.js`**:

| Key | Where it's used |
|---|---|
| `apiKey` | identifies the project to Auth/RTDB (public, not a secret) |
| `authDomain` | `garuda-pro-d3022.firebaseapp.com` – Auth handler (reset emails) |
| `databaseURL` | already filled in |
| `projectId` | `garuda-pro-d3022` |
| `storageBucket` | attachments (optional) |
| `messagingSenderId`, `appId` | app identification |

Once `apiKey` and `appId` no longer contain `REPLACE_WITH`, the app switches from demo mode to Firebase.

### 6.2 Enable Email/Password sign-in
Console → **Authentication** → **Get started** → **Sign-in method** → **Email/Password** → Enable → Save.

**Self sign-up:** Firebase's web API lets anyone create an Auth account, but such accounts have **no profile in `/users`**, so the rules give them no access and the app shows *Account not provisioned*. To block sign-up entirely, upgrade to Identity Platform (Authentication → Settings) and untick *Enable create (sign-up)*.

### 6.3 Authorised domains
Console → **Authentication** → **Settings** → **Authorized domains** → **Add domain**:
- `<your-github-username>.github.io`
- any custom domain you use
- `localhost` is already present for local testing.

### 6.4 Deploy the database rules
**Option A — Console:** Realtime Database → **Rules** → paste the full contents of `firebase/database.rules.json` → **Publish**.

**Option B — Firebase CLI:**
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only database          # uses firebase.json + .firebaserc
```

If you change `js/permissions.js` or the bootstrap email, regenerate first:
```bash
node firebase/build-rules.mjs
```

### 6.5 Departments and settings
Nothing to do: the one-time administrator setup (§7) creates the nine departments — Agri, COE, Defense, Global, Industry, Redington, RPTO, Tender, VV Yatra — and the default thresholds (30 / 15 days, ₹1 tolerance). Afterwards manage them in **Settings**. Departments are always listed alphabetically; deactivated ones stay on historical projects and reports.

---

## 7. Create the first administrator

The requested first login is **username `garuda`** with initial password **`garuda123`**. It is provisioned without putting that password in code, the database or GitHub:

1. Console → **Authentication** → **Users** → **Add user**
   - Email: `admin@garudaaerospace.com` *(or your choice — see note)*
   - Password: `garuda123`
2. Open the deployed app and sign in with **username `garuda`**, password **`garuda123`**.
   Until an admin exists, the username `garuda` resolves to the bootstrap email.
3. The **One-time administrator setup** screen appears → **Claim administrator account**. This atomically creates `users/{uid}` (role admin), `usernames/garuda`, `meta/bootstrapped`, the departments and default settings. The rules allow this **only** for the bootstrap email and **only** while `meta/bootstrapped` doesn't exist — afterwards it is locked forever.
4. You're forced to **set a new password** (min 10 characters, upper/lower case and a number; `garuda…` patterns rejected). `garuda123` stops working.

> **Using a different admin email?** Change `BOOTSTRAP_ADMIN_EMAIL` in `js/firebase-config.js`, run `node firebase/build-rules.mjs`, and redeploy the rules. Use a real mailbox so password-reset emails work.

### Adding users
**User Management → Create user**: name, username, email, department, role, status, project access, module access and the **field permission matrix** (View / Edit / Create per field group). Choose:
- **Email a password-setup link** (recommended) — a random password is set and Firebase emails the user a reset link; nobody else ever knows the password; or
- **Temporary password** — the user must change it at first login.

The admin's own session stays signed in (a temporary secondary Firebase app instance creates the account).
Deactivate, edit or send a reset email from the same page — changes apply to open sessions instantly.

---

## 8. Deploy to GitHub Pages

```bash
cd garuda-project-command-center
git init
git add .
git commit -m "Garuda Project Command Center"
git branch -M main
git remote add origin https://github.com/<you>/garuda-project-command-center.git
git push -u origin main
```

1. GitHub → repository → **Settings** → **Pages**.
2. **Source:** *Deploy from a branch* → Branch **main** → folder **/ (root)** → **Save**.
3. After ~1 minute the site is live at `https://<you>.github.io/garuda-project-command-center/`.
4. Add `<you>.github.io` to Firebase **Authorized domains** (§6.3).

The repository contains **no passwords, service-account keys or secrets**. The Firebase web config is a public identifier; access is controlled by Authentication + Rules. `.nojekyll` is included so GitHub serves every file as-is. Consider a **private** repository with Pages (GitHub Pro/Team/Enterprise) to keep the code internal; security doesn't depend on it.

---

## 9. Optional: Cloud Functions & attachments

Requires the **Blaze (pay-as-you-go)** plan. Everything else works on the free Spark plan.

```bash
cd functions && npm install && cd ..
firebase deploy --only functions,storage
```
Then set `CLOUD_FUNCTIONS_DEPLOYED = true` in `js/firebase-config.js` and push.

| Function | Purpose |
|---|---|
| `recomputeSummary-*` | Recomputes `summaries/{pid}` server-side whenever PO, expenses or deductions change (otherwise an admin's open browser does this). |
| `auditTrail-*` | Writes a server-generated before/after change log to `auditTrail` that clients cannot write. |
| `syncUserAccess` | Mirrors status/permissions into Auth custom claims; disables deactivated accounts and revokes their tokens. |
| `setAccountDisabled` | Callable used by the admin UI (verifies the caller is an active admin). |

**Attachments** (PDF, images, Office, CSV, ≤10 MB) are stored at `projects/{pid}/…` in Firebase Storage. `firebase/storage.rules` checks the custom claims from `syncUserAccess` (active, file view/edit permission, project access), so attachments are enabled only when the Functions are deployed.

---

## 10. Calculations

All amounts are integer paise; percentages are computed only for display. Implemented in `js/calc.js` (shared by the app, the tests and the Cloud Functions).

| Result | Formula |
|---|---|
| Lowest quotation | Minimum **valid positive** amount among L1, L2, L3 (slot names don't matter). None valid → "Not Available". |
| Total expenses | Actual Purchase Price + Transport + Pilot + Other (sum of non-voided entries; refunds subtract). Quotations are never counted. |
| Projected profit | PO value − total expenses |
| Profit margin | Projected profit ÷ PO value × 100 (PO = 0 → N/A). Negative values supported. |
| Adjusted profit | PO value − total expenses − LD (TDS is treated as a tax credit unless the project's TDS treatment is set to "cost"). |
| Vendor outstanding | Approved payable − total vendor payments. No approved payable → **Amount Not Confirmed**. Status: Pending / Partial / Complete / Overpaid. The *Vendor Payment Completed* tick is a confirmation flag and never overrides amounts; mismatches are flagged. |
| Client receivable | PO value (+ GST if the PO is exclusive of GST) + approved receivable adjustment |
| Client adjusted outstanding | Receivable − cash received − LD − TDS − other approved adjustments (credit notes) |
| Client status | Pending · Partial · Complete (cash) · **Settled with Deductions** · **Closed by Deductions** · Excess / Reconciliation Required · Not Configured. Within the configured tolerance (default ₹1.00) counts as zero. |
| Procurement variance | Actual purchase − approved value (or lowest quote if none approved); separate from profit. |
| Deadline status (Asia/Kolkata) | > attention days: On Track · ≤ attention: Attention · ≤ critical: Critical · 0: Due Today · < 0: Overdue. Completed/Cancelled → closed (never overdue). Defaults 30 / 15, editable in Settings. |
| Receivable overdue | Only when a contractual **client due date** is set — the project end date is never used. |
| Financial year | 1 April – 31 March; quarters Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar. |

Profit is labelled **projected / recorded cost-based** — not audited net profit.

---

## 11. Tests

```bash
node --test tests/
```
- `tests/calc.test.mjs` — 24 tests: paise parsing/formatting, lowest quotation edge cases, the spec example (₹3,40,000 / 34%), negative profit, LD vs TDS, every vendor and client status, GST/adjustments, tolerance, deadline thresholds, IST date rollover, Indian FY/quarters, procurement variance, restricted-data handling.
- `tests/permissions.test.mjs` — 13 tests: permission helpers, role templates, and the rule simulator (restricted reads denied, project scoping, invalid money rejected, no self-escalation, admin-only delete, append-only audit log, deactivated users locked out) plus structural checks on the generated `database.rules.json`.

Browser walkthrough performed before delivery (demo mode): admin login → create project via wizard (validation, duplicate ID blocked) → quotations (lowest = L2 ₹4,75,000) → expenses (total ₹6,60,000, profit ₹3,40,000, 34%) → vendor payable/payments (Partial → Complete; tick doesn't override) → client receipts + LD/TDS (Settled with Deductions; adjusted profit −LD only) → threshold change makes project Critical → realtime update in a second user's tab → persistence after refresh → admin creates a limited user → that user sees only assigned projects and permitted fields, direct reads of restricted paths are denied, CSV export omits restricted columns → deactivation locks the user out instantly → mobile layout without horizontal scrolling.

To test the real rules, use the Firebase Emulator Suite (`firebase emulators:start --only database,auth`) and point the app at it, or use the **Rules Playground** in the console (Realtime Database → Rules → *Rules playground*) with a simulated UID.

---

## 12. Project structure

```
garuda-project-command-center/
├── index.html                 App shell (loads Chart.js & Lucide from CDN)
├── assets/logo.svg
├── css/
│   ├── style.css              Tokens, dark mode, buttons, forms, badges, modals, tables
│   ├── dashboard.css          Shell, login, dashboard, project cards, workspace, users
│   └── responsive.css         Laptop / tablet / mobile
├── js/
│   ├── firebase-config.js     ← paste your Firebase web config here
│   ├── app.js                 Boot, auth routing, shell, router, search, notifications
│   ├── auth.js                Login, username→email, bootstrap, forced password change
│   ├── db.js                  Firebase adapter (RTDB, Auth, Storage, Functions)
│   ├── demo-db.js             Demo backend + security-rule simulator
│   ├── demo-data.js           Sample data (demo mode only)
│   ├── store.js               Permission-aware live sync, computed views, atomic writes + audit
│   ├── calc.js                All financial & deadline calculations (pure, tested)
│   ├── permissions.js         Access domains, roles, templates, modules (single source of truth)
│   ├── charts.js, ui.js, format.js
│   └── views/                 dashboard, projects, project-detail, procurement, vendors,
│                              expenses, clients, profit, reports, users, audit, settings, common
├── firebase/
│   ├── build-rules.mjs        Generates database.rules.json from js/permissions.js
│   ├── database.rules.json    Realtime Database Security Rules (generated)
│   ├── database.indexes.json  Index reference (indexes live in the rules)
│   └── storage.rules          Storage rules for attachments
├── functions/                 Optional Cloud Functions (summaries, audit trail, claims)
├── demo/                      Seed data for a separate demo Firebase project
├── tests/                     node --test suites
├── firebase.json, .firebaserc, .nojekyll, .gitignore
└── README.md
```

---

## 13. Operating notes & limitations

- **Offline/errors:** the top bar shows *Live / Offline*; Firebase queues writes while offline and syncs on reconnect. Failed saves show a clear toast and leave the form open to retry.
- **Usernames are looked up before sign-in**, so `usernames/{name}` is readable one key at a time (not listable). Someone who guesses a username learns its login email; the password is still required.
- **Project-scoped users** subscribe to each assigned project individually; users with *All projects* stream whole paths. Both are enforced by the rules.
- **Audit log `prev`/`next`** values come from the client (append-only, own UID, server time). For a fully trusted record deploy the `auditTrail` Cloud Function.
- **Without Cloud Functions,** profit summaries for users who can see profit but not expenses are refreshed whenever an administrator has the app open; deactivated users are blocked by the rules immediately but their Auth account isn't disabled.
- **Self sign-up** through the Firebase API yields an account with no profile and therefore no access.
- **Fonts, icons and charts load from CDNs** (Google Fonts, unpkg, cdnjs). PDF/Excel libraries load on first export; if offline, CSV/print fallbacks are used.
