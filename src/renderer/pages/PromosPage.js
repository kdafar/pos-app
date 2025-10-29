import { el } from '../utils.js';

const api = window.api;

export function PromosPage() {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.cssText = 'margin: 24px; padding: 24px;';
  c.innerHTML = `
    <div class="toolbar">
      <h3>Promos</h3>
      <span class="muted">Read-only</span>
    </div>
    <table>
      <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Min Total</th><th>Max Discount</th><th>Starts</th><th>Ends</th><th>Active</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  `;
  (async () => {
    const list = await api.invoke('catalog:listPromos');
    const tb = el('#rows', c);
    tb.innerHTML = list.map(r => `
      <tr>
        <td>${r.code}</td>
        <td>${r.type}</td>
        <td>${r.value}</td>
        <td>${r.min_total}</td>
        <td>${r.max_discount}</td>
        <td>${r.start_at ? new Date(r.start_at).toLocaleDateString() : ''}</td>
        <td>${r.end_at ? new Date(r.end_at).toLocaleDateString() : ''}</td>
        <td>${r.active ? '✅' : '—'}</td>
      </tr>
    `).join('');
  })();
  return c;
}
