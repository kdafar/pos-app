import { el } from '../utils.js';

const api = window.api;

export function SettingsPage() {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.cssText = 'margin: 24px; padding: 24px;';
  c.innerHTML = `
    <div class="toolbar" style="margin-bottom: 20px;">
      <h3>Settings</h3>
      <span class="muted">Manage device and server config (local KV)</span>
    </div>
    <div id="kv" style="margin-bottom: 20px;"></div>
    <div style="display:flex; gap:12px;">
      <input type="text" id="setKey" placeholder="key" style="flex: 1;"/>
      <input type="text" id="setVal" placeholder="value" style="flex: 2;" />
      <button class="btn primary" id="btnSave">Save</button>
    </div>
  `;
  async function load() {
    const rows = await api.invoke('settings:getAll');
    const box = el('#kv', c);
    box.innerHTML = rows.map(r => `<div class="total-row"><div class="muted">${r.key}</div><div>${r.value ?? ''}</div></div>`).join('');
  }
  el('#btnSave', c).addEventListener('click', async () => {
    const k = el('#setKey', c).value.trim();
    if (!k) return;
    await api.invoke('settings:set', k, el('#setVal', c).value);
    el('#setKey', c).value = ''; el('#setVal', c).value = '';
    load();
  });
  load();
  return c;
}