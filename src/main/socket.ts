// socket-server.ts (main process)
import { createRequire as nodeCreateRequire } from 'node:module';
import type { WebSocketServer as WebSocketServerType, WebSocket as WebSocketType } from 'ws';

const cjsRequire = nodeCreateRequire(import.meta.url);
const Ws = cjsRequire('ws') as typeof import('ws');

let wss: WebSocketServerType | undefined;

export function createSocketServer(port = 8080) {
  wss = new Ws.WebSocketServer({ port }) as WebSocketServerType;

  wss.on('connection', (ws: WebSocketType) => {
    console.log('Client connected');

    ws.on('close', () => {
      console.log('Client disconnected');
    });
  });
}

export function broadcast(channel: string, data: unknown) {
  if (!wss) return;

  for (const client of wss.clients as Set<WebSocketType>) {
    if (client.readyState === Ws.OPEN) {
      client.send(JSON.stringify({ channel, data }));
    }
  }
}
