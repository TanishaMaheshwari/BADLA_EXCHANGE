const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// ─── SQLite setup ────────────────────────────────────────────────────────────
const db = new Database('badla.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token     TEXT PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS dashboard_instruments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    instrument_name TEXT NOT NULL,
    position    INTEGER DEFAULT 0,
    added_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, instrument_name),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deals (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL,
      instrument        TEXT NOT NULL,
      qty               REAL NOT NULL,
      note              TEXT,
      usd_inr_rate      REAL NOT NULL DEFAULT 89,
      dginr_at_entry    REAL,
      -- MCX leg
      mcx_side          TEXT NOT NULL,
      mcx_price         REAL NOT NULL,
      mcx_brokerage     REAL NOT NULL DEFAULT 0,
      mcx_exit_price    REAL,
      mcx_pnl           REAL,
      -- COMEX leg
      comex_side        TEXT NOT NULL,
      comex_price       REAL NOT NULL,
      comex_brokerage   REAL NOT NULL DEFAULT 0,
      comex_exit_price  REAL,
      comex_pnl         REAL,
      -- DGCX leg (optional)
      dgcx_enabled      INTEGER NOT NULL DEFAULT 0,
      dgcx_side         TEXT,
      dgcx_price        REAL,
      dgcx_brokerage    REAL NOT NULL DEFAULT 0,
      dgcx_exit_price   REAL,
      dgcx_pnl          REAL,
      -- Summary
      status            TEXT DEFAULT 'open',
      total_pnl         REAL,
      entry_time        TEXT DEFAULT (datetime('now')),
      exit_time         TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
`);

// ─── Helper: hash password ───────────────────────────────────────────────────
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'badlaboard_salt').digest('hex');
}

// ─── Helper: create default admin if no users exist ─────────────────────────
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hashPassword('admin123'));
  console.log('Default user created: admin / admin123  — change this immediately!');
}

// ─── Auth middleware ─────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

// ─── In-memory price store ───────────────────────────────────────────────────
let latestPrices = {};
let wsClients = new Map(); // token -> ws

// ─── WebSocket ───────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  // Extract token from query string: ws://localhost:3000?token=xxx
  const url = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token');

  const session = token ? db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) : null;
  if (!session) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const userId = session.user_id;
  wsClients.set(token, ws);

  // Send snapshot of all current prices
  if (Object.keys(latestPrices).length > 0) {
    ws.send(JSON.stringify({ type: 'snapshot', data: Object.values(latestPrices) }));
  }

  ws.on('close', () => wsClients.delete(token));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ─── Badla calculation ───────────────────────────────────────────────────────
function calculateBadla(data) {
  const latestTimestamp = Object.keys(data)[0];
  const latestData = data[latestTimestamp];
  if (!latestData || !latestData.raw_data) return null;

  const { equation, duty } = latestData.raw_data;
  const instruments = latestData.raw_data.data;
  if (!instruments || instruments.length < 2) return null;

  const mcxData   = instruments.find(i => i.exchange === 'MCX')?? instruments[0];
  const comexData = instruments.find(i => i.exchange === 'COMEX' || i.exchange === 'SPOT')?? instruments[1]; 
  const dgcxData  = instruments.find(i => i.exchange === 'DGCX')?? instruments[2]; 
  if (!comexData) return null;

  const reverse = latestData.reverse || "0";

  try {
    const L1 = comexData.last_price;
    const L2 = mcxData ? mcxData.last_price : 0;
    const L3 = dgcxData ? (10000 / dgcxData.last_price) : 1;
    const D1 = parseFloat(duty);

    const evalEq = (eq, l1, l2, l3) => {
      let e = eq.replace(/L1/g, l1).replace(/L2/g, l2).replace(/L3/g, l3).replace(/D1/g, D1);
      return eval(e);
    };

    const ltp  = evalEq(equation, L1, L2, L3);

    // FIXED: BUY uses COMEX bid, SELL uses COMEX ask (corrected swap)
    const buy  = evalEq(equation,
      comexData.buy_price_0  || L1,
      mcxData ? (mcxData.buy_price_0  || L2) : 0,
      dgcxData ? (10000 / (dgcxData.sell_price_0 || dgcxData.last_price)) : 1
    );
    const sell = evalEq(equation,
      comexData.sell_price_0 || L1,
      mcxData ? (mcxData.sell_price_0 || L2) : 0,
      dgcxData ? (10000 / (dgcxData.buy_price_0  || dgcxData.last_price)) : 1
    );

    const finalLTP  = reverse === "1" ? ltp  - L2 : L2 - ltp;
    // FIXED: swap buy/sell labels to match original site
    const finalBUY  = reverse === "1" ? sell  - (mcxData ? mcxData.buy_price_0  : 0) : (mcxData ? mcxData.buy_price_0  : 0) - sell;
    const finalSELL = reverse === "1" ? buy - (mcxData ? mcxData.sell_price_0 : 0) : (mcxData ? mcxData.sell_price_0 : 0) - buy;

    // Converted COMEX: equation result using LTP prices (for display as subtitle)
    const convertedComex = evalEq(equation, L1, 0, L3); // equation value in INR without MCX component

    return {
      id:           latestData.instrument_id,
      name:         latestData.instrument_name,
      displayName:  latestData.raw_data.displayName || latestData.instrument_name,
      type:         latestData.badla_type,
      timestamp:    latestTimestamp,
      badlaLTP:     finalLTP.toFixed(2),
      badlaBUY:     finalBUY.toFixed(2),
      badlaSELL:    finalSELL.toFixed(2),
      mcx:          mcxData   ? { bid: mcxData.buy_price_0,   ask: mcxData.sell_price_0,   ltp: mcxData.last_price,   convertedComex: convertedComex.toFixed(2) } : null,
      comex:        comexData ? { bid: comexData.buy_price_0, ask: comexData.sell_price_0, ltp: comexData.last_price } : null,
      dgcx:         dgcxData  ? { ltp: dgcxData.last_price,   converted: (10000 / dgcxData.last_price).toFixed(4)   } : null,
    };
  } catch (e) {
    return null;
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth routes ─────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.json({ token, username: user.username });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const token = req.headers['x-session-token'];
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

// ─── Admin: add user (requires auth, add your own admin check if needed) ─────
app.post('/api/admin/users', requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashPassword(password));
    res.json({ ok: true, username });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

// ─── Price push (from Python) ────────────────────────────────────────────────
app.post('/api/push', (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) return res.status(400).json({ error: 'missing name or data' });
  const result = calculateBadla(data);
  if (result) {
    latestPrices[name] = result;
    broadcast({ type: 'update', data: result });
  }
  res.json({ ok: true });
});

// ─── Prices (REST fallback) ──────────────────────────────────────────────────
app.get('/api/prices', requireAuth, (req, res) => {
  res.json(Object.values(latestPrices));
});

// ─── Dashboard instruments ───────────────────────────────────────────────────
app.get('/api/dashboard', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT instrument_name, position FROM dashboard_instruments WHERE user_id = ? ORDER BY position'
  ).all(req.user.id);
  res.json(rows);
});

app.post('/api/dashboard', requireAuth, (req, res) => {
  const { instrument_name } = req.body;
  if (!instrument_name) return res.status(400).json({ error: 'Missing instrument_name' });
  const maxPos = db.prepare('SELECT MAX(position) as m FROM dashboard_instruments WHERE user_id = ?').get(req.user.id);
  const pos = (maxPos.m ?? -1) + 1;
  try {
    db.prepare('INSERT INTO dashboard_instruments (user_id, instrument_name, position) VALUES (?, ?, ?)').run(req.user.id, instrument_name, pos);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Already on dashboard' });
  }
});

app.delete('/api/dashboard/:name', requireAuth, (req, res) => {
  db.prepare('DELETE FROM dashboard_instruments WHERE user_id = ? AND instrument_name = ?').run(req.user.id, decodeURIComponent(req.params.name));
  res.json({ ok: true });
});

// ─── Deals ───────────────────────────────────────────────────────────────────
app.get('/api/deals', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM deals WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json(rows.map(dealToFrontend));
});

app.post('/api/deals', requireAuth, (req, res) => {
  const {
    instrument, note, usdInrRate, dginrAtEntry,
    mcxSide, mcxPrice, mcxQty, mcxBrokerage,
    comexSide, comexPrice, comexQty, comexBrokerage,
    dgcxEnabled, dgcxSide, dgcxPrice, dgcxQty, dgcxBrokerage
  } = req.body;

  const info = db.prepare(`
    INSERT INTO deals (
      user_id, instrument, qty, note, usd_inr_rate, dginr_at_entry,
      mcx_side, mcx_price, mcx_qty, mcx_brokerage,
      comex_side, comex_price, comex_qty, comex_brokerage,
      dgcx_enabled, dgcx_side, dgcx_price, dgcx_qty, dgcx_brokerage
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.id, instrument,
    parseFloat(mcxQty) || 1,  // keep qty as mcx_qty for backwards compat
    note || '',
    parseFloat(usdInrRate) || 89,
    parseFloat(dginrAtEntry) || null,
    mcxSide, parseFloat(mcxPrice), parseFloat(mcxQty) || 1, parseFloat(mcxBrokerage) || 0,
    comexSide, parseFloat(comexPrice), parseFloat(comexQty) || 1, parseFloat(comexBrokerage) || 0,
    dgcxEnabled ? 1 : 0,
    dgcxEnabled ? dgcxSide : null,
    dgcxEnabled ? parseFloat(dgcxPrice) : null,
    dgcxEnabled ? parseFloat(dgcxQty) || 1 : 1,
    parseFloat(dgcxBrokerage) || 0
  );
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(info.lastInsertRowid);
  res.json(dealToFrontend(deal));
});

app.put('/api/deals/:id/close', requireAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ? AND user_id = ?')
    .get(parseInt(req.params.id), req.user.id);
  if (!deal) return res.status(404).json({ error: 'Not found' });

  const { mcxExitPrice, comexExitPrice, dgcxExitPrice } = req.body;
  const rate = deal.usd_inr_rate || 89;

  const mExit = parseFloat(mcxExitPrice);
  const cExit = parseFloat(comexExitPrice);

  const mcxQty   = deal.mcx_qty   || deal.qty || 1;
  const comexQty = deal.comex_qty || deal.qty || 1;

  const mcxPnl   = (deal.mcx_side   === 'SELL'
    ? (deal.mcx_price   - mExit)
    : (mExit - deal.mcx_price))   * mcxQty   - (deal.mcx_brokerage   || 0);

  const comexPnl = (deal.comex_side === 'SELL'
    ? (deal.comex_price - cExit)
    : (cExit - deal.comex_price)) * comexQty * rate - (deal.comex_brokerage || 0);

  let dgcxPnl = 0, dExit = null;
  if (deal.dgcx_enabled && dgcxExitPrice) {
    const dgcxQty = deal.dgcx_qty || deal.qty || 1;
    dExit    = parseFloat(dgcxExitPrice);
    dgcxPnl  = (deal.dgcx_side === 'SELL'
      ? (deal.dgcx_price - dExit)
      : (dExit - deal.dgcx_price)) * dgcxQty * rate - (deal.dgcx_brokerage || 0);
  }

  const totalPnl = mcxPnl + comexPnl + dgcxPnl;

  db.prepare(`
    UPDATE deals SET
      mcx_exit_price=?, mcx_pnl=?,
      comex_exit_price=?, comex_pnl=?,
      dgcx_exit_price=?, dgcx_pnl=?,
      total_pnl=?, status='closed', exit_time=datetime('now')
    WHERE id=?
  `).run(mExit, mcxPnl, cExit, comexPnl, dExit, dgcxPnl, totalPnl, deal.id);

  const updated = db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id);
  res.json(dealToFrontend(updated));
});

app.delete('/api/deals/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM deals WHERE id = ? AND user_id = ?').run(parseInt(req.params.id), req.user.id);
  res.json({ ok: true });
});

// Convert snake_case DB row to camelCase for frontend
function dealToFrontend(d) {
  return {
    id: d.id, instrument: d.instrument,
    qty: d.qty, note: d.note,
    usdInrRate: d.usd_inr_rate, dginrAtEntry: d.dginr_at_entry,
    status: d.status, entryTime: d.entry_time, exitTime: d.exit_time,
    totalPnl: d.total_pnl,
    mcx:   { side: d.mcx_side,   entryPrice: d.mcx_price,   qty: d.mcx_qty   || d.qty, brokerage: d.mcx_brokerage,   exitPrice: d.mcx_exit_price,   pnl: d.mcx_pnl },
    comex: { side: d.comex_side, entryPrice: d.comex_price, qty: d.comex_qty || d.qty, brokerage: d.comex_brokerage, exitPrice: d.comex_exit_price, pnl: d.comex_pnl },
    dgcx:  d.dgcx_enabled ? { side: d.dgcx_side, entryPrice: d.dgcx_price, qty: d.dgcx_qty || d.qty, brokerage: d.dgcx_brokerage, exitPrice: d.dgcx_exit_price, pnl: d.dgcx_pnl } : null,
  };
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => {
  console.log(`BadlaBoard running on http://localhost:${PORT}`);
  console.log(`Install dependency if needed: npm install better-sqlite3`);
});