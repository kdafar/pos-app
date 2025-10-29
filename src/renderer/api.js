const bridge = window.api;
if (!bridge || typeof bridge.invoke !== 'function') {
  throw new Error('Preload bridge unavailable. Check main.webPreferences.preload path and build output for preload.');
}

// Create a new api object with a wrapped invoke function
const api = {
  invoke: async (channel, ...args) => {
    try {
      return await bridge.invoke(channel, ...args);
    } catch (e) {
      if (e && e.name === 'AuthError') {
        console.log('AuthError caught globally, reloading window to re-pair.');
        location.hash = '#/pair';
        location.reload();
        return new Promise(() => {}); // never resolves; stops further code
      }
      throw e; // Re-throw other errors
    }
  }
};

export default api;