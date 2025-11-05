import { useState, useEffect } from 'react';
import { create } from 'zustand';

// ... (rest of the file is the same)

export const useOrderStore = create<OrderState>((set, get) => ({
  // ... (rest of the state is the same)
  actions: {
    // ... (rest of the actions are the same)
    connectToSocket: () => {
      const ws = new WebSocket('ws://localhost:8080');

      ws.onopen = () => {
        console.log('Connected to websocket server');
      };

      ws.onmessage = (event) => {
        const { channel, data } = JSON.parse(event.data);

        if (channel === 'orders:updated') {
          get().actions.loadActiveOrders();
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from websocket server');
      };
    },
  },
}));
