import { contextBridge, ipcRenderer } from 'electron';

// src/preload/index.ts
contextBridge.exposeInMainWorld('pos', {
  store: {
    set: (k: string, v: string) => ipcRenderer.invoke('store:set', k, v),
    get: (k: string) => ipcRenderer.invoke('store:get', k),
  },
  sync: {
    configure: (baseUrl: string) => ipcRenderer.invoke('sync:configure', baseUrl),
    bootstrap: (baseUrl: string | null, pairCode: string) => ipcRenderer.invoke('sync:bootstrap', baseUrl, pairCode),
    pull: () => ipcRenderer.invoke('sync:pull'),
    push: (envelope: any, batch: any) => ipcRenderer.invoke('sync:push', envelope, batch),
  },
  catalog: {
    search: (q: string) => ipcRenderer.invoke('catalog:search', q),
  }
});

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

declare global {
  interface Window {
    pos: {
      store: { set(k:string,v:string):Promise<void>; get(k:string):Promise<string|null> };
      sync: {
        configure(baseUrl:string):Promise<void>;
        bootstrap(baseUrl:string|null, pairCode:string):Promise<{deviceId:string}>;
        pull():Promise<void>;
        push(envelope:any,batch:any):Promise<any>;
      };
      catalog: { search(q:string):Promise<any[]> };
    };
    api: { invoke(channel:string, ...args:any[]):Promise<any> };
  }
}

