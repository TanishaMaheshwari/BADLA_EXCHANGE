
const express = require('express');
const path = require('path');
const fs   = require('fs');
const router = express.Router();
const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const requireAuth = require('../middleware/auth');

// ── MT5 Orders ───────────────────────────────────────────────────────────────
const MT5_QUEUE_FILE  = path.join(__dirname, '../mt5_queue.json');
const MT5_STATUS_FILE = path.join(__dirname, '../mt5_status.json');

function writeMT5Queue() {
  const pending = dbAll(`
    SELECT o.*, b.account_id, b.exchange_type
    FROM mt5_orders o
    JOIN brokers b ON o.broker_id = b.id
    WHERE o.status = 'pending'
    ORDER BY o.created_at
  `);
  fs.writeFileSync(MT5_QUEUE_FILE, JSON.stringify({ orders: pending }, null, 2));
}

function pollMT5Status() {
  if (!fs.existsSync(MT5_STATUS_FILE)) return;
  let results;
  try { results = JSON.parse(fs.readFileSync(MT5_STATUS_FILE, 'utf8')); } catch(e) { return; }
  if (!results?.results?.length) return;
  for (const r of results.results) {
    dbRun(`UPDATE mt5_orders SET status=?, mt5_ticket=?, mt5_price=?, error_message=?, executed_at=datetime('now','localtime')
           WHERE id=?`,
      [r.success ? 'done' : 'failed', r.ticket || null, r.price || null, r.error || null, r.order_id]);
  }
  fs.writeFileSync(MT5_STATUS_FILE, JSON.stringify({ results: [] }, null, 2));
  writeMT5Queue();
}
setInterval(pollMT5Status, 1000);

// Place MT5 orders for a deal (both legs simultaneously)
router.post('/mt5/place', requireAuth, (req, res) => {
  const { instrumentName, action, lots, dealId } = req.body;
  if (!instrumentName || !action || !lots)
    return res.status(400).json({ error: 'instrumentName, action, lots required' });

  // Find all brokers for this user that have this instrument mapped
  const mappings = dbAll(`
    SELECT b.id as broker_id, b.account_id, b.exchange_type,
           bi.mt5_symbol, bi.mcx_symbol, bi.comex_symbol,
           bi.max_lots, bi.mcx_lot_qty, bi.comex_lot_qty
    FROM broker_instruments bi
    JOIN brokers b ON bi.broker_id = b.id
    WHERE b.user_id = ? AND bi.name = ?
  `, [req.user.id, instrumentName]);

  if (!mappings.length)
    return res.status(400).json({ error: 'No broker mapping found for this instrument' });

  const orderIds = [];
  for (const m of mappings) {
    const symbol = m.exchange_type === 'MCX' ? m.mcx_symbol :
                   m.exchange_type === 'COMEX' ? m.comex_symbol : m.mt5_symbol;
    if (!symbol) continue;
    const id = dbInsert(`
      INSERT INTO mt5_orders (deal_id, instrument_name, broker_id, account_id, exchange_type, mt5_symbol, action, lots, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [dealId || null, instrumentName, m.broker_id, m.account_id, m.exchange_type, symbol, action.toUpperCase(), parseFloat(lots)]);
    orderIds.push(id);
  }

  writeMT5Queue();
  res.json({ ok: true, orderIds });
});

router.get('/mt5/orders', requireAuth, (req, res) => {
  const orders = dbAll(`
    SELECT o.*, b.broker_name FROM mt5_orders o
    JOIN brokers b ON o.broker_id = b.id
    WHERE b.user_id = ? ORDER BY o.created_at DESC LIMIT 100
  `, [req.user.id]);
  res.json(orders);
});

router.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

//───────────────────────────────────────────────────────────────────
module.exports = { router, pollMT5Status };