// services/websocket.js
const WebSocket = require('ws');
const { dbGet } = require('../db');

let wsClients = new Map();
let latestPrices = {};
let wss;

function initWS(server) {
  wss = new WebSocket.Server({ server });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const session = token
      ? dbGet("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now','localtime')", [token])
      : null;
    if (!session) { ws.close(4001, 'Unauthorized'); return; }
    wsClients.set(token, ws);
    if (Object.keys(latestPrices).length > 0)
      ws.send(JSON.stringify({ type: 'snapshot', data: Object.values(latestPrices) }));
    ws.on('close', () => wsClients.delete(token));
  });
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

module.exports = { initWS, broadcast, latestPrices, wsClients };