import { el } from '../src/renderer/utils.js';
import api from '../src/renderer/api.js';

export function PairingPage() {
  const c = document.createElement('div');
  c.style.cssText = 'display: grid; place-items: center; height: 100%;';

  c.innerHTML = `
    <div class="card" style="width: 100%; max-width: 450px;">
      <div class="toolbar" style="margin-bottom: 24px;">
        <h3>Device Pairing</h3>
        <span class="muted">Connect to Server</span>
      </div>

      <div class="form-group">
        <label class="form-label">Server Base URL</label>
        <input type="text" id="baseUrl" placeholder="e.g., https://your-server.com" />
      </div>

      <div class="form-group">
        <label class="form-label">Device Name</label>
        <input type="text" id="deviceName" placeholder="e.g., Main Counter POS" />
      </div>

      <div class="form-group">
        <label class="form-label">Branch ID</label>
        <input type="text" id="branchId" placeholder="Enter the branch ID" />
      </div>

      <div class="form-group">
        <label class="form-label">Pairing Code</label>
        <input type="text" id="pairCode" placeholder="Enter code from server" />
      </div>

      <div style="margin-top: 24px; text-align: right;">
        <button class="btn primary" id="btnPair">Pair Device</button>
      </div>
      <div id="pairError" style="color: var(--danger); margin-top: 16px; font-size: 13px; text-align: center;"></div>
    </div>
  `;

  const $ = (sel) => c.querySelector(sel); // avoid utils.el scoping pitfalls
  const btn = $('#btnPair');
  const errorDiv = $('#pairError');

  btn.addEventListener('click', async () => {
    const baseUrl   = $('#baseUrl')?.value.trim();
    const deviceName= $('#deviceName')?.value.trim();
    const branchId  = $('#branchId')?.value.trim();
    const pairCode  = $('#pairCode')?.value.trim();

    if (!baseUrl || !pairCode || !branchId || !deviceName) {
      errorDiv.textContent = 'All fields are required.';
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Pairing...';
    errorDiv.textContent = '';

    try {
      // 1) Pair ONCE
      const { deviceId } = await api.invoke('sync:pair', baseUrl, pairCode, branchId, deviceName);
      if (!deviceId) throw new Error('Pairing failed. No device ID returned.');

      // 2) Configure and 3) Bootstrap so branch meta is written (branch.name, branch.id)
      await api.invoke('sync:configure', baseUrl);
      await api.invoke('sync:bootstrap', baseUrl);

      // 4) Go to orders and hard reload so the app re-renders as paired
      location.hash = '#/orders';
      window.location.reload();
    } catch (e) {
      console.error('Pairing failed:', e);
      errorDiv.textContent = e?.message || 'An unknown error occurred during pairing.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Pair Device';
    }
  });

  // Pre-fill server URL if stored
  (async () => {
    const savedUrl = await api.invoke('store:get', 'server.base_url');
    if (savedUrl) { const inp = $('#baseUrl'); if (inp) inp.value = savedUrl; }
  })();

  return c;
}
