import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import './renderer/styles/tailwind.css';
import { ThemeProvider } from './context/ThemeContext';
import { HeroUIProvider } from '@heroui/react';
import { ConfirmDialogProvider } from './renderer/components/ConfirmDialogProvider';
import { ToastProvider } from './renderer/components/ToastProvider';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <HeroUIProvider>
        <HashRouter>
          <ToastProvider>
            <ConfirmDialogProvider>
              <App />
            </ConfirmDialogProvider>
          </ToastProvider>
        </HashRouter>
      </HeroUIProvider>
    </ThemeProvider>
  </React.StrictMode>
);

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message);
});
