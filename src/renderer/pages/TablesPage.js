import { el } from '../utils.js';

const api = window.api;

export function TablesPage() {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.cssText = 'margin: 24px; padding: 24px;';
  c.innerHTML = `
    <div class="toolbar">
      <h3>Tables</h3>
      <span class="muted">Read-only</span>
    </div>
    <table>
      <thead><tr><th>Number</th><th>Label</th><th>Capacity</th><th>Available</th><th>Branch ID</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  `;
  (async () => {
    const list = await api.invoke('dinein:listTables');
    const tb = el('#rows', c);
    tb.innerHTML = list.map(r => `
      <tr>
        <td>${r.number}</td>
        <td>${r.label}</td>
        <td>${r.capacity}</td>
        <td>${r.is_available ? '✅' : '—'}</td>
        <td>${r.branch_id}</td>
      </tr>
    `).join('');
  })();
  return c;
}
