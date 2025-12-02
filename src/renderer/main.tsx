import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { HeroUIProvider } from '@heroui/react';
import App from './App.tsx';
import './styles/tailwind.css';
import { ThemeProvider } from '../context/ThemeContext';
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
    const prefersLight = window.matchMedia?.(
      '(prefers-color-scheme: light)'
    ).matches;
    const theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : prefersLight
        ? 'light'
        : 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('bg-white', theme === 'light');
  } catch (e) {
    console.error('Failed to init theme:', e);
  }
}

// ✅ use BrowserRouter in dev, HashRouter in prod
const Router =
  import.meta.env.MODE === 'development' ? BrowserRouter : HashRouter;

// (Optional) dev helper to catch root-relative fetch/xhr (see section 2)
import './rootRelativeGuard';

try {
  ensureBridge();
  (async () => {
    await initTheme();
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ThemeProvider>
          <Router>
            <HeroUIProvider>
              <ToastProvider>
                <ConfirmDialogProvider>
                  <App />
                </ConfirmDialogProvider>
              </ToastProvider>
            </HeroUIProvider>
          </Router>
        </ThemeProvider>
      </React.StrictMode>
    );
  })();
} catch (e) {
  console.error(e);
}
