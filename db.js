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

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at TEXT,
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

  if (!dealCols.includes('broker_id'))       db.run('ALTER TABLE deals ADD COLUMN broker_id INTEGER REFERENCES brokers(id)');
  if (!dealCols.includes('mcx_broker_id'))   db.run('ALTER TABLE deals ADD COLUMN mcx_broker_id INTEGER REFERENCES brokers(id)');
  if (!dealCols.includes('comex_broker_id')) db.run('ALTER TABLE deals ADD COLUMN comex_broker_id INTEGER REFERENCES brokers(id)');
  if (!dealCols.includes('dgcx_broker_id'))  db.run('ALTER TABLE deals ADD COLUMN dgcx_broker_id INTEGER REFERENCES brokers(id)');
  if (!dealCols.includes('parent_deal_id'))  db.run('ALTER TABLE deals ADD COLUMN parent_deal_id INTEGER REFERENCES deals(id)');

  // FIX 10: Add expires_at to existing sessions table if it's missing.
  // SQLite ALTER TABLE does not allow non-constant DEFAULT expressions,
  // so we add the column as nullable, backfill existing rows, then purge stale ones.
  const sessColsResult = db.exec("PRAGMA table_info(sessions)");
  const sessCols = sessColsResult.length ? sessColsResult[0].values.map(r => r[1]) : [];
  if (!sessCols.includes('expires_at')) {
    db.run("ALTER TABLE sessions ADD COLUMN expires_at TEXT");
    db.run("UPDATE sessions SET expires_at = datetime('now','localtime','+30 days') WHERE expires_at IS NULL");
  }
  // Purge any already-expired sessions on startup
  db.run("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= datetime('now','localtime')");

  const brokerColsResult = db.exec("PRAGMA table_info(brokers)");
  const brokerCols = brokerColsResult.length ? brokerColsResult[0].values.map(r => r[1]) : [];
  if (!brokerCols.includes('account_id')) db.run("ALTER TABLE brokers ADD COLUMN account_id TEXT");

  const brokerCols2 = db.exec("PRAGMA table_info(brokers)");
  const bCols = brokerCols2.length ? brokerCols2[0].values.map(r => r[1]) : [];
  if (bCols.includes('instrument')) {
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
      _markDirty();
      console.log('Migration: brokers table recreated without NOT NULL on instrument');
    }
  }

  let biTableOk = false;
  try {
    const biCols = db.exec("PRAGMA table_info(broker_instruments)");
    const colNames = biCols.length ? biCols[0].values.map(r => r[1]) : [];
    // FIX 11: Also verify broker_symbol exists so the column is never missing
    biTableOk = colNames.includes('name') &&
                colNames.includes('broker_id') &&
                colNames.includes('broker_symbol');
    console.log('broker_instruments columns found:', colNames);
  } catch(e) {
    biTableOk = false;
  }

  if (!biTableOk) {
    console.log('Migration: dropping and recreating broker_instruments table');
    db.run('DROP TABLE IF EXISTS broker_instruments');
    // FIX 11: Include broker_symbol in the initial CREATE so it's never absent
    db.run(`CREATE TABLE broker_instruments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      broker_id     INTEGER NOT NULL,
      name          TEXT NOT NULL,
      max_lots      REAL NOT NULL DEFAULT 1,
      lot_qty       REAL NOT NULL DEFAULT 1,
      brokerage     REAL NOT NULL DEFAULT 0,
      broker_symbol TEXT,
      FOREIGN KEY(broker_id) REFERENCES brokers(id) ON DELETE CASCADE
    )`);
    console.log('Migration: created broker_instruments table');

    const oldBrokers = dbAll('SELECT * FROM brokers');
    for (const b of oldBrokers) {
      if (b.instrument) {
        db.run(
          `INSERT INTO broker_instruments (broker_id, name, max_lots, lot_qty, brokerage, broker_symbol) VALUES (?, ?, ?, ?, ?, ?)`,
          [b.id, b.instrument, b.lot_size || 1, b.lot_size || 1, b.brokerage || 0, null]
        );
      }
    }
    _markDirty();
    console.log('Migration: seeded broker_instruments from existing brokers');
  }

  // broker_symbol column guard is now redundant (handled above), but kept
  // as a safety net for any DB that had broker_instruments without it.
  const biCols2 = db.exec("PRAGMA table_info(broker_instruments)");
  const biColNames = biCols2.length ? biCols2[0].values.map(r => r[1]) : [];
  if (!biColNames.includes('broker_symbol')) {
    db.run("ALTER TABLE broker_instruments ADD COLUMN broker_symbol TEXT");
    _markDirty();
    console.log('Migration: added broker_symbol to broker_instruments');
  }

  const userCount = dbGet('SELECT COUNT(*) as c FROM users');
  if (!userCount || userCount.c === 0) {
    dbInsert('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hashPassword('admin123')]);
    console.log('Default user created: admin / admin123  — change this immediately!');
  }

  // ── MT5 migrations ────────────────────────────────────────────────────────
  const brokerCols3 = db.exec("PRAGMA table_info(brokers)");
  const bCols3 = brokerCols3.length ? brokerCols3[0].values.map(r => r[1]) : [];
  if (!bCols3.includes('exchange_type')) {
    db.run("ALTER TABLE brokers ADD COLUMN exchange_type TEXT DEFAULT 'MCX'");
    console.log('Migration: added exchange_type to brokers');
  }

  const biCols3 = db.exec("PRAGMA table_info(broker_instruments)");
  const biColNames3 = biCols3.length ? biCols3[0].values.map(r => r[1]) : [];
  if (!biColNames3.includes('mt5_symbol'))       db.run("ALTER TABLE broker_instruments ADD COLUMN mt5_symbol TEXT");
  if (!biColNames3.includes('mcx_symbol'))        db.run("ALTER TABLE broker_instruments ADD COLUMN mcx_symbol TEXT");
  if (!biColNames3.includes('mcx_lot_qty'))       db.run("ALTER TABLE broker_instruments ADD COLUMN mcx_lot_qty REAL DEFAULT 1");
  if (!biColNames3.includes('mcx_brokerage'))     db.run("ALTER TABLE broker_instruments ADD COLUMN mcx_brokerage REAL DEFAULT 0");
  if (!biColNames3.includes('comex_symbol'))      db.run("ALTER TABLE broker_instruments ADD COLUMN comex_symbol TEXT");
  if (!biColNames3.includes('comex_lot_qty'))     db.run("ALTER TABLE broker_instruments ADD COLUMN comex_lot_qty REAL DEFAULT 1");
  if (!biColNames3.includes('comex_brokerage'))   db.run("ALTER TABLE broker_instruments ADD COLUMN comex_brokerage REAL DEFAULT 0");

  db.run(`CREATE TABLE IF NOT EXISTS mt5_orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id         INTEGER REFERENCES deals(id),
    instrument_name TEXT NOT NULL,
    broker_id       INTEGER NOT NULL REFERENCES brokers(id),
    account_id      TEXT NOT NULL,
    exchange_type   TEXT NOT NULL,
    mt5_symbol      TEXT NOT NULL,
    action          TEXT NOT NULL,
    lots            REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    mt5_ticket      INTEGER,
    mt5_price       REAL,
    error_message   TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    executed_at     TEXT
  )`);
  console.log('MT5 migrations done');

  // Ensure a final flush after all migrations
  saveDB();
}

module.exports = { initDB, dbRun, dbGet, dbAll, dbInsert, hashPassword };