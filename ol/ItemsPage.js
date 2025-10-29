import { el, fmtMoney } from '../src/renderer/utils.js';

const api = window.api;

export function ItemsPage() {
  const c = document.createElement('div');
  c.style.cssText = 'margin: 24px;';
  c.innerHTML = `
    <div class="toolbar" style="margin-bottom: 20px;">
      <h3>Items</h3>
      <div style="display: flex; gap: 12px;">
        <input type="search" id="q" placeholder="Search items..." style="min-width: 300px;"/>
        <button class="btn" id="go">Search</button>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;" id="grid"></div>
  `;
  async function load(q = null) {
    const list = await api.invoke('catalog:listItems', { q });
    const g = el('#grid', c);
    g.innerHTML = list.map(r => `
      <div class="card" style="padding: 16px;">
        <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom: 8px;">
          <div style="font-weight:700">${r.name}</div>
          <div><strong style="color: var(--success);">${fmtMoney(r.price)}</strong></div>
        </div>
        <div class="muted" style="font-size:12px; margin-bottom: 8px;">${r.name_ar ?? ''}</div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap: wrap;"><span style="padding: 4px 8px; background: var(--bg-primary); border-radius: 6px; font-size: 11px; color: var(--text-muted);">${r.barcode || '—'}</span>${r.is_outofstock ? '<span class="badge offline" style="font-size: 11px;">Out of Stock</span>' : ''}</div>
      </div>
    `).join('');
  }
  el('#go', c).addEventListener('click', () => load(el('#q', c).value.trim() || null));
  el('#q', c).addEventListener('keydown', e => { if (e.key === 'Enter') el('#go', c).click(); });
  load();
  return c;
}