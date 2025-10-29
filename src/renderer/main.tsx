import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HeroUIProvider } from '@heroui/react';
import App from './App.tsx';
import './styles/tailwind.css';

// --- FIX ---
// The 'preload.ts' file you provided exposes 'window.electronAPI',
// but this file was looking for 'window.api'. I've updated it to match.
declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      // Add any other methods from your preload here
      // e.g., bootstrap, pull, push, pair, onForceRePair
      bootstrap: (baseUrl: string) => Promise<any>;
      pull: () => Promise<any>;
      push: (envelope: any, batch: any) => Promise<any>;
      pair: (args: any) => Promise<any>;
      onForceRePair: (callback: () => void) => void;
    };
  }
}

function ensureBridge() {
  // --- FIX ---
  // Updated to check for 'window.electronAPI'
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') {
    const msg = 'Preload bridge "window.electronAPI" is unavailable. Check webPreferences.preload + build output.';
    document.body.innerHTML = `<div style="padding:16px;color:#fca5a5">${msg}</div>`;
    throw new Error(msg);
  }
}

async function initTheme() {
  try {
    // --- FIX ---
    // Updated to use 'window.electronAPI'
    const stored = await window.electronAPI!.invoke('store:get', 'ui.theme');
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
    const theme = stored === 'light' || stored === 'dark' ? stored : (prefersLight ? 'light' : 'dark');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('bg-white', theme === 'light');
  } catch (e) {
    console.error('Failed to init theme:', e);
  }
}

async function bootstrap() {
  // Note: ensureBridge() is not called here, which might be a bug.
  // You may want to call ensureBridge() here first.
  // ensureBridge(); 
  
  await initTheme();
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <HeroUIProvider>
          <App />
        </HeroUIProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

// --- NOTE ---
// Calling ensureBridge() here, *before* initTheme,
// is safer to make sure the API exists.
try {
  ensureBridge();
  bootstrap();
} catch (e) {
  console.error(e);
}
