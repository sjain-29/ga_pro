/**
 * DEMONSTRATION DATA — used only by demo mode (js/demo-db.js).
 * It is never written to the production Firebase database.
 * (For a separate demo Firebase project, see demo/seed-demo.json.)
 * Dates are generated relative to today so deadline badges are always meaningful.
 */
import { todayIST } from './calc.js';
import { templateFor } from './permissions.js';

export const DEPARTMENTS = ['Agri', 'COE', 'Defense', 'Global', 'Industry', 'Redington', 'RPTO', 'Tender', 'VV Yatra'];

const R = (rupees) => Math.round(rupees * 100);

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildDemoTree() {
  const T = todayIST();
  const now = Date.now();
  const day = 86400000;
  let seq = 0;
  const id = () => `-demo${(++seq).toString().padStart(4, '0')}`;
  const txns = (list) => Object.fromEntries(list.map((t) => [id(), { kind: 'expense', ...t, amount: R(t.amount), createdAt: now - 5 * day, createdBy: 'u_admin' }]));

  const users = {
    u_admin: {
      fullName: 'Garuda Administrator', username: 'garuda', email: 'admin@garudaaerospace.com', department: 'COE',
      role: 'admin', status: 'active', mustChangePassword: false, projectAccess: { all: true }, perms: templateFor('manager'),
      createdAt: now - 90 * day,
    },
    u_finance: {
      fullName: 'Priya Raman', username: 'priya.finance', email: 'priya@garudaaerospace.com', department: 'COE',
      role: 'finance', status: 'active', mustChangePassword: false, projectAccess: { all: true }, perms: templateFor('finance'),
      createdAt: now - 60 * day,
    },
    u_proc: {
      fullName: 'Arjun Mehta', username: 'arjun.procurement', email: 'arjun@garudaaerospace.com', department: 'Tender',
      role: 'procurement', status: 'active', mustChangePassword: false, projectAccess: { all: true }, perms: templateFor('procurement'),
      createdAt: now - 45 * day,
    },
    u_coord: {
      fullName: 'Karthik Subramanian', username: 'karthik.agri', email: 'karthik@garudaaerospace.com', department: 'Agri',
      role: 'projects', status: 'active', mustChangePassword: false,
      projectAccess: { all: false, ids: { 'GAL-AGRI-2601': true, 'GAL-AGRI-2602': true, 'GAL-VVY-2601': true } },
      perms: templateFor('projects'), createdAt: now - 30 * day,
    },
    u_inactive: {
      fullName: 'Ravi Kumar', username: 'ravi.k', email: 'ravi@garudaaerospace.com', department: 'Industry',
      role: 'viewer', status: 'inactive', mustChangePassword: false, projectAccess: { all: true }, perms: templateFor('viewer'),
      createdAt: now - 120 * day,
    },
  };
  const usernames = Object.fromEntries(Object.entries(users).map(([uid, u]) => [u.username, { uid, email: u.email }]));

  // [id, desc, client, dept, po, poDateOffset, endOffset, status, q[3], approved, purchase, transport, pilot, other, vendorPayable, vendorPaid[], receipts[], LD, TDS]
  const P = [
    ['GAL-AGRI-2601', 'Agricultural spraying drones – 25 units with 2 years AMC', 'Tamil Nadu Agri Dept.', 'Agri', 1000000, -120, 65, 'In Progress', [500000, 475000, 490000], 475000, 600000, 30000, 20000, 10000, 600000, [350000], [400000], 0, 10000],
    ['GAL-AGRI-2602', 'Kisan drone pilot training batch – 40 farmers', 'NABARD Rural Programme', 'Agri', 450000, -60, 12, 'In Progress', [180000, 0, 195000], 180000, 172000, 18000, 65000, 8000, 172000, [172000], [200000], 0, 4500],
    ['GAL-DEF-2601', 'Surveillance UAV supply with ground control station', 'Defence Research Unit', 'Defense', 8500000, -200, -6, 'In Progress', [5200000, 5450000, 5100000], 5200000, 5300000, 120000, 90000, 150000, 5200000, [2600000, 1500000], [4250000], 425000, 85000],
    ['GAL-DEF-2602', 'Tethered drone system – border outpost pilot', 'Border Security Command', 'Defense', 3200000, -30, 0, 'In Progress', [2100000, 2050000, 0], 2050000, 1990000, 45000, 30000, 25000, 1990000, [], [], 0, 0],
    ['GAL-TND-2601', 'GeM tender – mapping drones for municipal survey', 'Greater Chennai Corporation', 'Tender', 2400000, -150, -40, 'Completed', [1500000, 1420000, 1480000], 1420000, 1430000, 35000, 60000, 15000, 1420000, [1420000], [2304000], 72000, 24000],
    ['GAL-IND-2601', 'Solar panel inspection drone service – 6 months', 'Adani Green (Kamuthi plant)', 'Industry', 1800000, -90, 25, 'In Progress', [600000, 640000, 615000], 600000, 610000, 55000, 240000, 30000, 600000, [300000], [900000], 0, 18000],
    ['GAL-COE-2601', 'Drone Centre of Excellence lab setup', 'Anna University', 'COE', 5600000, -75, 140, 'In Progress', [3100000, 3350000, 3200000], 3100000, 0, 0, 0, 0, null, [], [1120000], 0, 0],
    ['GAL-GLB-2601', 'Export order – crop protection drones (Malaysia)', 'AgroTech Sdn Bhd', 'Global', 7200000, -40, 95, 'Not Started', [4300000, 4180000, 4400000], 4180000, 0, 0, 0, 0, 4180000, [1000000], [2160000], 0, 0],
    ['GAL-RED-2601', 'Redington channel – retail drone kits (batch 3)', 'Redington Ltd', 'Redington', 2600000, -20, 35, 'In Progress', [1900000, 1950000, 1880000], 1880000, 1880000, 40000, 0, 12000, 1880000, [900000], [], 0, 0],
    ['GAL-RPTO-2601', 'DGCA RPTO pilot certification – 3 cohorts', 'Skill India Mission', 'RPTO', 900000, -110, 8, 'On Hold', [0, 0, 0], null, 0, 15000, 320000, 60000, null, [], [450000], 0, 9000],
    ['GAL-VVY-2601', 'Viksit Bharat Sankalp Yatra – drone demonstrations', 'Ministry of Agriculture', 'VV Yatra', 1500000, -180, -95, 'Completed', [700000, 720000, 690000], 690000, 1150000, 180000, 160000, 70000, 690000, [690000], [1425000], 45000, 30000],
    ['GAL-IND-2602', 'Warehouse inventory drone pilot project', 'Logistics Park Sriperumbudur', 'Industry', 650000, -10, 50, 'Cancelled', [400000, 380000, 0], null, 0, 0, 0, 0, null, [], [], 0, 0],
  ];

  const projects = {}, projectIndex = {}, clientContacts = {}, poValues = {}, quotations = {}, vendorPayments = {},
    expPurchase = {}, expTransport = {}, expPilot = {}, expOther = {}, clientPayments = {}, comments = {}, activityLogs = {};
  const vendors = ['Aerovista Components', 'SkyMotors India', 'Precision Airframes', 'BlueSky Avionics'];

  P.forEach((r, i) => {
    const [pid, desc, client, dept, po, poOff, endOff, status, q, approved, purchase, transport, pilot, other, vPayable, vPaid, receipts, ld, tds] = r;
    const created = now - (-poOff) * day;
    projects[pid] = {
      projectId: pid, description: desc, clientName: client, department: dept, status,
      poDate: addDays(T, poOff), endDate: addDays(T, endOff), remarks: i % 3 === 0 ? 'Priority account – weekly review with management.' : '',
      archived: false, deleted: false, createdAt: created, createdBy: 'u_admin', updatedAt: now - (i + 1) * 3600000, updatedBy: 'u_admin',
    };
    projectIndex[pid] = true;
    clientContacts[pid] = { contactPerson: ['R. Balaji', 'S. Lakshmi', 'Col. A. Verma', 'M. Prakash'][i % 4], email: `procurement${i + 1}@client.example`, phone: `+91 98400 ${String(10000 + i * 731).slice(0, 5)}` };
    poValues[pid] = { poValue: R(po), gstMode: 'inclusive', gstPercentBp: 1800, tdsTreatment: 'credit', clientDueDate: endOff + 30 < 0 ? addDays(T, endOff + 30) : '', updatedAt: created };
    quotations[pid] = {
      q1: { amount: R(q[0]), vendor: q[0] ? vendors[i % 4] : '', ref: q[0] ? `QT-${pid.slice(-4)}-A` : '' },
      q2: { amount: R(q[1]), vendor: q[1] ? vendors[(i + 1) % 4] : '', ref: q[1] ? `QT-${pid.slice(-4)}-B` : '' },
      q3: { amount: R(q[2]), vendor: q[2] ? vendors[(i + 2) % 4] : '', ref: q[2] ? `QT-${pid.slice(-4)}-C` : '' },
      ...(approved ? { approvedValue: R(approved) } : {}),
    };
    vendorPayments[pid] = {
      ...(vPayable ? { approvedPayable: R(vPayable) } : {}),
      completedFlag: vPayable !== null && vPaid.reduce((s, a) => s + a, 0) >= vPayable,
      txns: Object.fromEntries(vPaid.map((a, k) => [id(), { kind: 'payment', vendor: vendors[(i + 1) % 4], amount: R(a), date: addDays(T, poOff + 20 + k * 15), ref: `UTR${(884210 + i * 97 + k).toString()}`, remarks: k ? 'Balance payment' : 'Advance', createdAt: created, createdBy: 'u_finance' }])),
    };
    const one = (amt, desc2, off) => (amt ? txns([{ amount: amt, date: addDays(T, poOff + off), desc: desc2, ref: `INV-${pid.slice(-4)}-${off}` }]) : {});
    expPurchase[pid] = { txns: one(purchase, 'Purchase of drones / components', 15) };
    expTransport[pid] = { txns: transport > 20000 ? { ...one(transport * 0.6, 'Freight to site', 25), ...one(transport * 0.4, 'Local transport', 40) } : one(transport, 'Transport', 25) };
    expPilot[pid] = { txns: one(pilot, 'Pilot charges & allowances', 35) };
    expOther[pid] = { txns: one(other, 'Insurance, permits & misc.', 30) };
    const ded = {};
    if (ld) ded[id()] = { type: 'LD', amount: R(ld), date: addDays(T, poOff + 60), ref: 'LD as per PO clause 14', createdAt: created, createdBy: 'u_finance' };
    if (tds) ded[id()] = { type: 'TDS', amount: R(tds), date: addDays(T, poOff + 60), ref: 'TDS u/s 194Q', createdAt: created, createdBy: 'u_finance' };
    clientPayments[pid] = {
      receipts: Object.fromEntries(receipts.map((a, k) => [id(), { kind: 'receipt', amount: R(a), date: addDays(T, poOff + 45 + k * 20), ref: `NEFT${(551200 + i * 13 + k)}`, remarks: 'Received', createdAt: created, createdBy: 'u_finance' }])),
      deductions: ded,
    };
    if (i < 4) {
      comments[pid] = { [id()]: { uid: 'u_admin', name: 'Garuda Administrator', text: 'Kick-off done. Please keep vendor docs attached here.', ts: now - (i + 2) * day } };
    }
    activityLogs[id()] = { uid: 'u_admin', username: 'garuda', action: 'project.create', projectId: pid, next: desc, ts: created };
  });

  activityLogs[id()] = { uid: 'u_finance', username: 'priya.finance', action: 'vendor.payment', projectId: 'GAL-DEF-2601', next: '₹15,00,000.00', ts: now - 2 * 3600000 };
  activityLogs[id()] = { uid: 'u_proc', username: 'arjun.procurement', action: 'quotation.update', projectId: 'GAL-RED-2601', field: 'L3', prev: '₹19,00,000.00', next: '₹18,80,000.00', ts: now - 3600000 };

  return {
    meta: { demo: true, bootstrapped: 'u_admin', createdAt: now },
    settings: { attentionDays: 30, criticalDays: 15, tolerancePaise: 100, companyName: 'Garuda Aerospace Limited' },
    departments: Object.fromEntries(DEPARTMENTS.map((d, i) => [d.replace(/\s+/g, '_'), { name: d, active: true, order: i }])),
    users, usernames, projects, projectIndex, clientContacts, poValues, quotations, vendorPayments,
    expPurchase, expTransport, expPilot, expOther, clientPayments, comments, activityLogs, summaries: {},
  };
}
