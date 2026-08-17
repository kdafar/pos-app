import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { HeroUIProvider } from '@heroui/react';
import App from './App.tsx';
import './styles/tailwind.css';
import { ThemeProvider } from '../context/ThemeContext';
import { I18nProvider } from './i18n';
import { ConfirmDialogProvider } from './../renderer/components/ConfirmDialogProvider';
import { ToastProvider } from './../renderer/components/ToastProvider';
declare global {
  interface Window {
    electronAPI?: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

function ensureBridge() {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    const msg = 'Preload bridge "window.electronAPI" is unavailable.';
    document.body.innerHTML = `<div style="padding:16px;color:#fca5a5">${msg}</div>`;
    throw new Error(msg);
  }
}

async function initTheme() {
  try {
    const stored = await window.electronAPI!.invoke('store:get', 'ui.theme');
    const prefersDark = window.matchMedia?.(
      '(prefers-color-scheme: dark)'
    ).matches;
    // Light is the default on a till. A counter is lit for reading receipts and
    // handling cash, and a dark UI in a bright room fights the glare rather
    // than the other way round. A shop that wants dark still gets it — either
    // from the OS preference or from the toggle, which is remembered.
    const theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : prefersDark
        ? 'dark'
        : 'light';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('bg-content1', theme === 'light');
  } catch (e) {
    console.error('Failed to init theme:', e);
  }
}

// ✅ use BrowserRouter in dev, HashRouter in prod
const Router =
  import.meta.env.MODE === 'development' ? BrowserRouter : HashRouter;

// (Optional) dev helper to catch root-relative fetch/xhr (see section 2)
import './rootRelativeGuard';
import { loadAndApplyBrandTheme } from './theme/brand';

try {
  ensureBridge();
  (async () => {
    await initTheme();
    // Brand colours are the operator's, not ours. Applied before first paint so
    // the till never flashes the fallback palette on the way to the real one;
    // it never rejects, so a shop with no branding still opens.
    await loadAndApplyBrandTheme();
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ThemeProvider>
          <I18nProvider>
          <Router>
            <HeroUIProvider>
              <ToastProvider>
                <ConfirmDialogProvider>
                  <App />
                </ConfirmDialogProvider>
              </ToastProvider>
            </HeroUIProvider>
          </Router>
          </I18nProvider>
        </ThemeProvider>
      </React.StrictMode>
    );
  })();
} catch (e) {
  console.error(e);
}
