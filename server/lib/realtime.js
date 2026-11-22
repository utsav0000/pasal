// WebSocket gateway: authenticated per-user channels, presence, typing, read receipts.
import { WebSocketServer } from 'ws';
import { parseCookies } from './http.js';

const sockets = new Map(); // userId -> Set<ws>
let wss;
let resolveUser = () => null;
const handlers = {};

export function onClientEvent(type, fn) { handlers[type] = fn; }

export function attachRealtime(server, sessionResolver) {
  resolveUser = sessionResolver;
  wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    const user = resolveUser(parseCookies(req.headers.cookie).pasal_sid);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = user.id;
      ws.isAlive = true;
      let set = sockets.get(user.id);
      const wasOffline = !set || set.size === 0;
      if (!set) sockets.set(user.id, (set = new Set()));
      set.add(ws);
      if (wasOffline) handlers.presence?.(user.id, true);
      ws.on('pong', () => (ws.isAlive = true));
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg && typeof msg.type === 'string' && handlers[msg.type]) {
          try { handlers[msg.type](user.id, msg.data || {}); } catch { /* ignore client errors */ }
        }
      });
      ws.on('close', () => {
        set.delete(ws);
        if (set.size === 0) {
          sockets.delete(user.id);
          handlers.presence?.(user.id, false);
        }
      });
      ws.send(JSON.stringify({ type: 'hello', data: { userId: user.id } }));
    });
  });
  const iv = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  iv.unref();
}

export function emitTo(userId, type, data) {
  const set = sockets.get(Number(userId));
  if (!set) return;
  const payload = JSON.stringify({ type, data });
  for (const ws of set) if (ws.readyState === 1) ws.send(payload);
}

export const isOnline = (userId) => (sockets.get(Number(userId))?.size || 0) > 0;
export const closeRealtime = () => wss?.close();
