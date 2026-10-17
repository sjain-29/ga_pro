/** Audit Log — append-only activity history (latest 400 entries streamed live). */
import { state } from '../store.js';
import { esc, dateTime } from '../format.js';
import { icon, icons, empty, options, debounce } from '../ui.js';
import { actionLabel, actionIcon } from './dashboard.js';

const f = { q: '', user: '', kind: '' };
const KINDS = [['project', 'Projects'], ['quotation', 'Quotations'], ['expense', 'Expenses'], ['vendor', 'Vendor payments'], ['client', 'Client payments / LD / TDS'], ['po', 'PO & receivable'], ['user', 'Users'], ['permissions', 'Permissions'], ['settings', 'Settings'], ['comment', 'Comments']];

export function mount(el) {
  el.innerHTML = `<div class="page-head"><div><h1>Audit Log</h1><div class="sub">Tamper-resistant history: entries can be added but never edited or deleted, and carry the server timestamp and the signed-in user ID.</div></div></div>
    <div class="filters"><div class="search">${icon('search')}<input class="input" id="aq" placeholder="Search project ID, field or value" value="${esc(f.q)}"></div>
    <select class="input" id="au" aria-label="User"></select><select class="input" id="ak" aria-label="Category"><option value="">All categories</option>${options(KINDS.map(([v, l]) => ({ value: v, label: l })), f.kind)}</select></div>
    <section class="card"><div class="card-body" id="al"></div></section>`;
  el.querySelector('#aq').oninput = debounce((e) => { f.q = e.target.value; update(); }, 150);
  el.querySelector('#au').onchange = (e) => { f.user = e.target.value; update(); };
  el.querySelector('#ak').onchange = (e) => { f.kind = e.target.value; update(); };

  function update() {
    const all = Object.values(state.logs || {}).sort((a, b) => b.ts - a.ts);
    const users = [...new Set(all.map((l) => l.username))].sort();
    const us = el.querySelector('#au');
    us.innerHTML = `<option value="">All users</option>${options(users.map((u) => ({ value: u, label: '@' + u })), f.user)}`;
    const q = f.q.toLowerCase();
    const list = all.filter((l) => (!f.user || l.username === f.user) && (!f.kind || (l.action || '').startsWith(f.kind)) && (!q || `${l.projectId} ${l.field} ${l.prev} ${l.next} ${l.action}`.toLowerCase().includes(q)));
    el.querySelector('#al').innerHTML = !state.loaded.logs ? '<div class="skeleton sk-row"></div>'.repeat(4) : list.length ? `<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>When (IST)</th><th>User</th><th>Action</th><th>Project</th><th>Field</th><th>Previous</th><th>New</th></tr></thead><tbody>
      ${list.map((l) => `<tr><td data-l="When" class="small" style="white-space:nowrap">${dateTime(l.ts)}</td><td data-l="User">@${esc(l.username)}<div class="small muted mono" title="Firebase UID">${esc((l.uid || '').slice(0, 10))}</div></td>
        <td data-l="Action"><span style="display:inline-flex;gap:6px;align-items:center">${icon(actionIcon(l.action))}${esc(actionLabel(l.action))}</span></td>
        <td data-l="Project">${l.projectId ? `<a class="pid" href="#/project/${encodeURIComponent(l.projectId)}">${esc(l.projectId)}</a>` : '—'}</td>
        <td data-l="Field">${esc(l.field || '')}</td><td data-l="Previous" class="muted small">${esc(l.prev || '')}</td><td data-l="New" class="small">${esc(l.next || '')}</td></tr>`).join('')}
      </tbody></table></div><p class="note">${icon('info')}Showing the latest ${all.length} entries. Older entries remain in the database.</p>` : empty('No matching entries', '', 'history');
    icons(el);
  }
  update();
  return { update };
}
