// src/renderer/rootRelativeGuard.ts
const isRootRelative = (u: string) => /^\/(?!\/)/.test(u);

(function guardFetchAndXHR() {
  try {
    const origFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String((input as any).url || input);
      if (isRootRelative(url)) {
        const err = new Error(`[guard] Root-relative fetch blocked: ${url}`);
        console.error(err);
        // convert to relative so the app keeps running
        const fixed = new URL(`.${url}`, window.location.href).toString();
        return origFetch(fixed, init);
      }
      return origFetch(input as any, init);
    };

    const OrigXHR = window.XMLHttpRequest;
    // @ts-ignore
    window.XMLHttpRequest = function XHRGuard(this: XMLHttpRequest) {
      const xhr = new OrigXHR();
      const origOpen = xhr.open;
      xhr.open = function(method: string, url: string, ...rest: any[]) {
        if (typeof url === 'string' && isRootRelative(url)) {
          const err = new Error(`[guard] Root-relative XHR blocked: ${url}`);
          console.error(err);
          url = `.${url}`;
        }
        // @ts-ignore
        return origOpen.apply(this, [method, url, ...rest]);
      };
      return xhr;
    } as any;
  } catch (e) {
    console.warn('[guard] install failed', e);
  }
})();
