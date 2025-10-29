import api from '../api.js';

export async function getStoredTheme() {
  const t = await api.invoke('store:get', 'ui.theme');
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export async function setStoredTheme(theme) {
  await api.invoke('store:set', 'ui.theme', theme);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
}

export async function getSidebarCollapsed() {
  return (await api.invoke('store:get', 'ui.sidebar_collapsed')) === '1';
}

export async function setSidebarCollapsed(on) {
  await api.invoke('store:set', 'ui.sidebar_collapsed', on ? '1' : '0');
}

export function applySidebar(on) {
  document.getElementById('appLayout')?.classList.toggle('collapsed', !!on);
}

export async function refreshBrandLabel() {
  const brandEl = document.getElementById('brandLabel');
  if (!brandEl) return;
  let name = await api.invoke('store:get', 'branch.name');
  if (!name || !name.trim()) {
    const id = await api.invoke('store:get', 'branch_id');
    name = id ? `Branch #${id}` : 'POS';
  }
  brandEl.textContent = `🍣 ${name}`;
}