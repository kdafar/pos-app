import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tailwind.css';

declare global {
  interface Window {
    api?: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

function ensureBridge() {
  if (!window.api || typeof window.api.invoke !== 'function') {
    const msg = 'Preload bridge unavailable. Check webPreferences.preload + build output.';
    document.body.innerHTML = `<div style="padding:16px;color:#fca5a5">${msg}</div>`;
    throw new Error(msg);
  }
}

async function initTheme() {
  try {
    const stored = await window.api!.invoke('store:get', 'ui.theme');
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
    const theme = stored === 'light' || stored === 'dark' ? stored : (prefersLight ? 'light' : 'dark');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('bg-white', theme === 'light');
  } catch {}
}

async function bootstrap() {
  ensureBridge();
  await initTheme();
  const { default: App } = await import('./App');
  createRoot(document.getElementById('root')!).render(<App />);
}

bootstrap();
