// db.js
const Database = require('better-sqlite3');
const crypto = require('crypto');

const DB_PATH = './badla.db';
let db;

function dbRun(sql, params = []) {
  db.prepare(sql).run(...params);
}

function dbGet(sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return row || null;
}

function dbAll(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function dbInsert(sql, params = []) {
  const result = db.prepare(sql).run(...params);
  return result.lastInsertRowid;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'badlaboard_salt').digest('hex');
}

async function initDB() {
  db = new Database(DB_PATH);

  // WAL mode: better crash safety (a kill -9 mid-write won't corrupt the file
  // the way it could before) and better concurrent read/write performance.
  db.pragma('journal_mode = WAL');

  // ── New table migrations ───────────────────────────────────────────────────

  // instruments table
  db.exec(`CREATE TABLE IF NOT EXISTS instruments (
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
  const brokerColNames = db.pragma('table_info(brokers)').map(r => r.name);
  if (!brokerColNames.includes('exchange_type')) {
    db.exec("ALTER TABLE brokers ADD COLUMN exchange_type TEXT DEFAULT 'MCX'");
    console.log('Migration: added exchange_type to brokers');
  }

  // ── broker_instruments: add instrument_id if missing ──────────────────────
  const biColNames4 = db.pragma('table_info(broker_instruments)').map(r => r.name);
  if (!biColNames4.includes('instrument_id'))
    db.exec("ALTER TABLE broker_instruments ADD COLUMN instrument_id INTEGER REFERENCES instruments(id) ON DELETE SET NULL");

  // ── dashboard_instruments: add instrument_id if missing ───────────────────
  const diColNames = db.pragma('table_info(dashboard_instruments)').map(r => r.name);
  if (!diColNames.includes('instrument_id'))
    db.exec("ALTER TABLE dashboard_instruments ADD COLUMN instrument_id INTEGER REFERENCES instruments(id) ON DELETE SET NULL");

  // ── deals: add instrument_id if missing ───────────────────────────────────
  const dealColNames2 = db.pragma('table_info(deals)').map(r => r.name);
  if (!dealColNames2.includes('instrument_id'))
    db.exec("ALTER TABLE deals ADD COLUMN instrument_id INTEGER REFERENCES instruments(id) ON DELETE SET NULL");

  // ── orders table (replaces mt5_orders for frontend orders) ────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS orders (
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
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
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
  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  const notifCols = db.pragma('table_info(notifications)');
  const notifColNames = notifCols.map(r => r.name);
  if (!notifColNames.includes('deal_id'))
    db.exec("ALTER TABLE notifications ADD COLUMN deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE");

  const fieldInfo = notifCols.find(r => r.name === 'field');
  if (fieldInfo && (fieldInfo.type.toUpperCase() !== 'TEXT' || fieldInfo.notnull === 1)) {
    console.log('Migration: relaxing notifications.field nullability');
    db.exec(`CREATE TABLE notifications_backup AS SELECT * FROM notifications`);
    db.exec(`DROP TABLE notifications`);
    db.exec(`CREATE TABLE notifications (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dashboard_instrument_id INTEGER REFERENCES dashboard_instruments(id) ON DELETE CASCADE,
      deal_id                 INTEGER REFERENCES deals(id) ON DELETE CASCADE,
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
    db.exec(`INSERT INTO notifications (id, user_id, dashboard_instrument_id, deal_id, type, instrument_name, field, direction, target, message, status, push_enabled, fired_at, created_at)
            SELECT id, user_id, dashboard_instrument_id, deal_id, type, instrument_name, field, direction, target, message, status, push_enabled, fired_at, created_at
            FROM notifications_backup`);
    db.exec(`DROP TABLE notifications_backup`);
  }

  console.log('New table migrations done');
}

module.exports = { initDB, dbRun, dbGet, dbAll, dbInsert, hashPassword };