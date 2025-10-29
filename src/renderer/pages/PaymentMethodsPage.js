import { el } from '../utils.js';

const api = window.api;

export function PaymentMethodsPage() {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.cssText = 'margin: 24px; padding: 24px;';
  c.innerHTML = `
    <div class="toolbar">
      <h3>Payment Methods</h3>
      <span class="muted">Read-only</span>
    </div>
    <table>
      <thead><tr><th>Sort</th><th>Slug</th><th>Name (EN)</th><th>Name (AR)</th><th>Legacy Code</th><th>Active</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  `;
  (async () => {
    const list = await api.invoke('system:listPaymentMethods');
    const tb = el('#rows', c);
    tb.innerHTML = list.map(r => `
      <tr>
        <td>${r.sort_order}</td>
        <td>${r.slug}</td>
        <td>${r.name_en}</td>
        <td>${r.name_ar}</td>
        <td>${r.legacy_code}</td>
        <td>${r.is_active ? '✅' : '—'}</td>
      </tr>
    `).join('');
  })();
  return c;
}
