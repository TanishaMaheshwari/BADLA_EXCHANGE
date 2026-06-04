const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const initSqlJs = require('sql.js/dist/sql-asm.js').default;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

const DB_PATH = './badla.db';
let db;

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

function dbGet(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length || !result[0].values.length) return null;
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const obj = {};
  cols.forEach((c, i) => obj[c] = vals[i]);
  return obj;
}

function dbAll(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(vals => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = vals[i]);
    return obj;
  });
}

function dbInsert(sql, params = []) {
  db.run(sql, params);
  const row = dbGet('SELECT last_insert_rowid() as id');
  saveDB();
  return row ? row.id : null;
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'badlaboard_salt').digest('hex');
}

// ─── Helper: recalculate raw P&L for a closed deal row ───────────────────────
// Returns { mcxPnl, comexPnl, dgcxPnl, totalPnl } using stored exit prices.
// Profit-share is NOT applied here — it's display-only on the frontend.
function recalcClosedPnl(d) {
  const rate = d.usd_inr_rate || 89;

  const mcxQty   = d.mcx_qty   || d.qty || 1;
  const comexQty = d.comex_qty || d.qty || 1;

  const mcxPnl = d.mcx_exit_price != null
    ? (d.mcx_side === 'SELL'
        ? (d.mcx_price   - d.mcx_exit_price)
        : (d.mcx_exit_price - d.mcx_price))   * mcxQty   - (d.mcx_brokerage   || 0)
    : 0;

  const comexPnl = d.comex_exit_price != null
    ? (d.comex_side === 'SELL'
        ? (d.comex_price - d.comex_exit_price)
        : (d.comex_exit_price - d.comex_price)) * comexQty * rate - (d.comex_brokerage || 0)
    : 0;

  let dgcxPnl = 0;
  if (d.dgcx_enabled && d.dgcx_exit_price != null) {
    const dgcxQty = d.dgcx_qty || d.qty || 1;
    dgcxPnl = (d.dgcx_side === 'SELL'
      ? (d.dgcx_price - d.dgcx_exit_price)
      : (d.dgcx_exit_price - d.dgcx_price)) * dgcxQty * rate - (d.dgcx_brokerage || 0);
  }

  return { mcxPnl, comexPnl, dgcxPnl, totalPnl: mcxPnl + comexPnl + dgcxPnl };
}

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS dashboard_instruments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    instrument_name TEXT NOT NULL,
    position        INTEGER DEFAULT 0,
    added_at        TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, instrument_name),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS deals (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    instrument        TEXT NOT NULL,
    qty               REAL NOT NULL,
    note              TEXT,
    usd_inr_rate      REAL NOT NULL DEFAULT 89,
    dginr_at_entry    REAL,
    mcx_side          TEXT NOT NULL,
    mcx_price         REAL NOT NULL,
    mcx_qty           REAL NOT NULL DEFAULT 1,
    mcx_brokerage     REAL NOT NULL DEFAULT 0,
    mcx_exit_price    REAL,
    mcx_pnl           REAL,
    comex_side        TEXT NOT NULL,
    comex_price       REAL NOT NULL,
    comex_qty         REAL NOT NULL DEFAULT 1,
    comex_brokerage   REAL NOT NULL DEFAULT 0,
    comex_exit_price  REAL,
    comex_pnl         REAL,
    dgcx_enabled      INTEGER NOT NULL DEFAULT 0,
    dgcx_side         TEXT,
    dgcx_price        REAL,
    dgcx_qty          REAL NOT NULL DEFAULT 1,
    dgcx_brokerage    REAL NOT NULL DEFAULT 0,
    dgcx_exit_price   REAL,
    dgcx_pnl          REAL,
    status            TEXT DEFAULT 'open',
    total_pnl         REAL,
    entry_time        TEXT DEFAULT (datetime('now','localtime')),
    exit_time         TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS brokers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    broker_name  TEXT NOT NULL,
    account_id   TEXT,
    password     TEXT,
    profit_share REAL NOT NULL DEFAULT 0,
    total_pnl    REAL NOT NULL DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS broker_instruments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    broker_id     INTEGER NOT NULL,
    name          TEXT NOT NULL,
    max_lots      REAL NOT NULL DEFAULT 1,
    lot_qty       REAL NOT NULL DEFAULT 1,
    brokerage     REAL NOT NULL DEFAULT 0,
    broker_symbol TEXT,
    FOREIGN KEY(broker_id) REFERENCES brokers(id) ON DELETE CASCADE
  )`);

  // ── Migrations ────────────────────────────────────────────────────────────
  const dealColsResult = db.exec("PRAGMA table_info(deals)");
  const dealCols = dealColsResult.length ? dealColsResult[0].values.map(r => r[1]) : [];

  if (!dealCols.includes('broker_id'))      db.run('ALTER TABLE deals ADD COLUMN broker_id INTEGER REFERENCES brokers(id)');
  if (!dealCols.includes('mcx_broker_id'))  db.run('ALTER TABLE deals ADD COLUMN mcx_broker_id INTEGER REFERENCES brokers(id)');
  if (!dealCols.includes('comex_broker_id'))db.run('ALTER TABLE deals ADD COLUMN comex_broker_id INTEGER REFERENCES brokers(id)');
  if (!dealCols.includes('dgcx_broker_id')) db.run('ALTER TABLE deals ADD COLUMN dgcx_broker_id INTEGER REFERENCES brokers(id)');
  // parent_deal_id — links partial-close children back to the original
  if (!dealCols.includes('parent_deal_id')) db.run('ALTER TABLE deals ADD COLUMN parent_deal_id INTEGER REFERENCES deals(id)');

  const brokerColsResult = db.exec("PRAGMA table_info(brokers)");
  const brokerCols = brokerColsResult.length ? brokerColsResult[0].values.map(r => r[1]) : [];
  if (!brokerCols.includes('account_id'))   db.run("ALTER TABLE brokers ADD COLUMN account_id TEXT");

  // After the broker_instruments migration block, add:
  const brokerCols2 = db.exec("PRAGMA table_info(brokers)");
  const bCols = brokerCols2.length ? brokerCols2[0].values.map(r => r[1]) : [];
  if (bCols.includes('instrument')) {
    // SQLite can't DROP columns directly — recreate the table without it
    const hasInstrumentNotNull = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='brokers'");
    const tableSql = hasInstrumentNotNull?.[0]?.values?.[0]?.[0] || '';
    if (tableSql.includes('instrument') && tableSql.toLowerCase().includes('not null')) {
      console.log('Migration: removing NOT NULL instrument column from brokers');
      db.run(`CREATE TABLE brokers_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL,
        broker_name  TEXT NOT NULL,
        account_id   TEXT,
        password     TEXT,
        instrument   TEXT,
        lot_size     REAL DEFAULT 1,
        brokerage    REAL DEFAULT 0,
        profit_share REAL NOT NULL DEFAULT 0,
        total_pnl    REAL NOT NULL DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`);
      db.run(`INSERT INTO brokers_new SELECT id, user_id, broker_name, account_id, password, instrument, lot_size, brokerage, profit_share, total_pnl, created_at FROM brokers`);
      db.run(`DROP TABLE brokers`);
      db.run(`ALTER TABLE brokers_new RENAME TO brokers`);
      saveDB();
      console.log('Migration: brokers table recreated without NOT NULL on instrument');
    }
  }

  // Replace your entire biCheck block with this:
  let biTableOk = false;
  try {
    const biCols = db.exec("PRAGMA table_info(broker_instruments)");
    const colNames = biCols.length ? biCols[0].values.map(r => r[1]) : [];
    biTableOk = colNames.includes('name') && colNames.includes('broker_id');
    console.log('broker_instruments columns found:', colNames);
  } catch(e) {
    biTableOk = false;
  }

  if (!biTableOk) {
    console.log('Migration: dropping and recreating broker_instruments table');
    db.run('DROP TABLE IF EXISTS broker_instruments');
    db.run(`CREATE TABLE broker_instruments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      broker_id   INTEGER NOT NULL,
      name        TEXT NOT NULL,
      max_lots    REAL NOT NULL DEFAULT 1,
      lot_qty     REAL NOT NULL DEFAULT 1,
      brokerage   REAL NOT NULL DEFAULT 0,
      FOREIGN KEY(broker_id) REFERENCES brokers(id) ON DELETE CASCADE
    )`);
    console.log('Migration: created broker_instruments table');

    const oldBrokers = dbAll('SELECT * FROM brokers');
    for (const b of oldBrokers) {
      if (b.instrument) {
        db.run(
          `INSERT INTO broker_instruments (broker_id, name, max_lots, lot_qty, brokerage) VALUES (?, ?, ?, ?, ?)`,
          [b.id, b.instrument, b.lot_size || 1, b.lot_size || 1, b.brokerage || 0]
        );
      }
    }
    saveDB();
    console.log('Migration: seeded broker_instruments from existing brokers');
  }

  const biCols2 = db.exec("PRAGMA table_info(broker_instruments)");
  const biColNames = biCols2.length ? biCols2[0].values.map(r => r[1]) : [];
  if (!biColNames.includes('broker_symbol')) {
    db.run("ALTER TABLE broker_instruments ADD COLUMN broker_symbol TEXT");
    saveDB();
    console.log('Migration: added broker_symbol to broker_instruments');
  }

  const userCount = dbGet('SELECT COUNT(*) as c FROM users');
  if (!userCount || userCount.c === 0) {
    dbInsert('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hashPassword('admin123')]);
    console.log('Default user created: admin / admin123  — change this immediately!');
  }
}

function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = dbGet('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  const user = dbGet('SELECT * FROM users WHERE id = ?', [session.user_id]);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

let latestPrices = {};
let wsClients = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const token = url.searchParams.get('token');
  const session = token ? dbGet('SELECT * FROM sessions WHERE token = ?', [token]) : null;
  if (!session) { ws.close(4001, 'Unauthorized'); return; }
  wsClients.set(token, ws);
  if (Object.keys(latestPrices).length > 0)
    ws.send(JSON.stringify({ type: 'snapshot', data: Object.values(latestPrices) }));
  ws.on('close', () => wsClients.delete(token));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
}

function calculateBadla(data) {
  const DISPLAY_NAME_OVERRIDES = {
    'GOLD-6%(COMEXJUNE-MCXJUNE)@MAYDG': 'GOLD15%-(COMEXJUNE-MCXJUNE)@MAYDG',
    'SILVER6%-(COMEXJULY-MCXJULY)@MAYDG': 'SILVER15%-(COMEXJULY-MCXJULY)@MAYDG'
  };
  const latestTimestamp = Object.keys(data)[0];
  const latestData = data[latestTimestamp];
  if (!latestData || !latestData.raw_data) return null;
  const { equation } = latestData.raw_data;
  const instruments = latestData.raw_data.data;
  if (!instruments || instruments.length < 2) return null;
  const mcxData   = instruments.find(i => i.exchange === 'MCX')    ?? instruments[0];
  const comexData = instruments.find(i => i.exchange === 'COMEX' || i.exchange === 'SPOT') ?? instruments[1];
  const dgcxData  = instruments.find(i => i.exchange === 'DGCX')   ?? instruments[2];
  if (!comexData) return null;
  const reverse = latestData.reverse || "0";
  try {
    const L1 = comexData.last_price, L2 = mcxData ? mcxData.last_price : 0;
    const L3 = dgcxData ? (10000 / dgcxData.last_price) : 1, D1 = 15;
    const evalEq = (eq, l1, l2, l3) => eval(eq.replace(/L1/g,l1).replace(/L2/g,l2).replace(/L3/g,l3).replace(/D1/g,D1));
    const ltp  = evalEq(equation, L1, L2, L3);
    const buy  = evalEq(equation, comexData.buy_price_0||L1, mcxData?(mcxData.buy_price_0||L2):0, dgcxData?(10000/(dgcxData.sell_price_0||dgcxData.last_price)):1);
    const sell = evalEq(equation, comexData.sell_price_0||L1, mcxData?(mcxData.sell_price_0||L2):0, dgcxData?(10000/(dgcxData.buy_price_0||dgcxData.last_price)):1);
    const finalLTP  = reverse==="1"?ltp-L2:L2-ltp;
    const finalBUY  = reverse==="1"?sell-(mcxData?mcxData.buy_price_0:0):(mcxData?mcxData.buy_price_0:0)-sell;
    const finalSELL = reverse==="1"?buy-(mcxData?mcxData.sell_price_0:0):(mcxData?mcxData.sell_price_0:0)-buy;

    const convertedComexLTP = evalEq(equation, L1, 0, L3);
    const convertedComexBID = sell;
    const convertedComexASK = buy;

    const dgcxL3BID = dgcxData ? (10000 / (dgcxData.buy_price_0  || dgcxData.last_price)) : 1;
    const dgcxL3ASK = dgcxData ? (10000 / (dgcxData.sell_price_0 || dgcxData.last_price)) : 1;

    return {
      id: latestData.instrument_id, name: latestData.instrument_name,
      displayName: DISPLAY_NAME_OVERRIDES[latestData.raw_data.displayName] || DISPLAY_NAME_OVERRIDES[latestData.instrument_name] || latestData.raw_data.displayName || latestData.instrument_name,        type: latestData.badla_type, timestamp: latestTimestamp,
      badlaLTP: finalLTP.toFixed(2), badlaBUY: finalBUY.toFixed(2), badlaSELL: finalSELL.toFixed(2),
      mcx:   mcxData   ? { bid: mcxData.buy_price_0, ask: mcxData.sell_price_0, ltp: mcxData.last_price } : null,
      comex: comexData ? {
        bid: comexData.buy_price_0, ask: comexData.sell_price_0, ltp: comexData.last_price,
        convertedLTP: convertedComexLTP.toFixed(2),
        convertedBID: convertedComexBID.toFixed(2),
        convertedASK: convertedComexASK.toFixed(2),
      } : null,
      dgcx: dgcxData ? {
        bid: dgcxData.buy_price_0, ask: dgcxData.sell_price_0, ltp: dgcxData.last_price,
        convertedLTP: (10000 / dgcxData.last_price).toFixed(4),
        convertedBID: dgcxL3BID.toFixed(4),
        convertedASK: dgcxL3ASK.toFixed(4),
      } : null,
    };
  } catch(e) { return null; }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = dbGet('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || user.password !== hashPassword(password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  dbInsert('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, user.id]);
  res.json({ token, username: user.username });
});

app.post('/api/logout', requireAuth, (req, res) => {
  dbRun('DELETE FROM sessions WHERE token = ?', [req.headers['x-session-token']]);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

app.post('/api/admin/users', requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    dbInsert('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashPassword(password)]);
    res.json({ ok: true, username });
  } catch(e) { res.status(400).json({ error: 'Username already exists' }); }
});

app.post('/api/push', (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) return res.status(400).json({ error: 'missing name or data' });
  const result = calculateBadla(data);
  if (result) { latestPrices[name] = result; broadcast({ type: 'update', data: result }); }
  res.json({ ok: true });
});

app.get('/api/prices', requireAuth, (req, res) => { res.json(Object.values(latestPrices)); });

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/dashboard', requireAuth, (req, res) => {
  res.json(dbAll('SELECT instrument_name, position FROM dashboard_instruments WHERE user_id = ? ORDER BY position', [req.user.id]));
});

app.post('/api/dashboard', requireAuth, (req, res) => {
  const { instrument_name } = req.body;
  if (!instrument_name) return res.status(400).json({ error: 'Missing instrument_name' });
  const maxPos = dbGet('SELECT MAX(position) as m FROM dashboard_instruments WHERE user_id = ?', [req.user.id]);
  const pos = (maxPos?.m ?? -1) + 1;
  try {
    dbInsert('INSERT INTO dashboard_instruments (user_id, instrument_name, position) VALUES (?, ?, ?)', [req.user.id, instrument_name, pos]);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: 'Already on dashboard' }); }
});

app.delete('/api/dashboard/:name', requireAuth, (req, res) => {
  dbRun('DELETE FROM dashboard_instruments WHERE user_id = ? AND instrument_name = ?', [req.user.id, decodeURIComponent(req.params.name)]);
  res.json({ ok: true });
});

// ─── Deals ────────────────────────────────────────────────────────────────────
app.get('/api/deals', requireAuth, (req, res) => {
  const rows = dbAll('SELECT * FROM deals WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.json(rows.map(dealToFrontend));
});

app.post('/api/deals', requireAuth, (req, res) => {
  const {
    instrument, note, usdInrRate, dginrAtEntry,
    mcxSide, mcxPrice, mcxQty, mcxBrokerage, mcxBrokerId,
    comexSide, comexPrice, comexQty, comexBrokerage, comexBrokerId,
    dgcxEnabled, dgcxSide, dgcxPrice, dgcxQty, dgcxBrokerage, dgcxBrokerId
  } = req.body;

  const newId = dbInsert(`
    INSERT INTO deals (
      user_id, instrument, qty, note, usd_inr_rate, dginr_at_entry,
      mcx_side, mcx_price, mcx_qty, mcx_brokerage, mcx_broker_id,
      comex_side, comex_price, comex_qty, comex_brokerage, comex_broker_id,
      dgcx_enabled, dgcx_side, dgcx_price, dgcx_qty, dgcx_brokerage, dgcx_broker_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    req.user.id, instrument, parseFloat(mcxQty)||1, note||'',
    parseFloat(usdInrRate)||89, parseFloat(dginrAtEntry)||null,
    mcxSide, parseFloat(mcxPrice), parseFloat(mcxQty)||1, parseFloat(mcxBrokerage)||0,
    mcxBrokerId ? parseInt(mcxBrokerId) : null,
    comexSide, parseFloat(comexPrice), parseFloat(comexQty)||1, parseFloat(comexBrokerage)||0,
    comexBrokerId ? parseInt(comexBrokerId) : null,
    dgcxEnabled?1:0, dgcxEnabled?dgcxSide:null,
    dgcxEnabled?parseFloat(dgcxPrice):null,
    dgcxEnabled?parseFloat(dgcxQty)||1:1, parseFloat(dgcxBrokerage)||0,
    dgcxEnabled&&dgcxBrokerId?parseInt(dgcxBrokerId):null
  ]);

  res.json(dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [newId])));
});

// ─── Edit deal — recalculates stored P&L if deal is closed ───────────────────
app.put('/api/deals/:id', requireAuth, (req, res) => {
  const deal = dbGet('SELECT * FROM deals WHERE id = ? AND user_id = ?', [parseInt(req.params.id), req.user.id]);
  if (!deal) return res.status(404).json({ error: 'Not found' });

  const {
    note, usdInrRate, dginrAtEntry,
    mcxSide, mcxPrice, mcxQty, mcxBrokerage, mcxBrokerId,
    comexSide, comexPrice, comexQty, comexBrokerage, comexBrokerId,
    dgcxEnabled, dgcxSide, dgcxPrice, dgcxQty, dgcxBrokerage, dgcxBrokerId
  } = req.body;

  // Build updated deal object to recalculate P&L
  const updated = {
    ...deal,
    usd_inr_rate:    parseFloat(usdInrRate) || 89,
    mcx_side:        mcxSide,
    mcx_price:       parseFloat(mcxPrice),
    mcx_qty:         parseFloat(mcxQty) || 1,
    mcx_brokerage:   parseFloat(mcxBrokerage) || 0,
    comex_side:      comexSide,
    comex_price:     parseFloat(comexPrice),
    comex_qty:       parseFloat(comexQty) || 1,
    comex_brokerage: parseFloat(comexBrokerage) || 0,
    dgcx_enabled:    dgcxEnabled ? 1 : 0,
    dgcx_side:       dgcxEnabled ? dgcxSide       : null,
    dgcx_price:      dgcxEnabled ? parseFloat(dgcxPrice) : null,
    dgcx_qty:        dgcxEnabled ? parseFloat(dgcxQty)||1 : 1,
    dgcx_brokerage:  parseFloat(dgcxBrokerage) || 0,
  };

  // If deal is closed and has exit prices, recalculate stored raw P&L
  let mcxPnlStore = deal.mcx_pnl, comexPnlStore = deal.comex_pnl,
      dgcxPnlStore = deal.dgcx_pnl, totalPnlStore = deal.total_pnl;

  if (deal.status === 'closed') {
    const recalc = recalcClosedPnl(updated);
    mcxPnlStore   = recalc.mcxPnl;
    comexPnlStore = recalc.comexPnl;
    dgcxPnlStore  = recalc.dgcxPnl;
    totalPnlStore = recalc.totalPnl;
  }

  dbRun(`
    UPDATE deals SET
      note=?, usd_inr_rate=?, dginr_at_entry=?,
      mcx_side=?, mcx_price=?, mcx_qty=?, mcx_brokerage=?, mcx_broker_id=?,
      comex_side=?, comex_price=?, comex_qty=?, comex_brokerage=?, comex_broker_id=?,
      dgcx_enabled=?, dgcx_side=?, dgcx_price=?, dgcx_qty=?, dgcx_brokerage=?, dgcx_broker_id=?,
      mcx_pnl=?, comex_pnl=?, dgcx_pnl=?, total_pnl=?
    WHERE id=?
  `, [
    note||'', parseFloat(usdInrRate)||89, parseFloat(dginrAtEntry)||null,
    mcxSide, parseFloat(mcxPrice), parseFloat(mcxQty)||1, parseFloat(mcxBrokerage)||0,
    mcxBrokerId ? parseInt(mcxBrokerId) : null,
    comexSide, parseFloat(comexPrice), parseFloat(comexQty)||1, parseFloat(comexBrokerage)||0,
    comexBrokerId ? parseInt(comexBrokerId) : null,
    dgcxEnabled?1:0, dgcxEnabled?dgcxSide:null,
    dgcxEnabled?parseFloat(dgcxPrice):null,
    dgcxEnabled?parseFloat(dgcxQty)||1:1, parseFloat(dgcxBrokerage)||0,
    dgcxEnabled&&dgcxBrokerId?parseInt(dgcxBrokerId):null,
    mcxPnlStore, comexPnlStore, dgcxPnlStore, totalPnlStore,
    deal.id
  ]);

  res.json(dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [deal.id])));
});

// ─── Close deal (full or partial) ─────────────────────────────────────────────
// Body: { mcxExitPrice, comexExitPrice, dgcxExitPrice, closeLots (optional) }
// If closeLots < deal's mcx_qty → partial close:
//   • original deal qty reduced to (remaining lots), stays open
//   • new child deal created with closeLots, status = closed
// ─── Close deal (full or partial) ─────────────────────────────────────────────
// Body: { mcxExitPrice, comexExitPrice, dgcxExitPrice, mcxCloseQty, comexCloseQty, dgcxCloseQty }
app.put('/api/deals/:id/close', requireAuth, (req, res) => {
  const deal = dbGet('SELECT * FROM deals WHERE id = ? AND user_id = ?', [parseInt(req.params.id), req.user.id]);
  if (!deal) return res.status(404).json({ error: 'Not found' });

  const {
    mcxExitPrice, comexExitPrice, dgcxExitPrice,
    mcxCloseQty, comexCloseQty, dgcxCloseQty
  } = req.body;

  const rate = deal.usd_inr_rate || 89;

  const mExit = parseFloat(mcxExitPrice);
  const cExit = parseFloat(comexExitPrice);
  const dExit = (deal.dgcx_enabled && dgcxExitPrice != null && dgcxExitPrice !== '')
    ? parseFloat(dgcxExitPrice)
    : null;

  if (isNaN(mExit)) return res.status(400).json({ error: 'Invalid MCX exit price' });
  if (isNaN(cExit)) return res.status(400).json({ error: 'Invalid COMEX exit price' });
  if (deal.dgcx_enabled && dgcxExitPrice != null && dgcxExitPrice !== '' && isNaN(dExit)) {
    return res.status(400).json({ error: 'Invalid DGCX exit price' });
  }

  const mcxTotal   = parseFloat(deal.mcx_qty || deal.qty || 1);
  const comexTotal = parseFloat(deal.comex_qty || 1);
  const dgcxTotal  = deal.dgcx_enabled ? parseFloat(deal.dgcx_qty || 1) : 0;

  const mcxClose = mcxCloseQty != null && parseFloat(mcxCloseQty) > 0
    ? Math.min(parseFloat(mcxCloseQty), mcxTotal)
    : mcxTotal;

  const comexClose = comexCloseQty != null && parseFloat(comexCloseQty) > 0
    ? Math.min(parseFloat(comexCloseQty), comexTotal)
    : comexTotal;

  const dgcxClose = deal.dgcx_enabled
    ? (dgcxCloseQty != null && parseFloat(dgcxCloseQty) > 0
        ? Math.min(parseFloat(dgcxCloseQty), dgcxTotal)
        : dgcxTotal)
    : 0;

  const mcxRatio = mcxTotal > 0 ? mcxClose / mcxTotal : 1;
  const comexRatio = comexTotal > 0 ? comexClose / comexTotal : 1;
  const dgcxRatio = deal.dgcx_enabled && dgcxTotal > 0 ? dgcxClose / dgcxTotal : 0;

  const mcxPnl = (deal.mcx_side === 'SELL'
    ? (deal.mcx_price - mExit)
    : (mExit - deal.mcx_price)) * mcxClose - (deal.mcx_brokerage || 0) * mcxRatio;

  const comexPnl = (deal.comex_side === 'SELL'
    ? (deal.comex_price - cExit)
    : (cExit - deal.comex_price)) * comexClose * rate - (deal.comex_brokerage || 0) * comexRatio;

  let dgcxPnl = 0;
  if (deal.dgcx_enabled && dExit != null) {
    dgcxPnl = (deal.dgcx_side === 'SELL'
      ? (deal.dgcx_price - dExit)
      : (dExit - deal.dgcx_price)) * dgcxClose * rate - (deal.dgcx_brokerage || 0) * dgcxRatio;
  }

  const totalPnl = mcxPnl + comexPnl + dgcxPnl;

  const isPartial =
    mcxClose < mcxTotal - 0.000001 ||
    comexClose < comexTotal - 0.000001 ||
    (deal.dgcx_enabled && dgcxClose < dgcxTotal - 0.000001);

  if (isPartial) {
    const remainingMcx = parseFloat((mcxTotal - mcxClose).toFixed(10));
    const remainingComex = parseFloat((comexTotal - comexClose).toFixed(10));
    const remainingDgcx = deal.dgcx_enabled ? parseFloat((dgcxTotal - dgcxClose).toFixed(10)) : null;

    const remainingMcxBrok = parseFloat(((deal.mcx_brokerage || 0) - (deal.mcx_brokerage || 0) * mcxRatio).toFixed(10));
    const remainingComexBrok = parseFloat(((deal.comex_brokerage || 0) - (deal.comex_brokerage || 0) * comexRatio).toFixed(10));
    const remainingDgcxBrok = deal.dgcx_enabled
      ? parseFloat(((deal.dgcx_brokerage || 0) - (deal.dgcx_brokerage || 0) * dgcxRatio).toFixed(10))
      : null;

    dbRun(`
      UPDATE deals SET
        mcx_qty = ?,
        comex_qty = ?,
        dgcx_qty = ?,
        qty = ?,
        mcx_brokerage = ?,
        comex_brokerage = ?,
        dgcx_brokerage = ?
      WHERE id = ?
    `, [
      remainingMcx,
      remainingComex,
      deal.dgcx_enabled ? remainingDgcx : deal.dgcx_qty,
      remainingMcx,
      remainingMcxBrok,
      remainingComexBrok,
      deal.dgcx_enabled ? remainingDgcxBrok : deal.dgcx_brokerage,
      deal.id
    ]);

    const childId = dbInsert(`
      INSERT INTO deals (
        user_id, instrument, qty, note, usd_inr_rate, dginr_at_entry,
        mcx_side, mcx_price, mcx_qty, mcx_brokerage, mcx_broker_id,
        mcx_exit_price, mcx_pnl,
        comex_side, comex_price, comex_qty, comex_brokerage, comex_broker_id,
        comex_exit_price, comex_pnl,
        dgcx_enabled, dgcx_side, dgcx_price, dgcx_qty, dgcx_brokerage, dgcx_broker_id,
        dgcx_exit_price, dgcx_pnl,
        status, total_pnl, entry_time, exit_time, parent_deal_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),?)
    `, [
      deal.user_id, deal.instrument, mcxClose,
      deal.note ? `${deal.note} [partial close]` : 'partial close',
      rate, deal.dginr_at_entry,
      deal.mcx_side, deal.mcx_price, mcxClose, (deal.mcx_brokerage || 0) * mcxRatio,
      deal.mcx_broker_id, mExit, mcxPnl,
      deal.comex_side, deal.comex_price, comexClose, (deal.comex_brokerage || 0) * comexRatio,
      deal.comex_broker_id, cExit, comexPnl,
      deal.dgcx_enabled,
      deal.dgcx_enabled ? deal.dgcx_side : null,
      deal.dgcx_enabled ? deal.dgcx_price : null,
      deal.dgcx_enabled ? dgcxClose : 1,
      deal.dgcx_enabled ? (deal.dgcx_brokerage || 0) * dgcxRatio : 0,
      deal.dgcx_enabled ? deal.dgcx_broker_id : null,
      dExit, dgcxPnl,
      'closed', totalPnl,
      deal.entry_time,
      deal.id
    ]);

    const parent = dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [deal.id]));
    const child = dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [childId]));
    return res.json({ partial: true, open: parent, closed: child });
  }

  dbRun(`
    UPDATE deals SET
      mcx_exit_price=?, mcx_pnl=?,
      comex_exit_price=?, comex_pnl=?,
      dgcx_exit_price=?, dgcx_pnl=?,
      total_pnl=?, status='closed', exit_time=datetime('now','localtime')
    WHERE id=?
  `, [mExit, mcxPnl, cExit, comexPnl, dExit, dgcxPnl, totalPnl, deal.id]);

  res.json({ partial: false, closed: dealToFrontend(dbGet('SELECT * FROM deals WHERE id = ?', [deal.id])) });
});

app.delete('/api/deals/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM deals WHERE id = ? AND user_id = ?', [parseInt(req.params.id), req.user.id]);
  res.json({ ok: true });
});

function dealToFrontend(d) {
  return {
    id: d.id, instrument: d.instrument, qty: d.qty, note: d.note,
    usdInrRate: d.usd_inr_rate, dginrAtEntry: d.dginr_at_entry,
    status: d.status, entryTime: d.entry_time, exitTime: d.exit_time,
    totalPnl: d.total_pnl, parentDealId: d.parent_deal_id || null,
    mcx: {
      side: d.mcx_side, entryPrice: d.mcx_price,
      qty: d.mcx_qty||d.qty, brokerage: d.mcx_brokerage,
      exitPrice: d.mcx_exit_price, pnl: d.mcx_pnl,
      brokerId: d.mcx_broker_id||null,
    },
    comex: {
      side: d.comex_side, entryPrice: d.comex_price,
      qty: d.comex_qty||d.qty, brokerage: d.comex_brokerage,
      exitPrice: d.comex_exit_price, pnl: d.comex_pnl,
      brokerId: d.comex_broker_id||null,
    },
    dgcx: d.dgcx_enabled ? {
      side: d.dgcx_side, entryPrice: d.dgcx_price,
      qty: d.dgcx_qty||d.qty, brokerage: d.dgcx_brokerage,
      exitPrice: d.dgcx_exit_price, pnl: d.dgcx_pnl,
      brokerId: d.dgcx_broker_id||null,
    } : null,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function brokerToFrontend(b) {
  const instruments = dbAll(
    'SELECT * FROM broker_instruments WHERE broker_id = ? ORDER BY name',
    [b.id]
  );
  return {
    id: b.id,
    brokerName: b.broker_name,
    accountId: b.account_id || null,
    password: b.password || null,
    profitShare: b.profit_share,
    totalPnl: b.total_pnl,
    createdAt: b.created_at,
    instruments: instruments.map(i => ({
    id: i.id,
    name: i.name,
    maxLots: i.max_lots,
    lotQty: i.lot_qty,
    brokerage: i.brokerage,
    brokerSymbol: i.broker_symbol || null,  // ← add this
    })),
  };
}

function saveInstruments(brokerId, instruments = []) {
  dbRun('DELETE FROM broker_instruments WHERE broker_id = ?', [brokerId]);
  for (const instr of instruments) {
    if (!instr.name?.trim()) continue;
    dbRun(
      `INSERT INTO broker_instruments (broker_id, name, max_lots, lot_qty, brokerage, broker_symbol)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [brokerId, instr.name.trim(), parseFloat(instr.maxLots) || 1,
       parseFloat(instr.lotQty) || 1, parseFloat(instr.brokerage) || 0,
       instr.brokerSymbol || null]
    );
  }
}

// ─── routes ──────────────────────────────────────────────────────────────────
app.get('/api/brokers', requireAuth, (req, res) => {
  res.json(
    dbAll('SELECT * FROM brokers WHERE user_id = ? ORDER BY broker_name', [req.user.id])
      .map(brokerToFrontend)
  );
});

app.get('/api/brokers/:id', requireAuth, (req, res) => {
  const row = dbGet('SELECT * FROM brokers WHERE id = ? AND user_id = ?',
    [parseInt(req.params.id), req.user.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(brokerToFrontend(row));
});

app.post('/api/brokers', requireAuth, (req, res) => {
  const { brokerName, accountId, password, profitShare, totalPnl, instruments } = req.body;
  if (!brokerName) return res.status(400).json({ error: 'brokerName is required' });
  const newId = dbInsert(
    `INSERT INTO brokers (user_id, broker_name, account_id, password, profit_share, total_pnl)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.id, brokerName.trim(), accountId || null, password || null,
     parseFloat(profitShare) || 0, parseFloat(totalPnl) || 0]
  );
  saveInstruments(newId, instruments);
  res.json(brokerToFrontend(dbGet('SELECT * FROM brokers WHERE id = ?', [newId])));
});

app.put('/api/brokers/:id', requireAuth, (req, res) => {
  const broker = dbGet('SELECT * FROM brokers WHERE id = ? AND user_id = ?',
    [parseInt(req.params.id), req.user.id]);
  if (!broker) return res.status(404).json({ error: 'Not found' });
  const { brokerName, accountId, password, profitShare, totalPnl, instruments } = req.body;
  dbRun(
    `UPDATE brokers SET broker_name=?, account_id=?, password=?, profit_share=?, total_pnl=?
     WHERE id=?`,
    [
      brokerName || broker.broker_name,
      accountId !== undefined ? (accountId || null) : broker.account_id,
      password !== undefined ? (password || null) : broker.password,
      parseFloat(profitShare) ?? broker.profit_share,
      parseFloat(totalPnl) ?? broker.total_pnl,
      broker.id,
    ]
  );
  if (instruments !== undefined) saveInstruments(broker.id, instruments);
  res.json(brokerToFrontend(dbGet('SELECT * FROM brokers WHERE id = ?', [broker.id])));
});

app.delete('/api/brokers/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM brokers WHERE id = ? AND user_id = ?',
    [parseInt(req.params.id), req.user.id]);
  res.json({ ok: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => {
  server.listen(PORT, () => console.log(`BadlaBoard running on port ${PORT}`));
}).catch(err => { console.error('Failed to initialize database:', err); process.exit(1); });