// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  store: {
    set: (k: string, v: string) => ipcRenderer.invoke('store:set', k, v),
    get: (k: string)          => ipcRenderer.invoke('store:get', k),
  },
sync: {
  configure: (baseUrl: string) => ipcRenderer.invoke('sync:configure', baseUrl),
  bootstrap: (baseUrl?: string | null) => ipcRenderer.invoke('sync:bootstrap', baseUrl ?? null), // ← one arg only
  pull: () => ipcRenderer.invoke('sync:pull'),
  push: (envelope: any, batch: any) => ipcRenderer.invoke('sync:push', envelope, batch),
  status: () => ipcRenderer.invoke('sync:status'),
  setMode: (next: 'live'|'offline') => ipcRenderer.invoke('sync:setMode', next),
  run: () => ipcRenderer.invoke('sync:run'),
},

  catalog: { search: (q: string) => ipcRenderer.invoke('catalog:search', q) },
auth: {
  status: () => ipcRenderer.invoke('auth:status'),
  listUsers: () => ipcRenderer.invoke('auth:listUsers'),
  loginWithPassword: (login: string, password: string) => ipcRenderer.invoke('auth:loginWithPassword', login, password),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Accept payload object OR positional args
  pair: (...args: any[]) => {
    const payload = (args.length === 1 && args[0] && typeof args[0] === 'object')
      ? args[0]
      : { baseUrl: args[0], pairCode: args[1], deviceName: args[2], branchId: args[3] };
    return ipcRenderer.invoke('auth:pair', payload);
  },

  unpair: () => ipcRenderer.invoke('auth:unpair'),
},
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
};

contextBridge.exposeInMainWorld('pos', bridge);
contextBridge.exposeInMainWorld('electronAPI', bridge);
contextBridge.exposeInMainWorld('api', { invoke: bridge.invoke });

console.log('[preload] exposed window.pos, window.electronAPI, window.api');
