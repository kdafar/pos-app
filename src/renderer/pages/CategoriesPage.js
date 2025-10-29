import { el } from '../utils.js';

const api = window.api;

export function CategoriesPage() {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.cssText = 'margin: 24px; padding: 24px;';
  c.innerHTML = `
    <div class="toolbar">
      <h3>Categories</h3>
      <span class="muted">Read-only</span>
    </div>
    <table>
      <thead><tr><th>#</th><th>Name (EN)</th><th>Name (AR)</th><th>Visible</th><th>Updated</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  `;
  (async () => {
    const list = await api.invoke('catalog:listCategories');
    const tb = el('#rows', c);
    tb.innerHTML = list.map((r, i) => `
      <tr><td>${r.position ?? i+1}</td><td>${r.name ?? ''}</td><td class="muted">${r.name_ar ?? ''}</td><td>${r.visible ? '✅' : '—'}</td><td class="muted">${r.updated_at ?? ''}</td></tr>
    `).join('');
  })();
  return c;
}