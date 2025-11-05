import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer;

export function createSocketServer() {
  wss = new WebSocketServer({ port: 8080 });

  wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('close', () => {
      console.log('Client disconnected');
    });
  });
}

export function broadcast(channel: string, data: any) {
  if (!wss) {
    return;
  }

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ channel, data }));
    }
  });
}