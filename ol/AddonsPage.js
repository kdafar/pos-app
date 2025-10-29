import { el, fmtMoney } from '../src/renderer/utils.js';

const api = window.api;

export function AddonsPage() {
  const c = document.createElement('div');
  c.style.cssText = 'margin: 24px;';
  c.innerHTML = `
    <div class="toolbar" style="margin-bottom: 20px;">
      <h3>Addon Groups</h3>
      <div class="muted">Read-only</div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; margin-bottom: 32px;" id="groups"></div>
    <div class="toolbar" style="margin-top: 32px; margin-bottom: 16px;">
      <h3>Addons</h3>
      <div class="muted" id="groupHint">Select a group to filter</div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;" id="addons"></div>
  `;
  (async () => {
    const groups = await api.invoke('catalog:listAddonGroups');
    const wrap = el('#groups', c);
    wrap.innerHTML = '';
    for (const g of groups) {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '16px';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;"><div style="font-weight:700">${g.name}</div><span class="badge live">${g.addons_count} items</span></div>
        <div class="muted" style="font-size:12px; margin-bottom: 8px;">${g.name_ar ?? ''}</div>
        <div class="muted" style="margin-bottom: 12px; font-size: 12px;">Required: ${g.is_required ? 'Yes' : 'No'}, Max: ${g.max_select ?? '—'}</div>
        <button class="btn primary" data-group="${g.id}" style="width: 100%;">View Addons</button>
      `;
      card.querySelector('button')?.addEventListener('click', async () => {
        el('#groupHint', c).textContent = `Group: ${g.name}`;
        const list = await api.invoke('catalog:listAddons', g.id);
        const ad = el('#addons', c);
        ad.innerHTML = list.map(a => `
          <div class="card" style="padding: 14px;"><div style="display:flex; justify-content:space-between; gap:8px; margin-bottom: 4px;"><div style="font-weight:700">${a.name}</div><div><strong style="color: var(--success);">${fmtMoney(a.price)}</strong></div></div><div class="muted" style="font-size:12px;">${a.name_ar ?? ''}</div></div>
        `).join('');
      });
      wrap.appendChild(card);
    }
  })();
  return c;
}