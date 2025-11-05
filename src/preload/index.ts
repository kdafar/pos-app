// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  store: {
    set: (k: string, v: string) => ipcRenderer.invoke('store:set', k, v),
    get: (k: string)          => ipcRenderer.invoke('store:get', k),
  },
  sync: {
    configure: (baseUrl: string)                      => ipcRenderer.invoke('sync:configure', baseUrl),
    bootstrap: (baseUrl: string | null, pairCode: string) => ipcRenderer.invoke('sync:bootstrap', baseUrl, pairCode),
    pull: ()                                          => ipcRenderer.invoke('sync:pull'),
    push: (envelope: any, batch: any)                 => ipcRenderer.invoke('sync:push', envelope, batch),
    status: ()                                        => ipcRenderer.invoke('sync:status'),
    setMode: (next: 'live'|'offline')                 => ipcRenderer.invoke('sync:setMode', next),
    run: ()                                           => ipcRenderer.invoke('sync:run'),
  },
  catalog: { search: (q: string) => ipcRenderer.invoke('catalog:search', q) },
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    listUsers: () => ipcRenderer.invoke('auth:listUsers'),
    loginWithPin: (pin: string) => ipcRenderer.invoke('auth:loginWithPin', pin),
    loginWithPassword: (login: string, password: string) => ipcRenderer.invoke('auth:loginWithPassword', login, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    pair: (baseUrl: string, pairCode: string, deviceName?: string, branchId?: number) =>
      ipcRenderer.invoke('auth:pair', { baseUrl, pairCode, deviceName, branchId }),
    unpair: () => ipcRenderer.invoke('auth:unpair'),
  },
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
};

contextBridge.exposeInMainWorld('pos', bridge);
contextBridge.exposeInMainWorld('electronAPI', bridge);
contextBridge.exposeInMainWorld('api', { invoke: bridge.invoke });

console.log('[preload] exposed window.pos, window.electronAPI, window.api');
