/** Formatting helpers — Indian Rupee, dates, percentages, HTML escaping. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** paise (integer) → "₹12,50,000.00". null/undefined → fallback. */
export function money(paise, fallback = '—') {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return fallback;
  // Integer division keeps paise exact; Intl only formats.
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const p = abs % 100;
  const s = inr.format(rupees).replace(/\.00$/, '') + '.' + String(p).padStart(2, '0');
  return neg ? '−' + s : s;
}

/** Compact: ₹12.5 L / ₹3.2 Cr — for charts and tiles. */
export function moneyShort(paise, fallback = '—') {
  if (paise === null || paise === undefined) return fallback;
  const r = paise / 100;
  const a = Math.abs(r);
  const sign = r < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${inrCompact.format(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${inrCompact.format(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${inrCompact.format(a / 1e3)} K`;
  return `${sign}₹${inrCompact.format(a)}`;
}

/** paise → plain editable rupee string "475000.00" */
export const paiseToInput = (p) => (p === null || p === undefined ? '' : (p / 100).toFixed(2));

export function percent(v, digits = 1, fallback = 'N/A') {
  if (v === null || v === undefined || !Number.isFinite(v)) return fallback;
  return `${v.toFixed(digits)}%`;
}

const dfmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function date(iso, fallback = '—') {
  if (!iso) return fallback;
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  return Number.isNaN(d.getTime()) ? fallback : dfmt.format(d);
}

const dtfmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
export const dateTime = (ms) => (ms ? dtfmt.format(new Date(ms)) : '—');

export function relTime(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return dateTime(ms);
}

export function daysLabel(days) {
  if (days === null || days === undefined) return '—';
  if (days === 0) return 'Due today';
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`;
  return `${days} day${days === 1 ? '' : 's'} left`;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => (s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, (c) => ESC[c]));

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
