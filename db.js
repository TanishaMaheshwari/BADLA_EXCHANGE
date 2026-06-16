// db.js
const fs = require('fs');
const crypto = require('crypto');
const initSqlJs = require('sql.js/dist/sql-asm.js').default;

const DB_PATH = './badla.db';
let db;
let _dbDirty = false;

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  _dbDirty = false;
}

setInterval(() => { if (_dbDirty) saveDB(); }, 500);
function _markDirty() { _dbDirty = true; }

function dbRun(sql, params = []) { db.run(sql, params); _markDirty(); }

function dbGet(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length || !result[0].values.length) return null;
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const obj = {}; cols.forEach((c, i) => obj[c] = vals[i]); return obj;
}

function dbAll(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(vals => {
    const obj = {}; cols.forEach((c, i) => obj[c] = vals[i]); return obj;
  });
}

function dbInsert(sql, params = []) {
  db.run(sql, params);
  const row = dbGet('SELECT last_insert_rowid() as id');
  _markDirty();
  return row ? row.id : null;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'badlaboard_salt').digest('hex');
}

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

// ── New table migrations ───────────────────────────────────────────────────

  // instruments table
  db.run(`CREATE TABLE IF NOT EXISTS instruments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT UNIQUE NOT NULL,
    display_name TEXT,
    type         TEXT,
    equation     TEXT,
    reverse      INTEGER DEFAULT 0,
    duty         REAL DEFAULT 15,
    active       INTEGER DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // Seed instruments table from latestPrices if empty
  const instrCount = dbGet('SELECT COUNT(*) as c FROM instruments');
  if (!instrCount || instrCount.c === 0) {
    console.log('Seeding instruments table from latestPrices...');
    // Will be seeded by broadcast watcher on first run via seedInstrumentsFromPrices()
  }

  // ── Brokers: add exchange_type if missing ──────────────────────────────────
  const bCols4 = db.exec("PRAGMA table_info(brokers)");
  const brokerColNames = bCols4.length ? bCols4[0].values.map(r => r[1]) : [];
  if (!brokerColNames.includes('exchange_type')) {
    db.run("ALTER TABLE brokers ADD COLUMN exchange_type TEXT DEFAULT 'MCX'");
    console.log('Migration: added exchange_type to brokers');
  }

  // ── broker_instruments: add instrument_id if missing ──────────────────────
  const biCols4 = db.exec("PRAGMA table_info(broker_instruments)");
  const biColNames4 = biCols4.length ? biCols4[0].values.map(r => r[1]) : [];
  if (!biColNames4.includes('instrument_id'))
    db.run("ALTER TABLE broker_instruments ADD COLUMN instrument_id INTEGER REFERENCES instruments(id) ON DELETE SET NULL");

  // ── dashboard_instruments: add instrument_id if missing ───────────────────
  const diCols = db.exec("PRAGMA table_info(dashboard_instruments)");
  const diColNames = diCols.length ? diCols[0].values.map(r => r[1]) : [];
  if (!diColNames.includes('instrument_id'))
    db.run("ALTER TABLE dashboard_instruments ADD COLUMN instrument_id INTEGER REFERENCES instruments(id) ON DELETE SET NULL");

  // ── deals: add instrument_id if missing ───────────────────────────────────
  const dealCols2 = db.exec("PRAGMA table_info(deals)");
  const dealColNames2 = dealCols2.length ? dealCols2[0].values.map(r => r[1]) : [];
  if (!dealColNames2.includes('instrument_id'))
    db.run("ALTER TABLE deals ADD COLUMN instrument_id INTEGER REFERENCES instruments(id) ON DELETE SET NULL");

  // ── orders table (replaces mt5_orders for frontend orders) ────────────────
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instrument        TEXT NOT NULL,
    instrument_id     INTEGER REFERENCES instruments(id) ON DELETE SET NULL,
    note              TEXT,
    mcx_side          TEXT,
    mcx_qty           REAL,
    mcx_broker_id     INTEGER REFERENCES brokers(id) ON DELETE SET NULL,
    comex_side        TEXT,
    comex_qty         REAL,
    comex_broker_id   INTEGER REFERENCES brokers(id) ON DELETE SET NULL,
    dgcx_enabled      INTEGER DEFAULT 0,
    dgcx_side         TEXT,
    dgcx_qty          REAL,
    dgcx_broker_id    INTEGER REFERENCES brokers(id) ON DELETE SET NULL,
    has_condition     INTEGER DEFAULT 1,
    condition_field   TEXT,
    condition_dir     TEXT,
    condition_value   REAL,
    place_immediately INTEGER DEFAULT 0,
    status            TEXT DEFAULT 'pending',
    deal_id           INTEGER REFERENCES deals(id) ON DELETE SET NULL,
    mt5_result        TEXT,
    mt5_ticket        INTEGER,
    triggered_at      TEXT,
    sent_to_mt5_at    TEXT,
    mt5_confirmed_at  TEXT,
    created_at        TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── notifications table ────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dashboard_instrument_id INTEGER REFERENCES dashboard_instruments(id) ON DELETE CASCADE,
    type                    TEXT NOT NULL DEFAULT 'price_alert',
    instrument_name         TEXT,
    field                   TEXT,
    direction               TEXT,
    target                  REAL,
    message                 TEXT,
    status                  TEXT DEFAULT 'armed',
    push_enabled            INTEGER DEFAULT 1,
    fired_at                TEXT,
    created_at              TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── push_subscriptions table ───────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  console.log('New table migrations done');

  // Ensure a final flush after all migrations
  saveDB();
}

module.exports = { initDB, dbRun, dbGet, dbAll, dbInsert, hashPassword };