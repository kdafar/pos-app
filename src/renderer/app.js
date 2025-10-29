import { OrdersPage } from './pages/OrdersPage.js';
import { CategoriesPage } from './pages/CategoriesPage.js';
import { ItemsPage } from './pages/ItemsPage.js';
import { AddonsPage } from './pages/AddonsPage.js';
import { PromosPage } from './pages/PromosPage.js';
import { RecentOrdersPage } from './pages/RecentOrdersPage.js';
import { TablesPage } from './pages/TablesPage.js';
import { PaymentMethodsPage } from './pages/PaymentMethodsPage.js';
import { LocationsPage } from './pages/LocationsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { PairingPage } from './pages/PairingPage.js';
import { getStoredTheme, applyTheme, setStoredTheme, getSidebarCollapsed, applySidebar, setSidebarCollapsed, refreshBrandLabel } from './ui/sidebar.js';
import api from './api.js';
import { el, setActiveRoute } from './utils.js';

// --- INJECT MODAL CSS ---
// We add this dynamically to ensure the new modal is styled
function injectModalCSS() {
  const style = document.createElement('style');
  style.textContent = `
    .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(5px); display: grid; place-items: center; z-index: 1000; opacity: 0; animation: fadeIn 0.2s ease forwards; }
    @keyframes fadeIn { to { opacity: 1; } }
    .modal { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 20px; width: 100%; max-width: 500px; box-shadow: var(--shadow-lg); overflow: hidden; display: flex; flex-direction: column; transform: scale(0.95); animation: scaleIn 0.2s 0.05s ease forwards; }
    @keyframes scaleIn { to { transform: scale(1); } }
    .modal-header { padding: 18px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .modal-title { font-size: 18px; font-weight: 700; }
    .modal-close { width: 32px; height: 32px; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); border-radius: 10px; cursor: pointer; display: grid; place-items: center; transition: all 0.2s; }
    .modal-close:hover { background: var(--surface-hover); border-color: var(--border-light); }
    .modal-body { padding: 24px; max-height: 65vh; overflow-y: auto; }
    .form-group { margin-bottom: 16px; }
    .form-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; display: block; }
    .modal-body input[type="text"], .modal-body input[type="tel"], .modal-body textarea { width: 100%; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; color: var(--text-primary); font-size: 14px; outline: none; transition: all 0.2s; }
    .modal-body textarea { min-height: 80px; resize: vertical; }
    .modal-body input[type="text"]:focus, .modal-body input[type="tel"]:focus, .modal-body textarea:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 4px var(--accent-glow); }
    .payment-methods { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
    .payment-method { padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; cursor: pointer; text-align: center; transition: all 0.2s; font-size: 13px; font-weight: 500; }
    .payment-method:hover { background: var(--surface-hover); transform: translateY(-1px); }
    .payment-method.selected { background: linear-gradient(135deg, var(--accent-primary), var(--purple)); border-color: transparent; color: white; box-shadow: var(--shadow-glow); }
    .modal-footer { padding: 20px 24px; border-top: 1px solid var(--border); background: var(--bg-primary); display: flex; justify-content: flex-end; gap: 12px; }
  `;
  document.head.appendChild(style);
}

/* ---------- Router ---------- */
const routes = {
  '#/orders': OrdersPage,
  '#/catalog/categories': CategoriesPage,
  '#/catalog/items': ItemsPage,
  '#/catalog/addons': AddonsPage,
  '#/catalog/promos': PromosPage,
  '#/orders/recent': RecentOrdersPage,
  '#/dinein/tables': TablesPage,
  '#/system/payment-methods': PaymentMethodsPage,
  '#/system/locations': LocationsPage,
  '#/settings': SettingsPage,
  '#/pair': PairingPage, // Add the pairing page to the routes
};

let currentPage = null;
function renderRoute(force = false) {
  let target = location.hash || '#/orders';
  // Not paired? always show pairing
  if (!isPaired) target = '#/pair';
  // Paired but still on #/pair? bump to orders
  if (isPaired && target === '#/pair') target = '#/orders';

  // Keep the URL hash in sync so refreshes return here
  if (location.hash !== target) location.hash = target;

  if (!force && currentPage === target) return;

  setActiveRoute(target);
  const factory = routes[target] || (isPaired ? OrdersPage : PairingPage);
  const root = el('#app');
  root.innerHTML = '';
  root.appendChild(factory());
  currentPage = target;
}

let isPaired = false;

window.addEventListener('hashchange', renderRoute);

window.addEventListener('DOMContentLoaded', async () => {
  try {
    injectModalCSS();

    // Theme
    const theme = await getStoredTheme();
    applyTheme(theme);
    const btnTheme = document.getElementById('themeToggle');
    if (btnTheme) {
      btnTheme.addEventListener('click', async () => {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        await setStoredTheme(next);
      });
    }

    // Sidebar
    applySidebar(await getSidebarCollapsed());
    const btnCol = document.getElementById('collapseToggle');
    if (btnCol) {
      btnCol.addEventListener('click', async () => {
        const next = !(await getSidebarCollapsed());
        applySidebar(next);
        await setSidebarCollapsed(next);
      });
    }

    try {
      const status = await api.invoke('sync:getStatus');
      console.log('[DEBUG] Renderer received status:', status);
      isPaired = !!status.paired;
    } catch (e) {
      console.error('[DEBUG] Error getting status in renderer:', e);
      if (e.name !== 'AuthError') console.error('sync:getStatus failed:', e);
      isPaired = false;
    }
    renderRoute(true);

    // Brand
    await refreshBrandLabel();
  } catch (e) {
    console.error('Failed to initialize app:', e.message);
  }
});