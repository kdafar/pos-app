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
  },
  catalog: {
    search: (q: string) => ipcRenderer.invoke('catalog:search', q),
  },
  // generic invoke if you still want it
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
};

// expose the SAME object under multiple names for compatibility
contextBridge.exposeInMainWorld('pos', bridge);
contextBridge.exposeInMainWorld('electronAPI', bridge); // ⬅️ add this alias
contextBridge.exposeInMainWorld('api', { invoke: bridge.invoke }); // keep your old api.invoke
console.log('[preload] exposed window.pos, window.electronAPI, window.api');
