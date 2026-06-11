// routes/brokers.js
const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun, dbInsert } = require('../db');
const requireAuth = require('../middleware/auth');

// ─── Brokers FUNCTIONS ──────────────────────────────────────────────────────────────────
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
    exchangeType: b.exchange_type || 'MCX',
    instruments: instruments.map(i => ({
      id: i.id,
      name: i.name,
      maxLots: i.max_lots,
      lotQty: i.lot_qty,
      brokerage: i.brokerage,
      brokerSymbol: i.broker_symbol || null,
      mt5Symbol: i.mt5_symbol || null,
      mcxSymbol: i.mcx_symbol || null,
      mcxLotQty: i.mcx_lot_qty || 1,
      mcxBrokerage: i.mcx_brokerage || 0,
      comexSymbol: i.comex_symbol || null,
      comexLotQty: i.comex_lot_qty || 1,
      comexBrokerage: i.comex_brokerage || 0,
    })),
  };
}

function saveInstruments(brokerId, instruments = []) {
  dbRun('DELETE FROM broker_instruments WHERE broker_id = ?', [brokerId]);
  for (const instr of instruments) {
    if (!instr.name?.trim()) continue;
    dbRun(
      `INSERT INTO broker_instruments 
        (broker_id, name, max_lots, lot_qty, brokerage, broker_symbol,
         mt5_symbol, mcx_symbol, mcx_lot_qty, mcx_brokerage,
         comex_symbol, comex_lot_qty, comex_brokerage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [brokerId, instr.name.trim(),
       parseFloat(instr.maxLots) || 1,
       parseFloat(instr.lotQty) || 1,
       parseFloat(instr.brokerage) || 0,
       instr.brokerSymbol || null,
       instr.mt5Symbol || null,
       instr.mcxSymbol || null,
       parseFloat(instr.mcxLotQty) || 1,
       parseFloat(instr.mcxBrokerage) || 0,
       instr.comexSymbol || null,
       parseFloat(instr.comexLotQty) || 1,
       parseFloat(instr.comexBrokerage) || 0,
      ]
    );
  }
}

// ─── Brokers ROUTES ──────────────────────────────────────────────────────────────────
router.get('/brokers', requireAuth, (req, res) => {
  res.json(
    dbAll('SELECT * FROM brokers WHERE user_id = ? ORDER BY broker_name', [req.user.id])
      .map(brokerToFrontend)
  );
});

router.get('/brokers/:id', requireAuth, (req, res) => {
  const row = dbGet('SELECT * FROM brokers WHERE id = ? AND user_id = ?',
    [parseInt(req.params.id), req.user.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(brokerToFrontend(row));
});

router.post('/brokers', requireAuth, (req, res) => {
  const { brokerName, accountId, password, profitShare, totalPnl, exchangeType, instruments } = req.body;
  if (!brokerName) return res.status(400).json({ error: 'brokerName is required' });
  const newId = dbInsert(
    `INSERT INTO brokers (user_id, broker_name, account_id, password, profit_share, total_pnl, exchange_type)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, brokerName.trim(), accountId || null, password || null,
     parseFloat(profitShare) || 0, parseFloat(totalPnl) || 0, exchangeType || 'MCX']
  );
  saveInstruments(newId, instruments);
  res.json(brokerToFrontend(dbGet('SELECT * FROM brokers WHERE id = ?', [newId])));
});

router.put('/brokers/:id', requireAuth, (req, res) => {
  const broker = dbGet('SELECT * FROM brokers WHERE id = ? AND user_id = ?',
    [parseInt(req.params.id), req.user.id]);
  if (!broker) return res.status(404).json({ error: 'Not found' });
  const { brokerName, accountId, password, profitShare, totalPnl, exchangeType, instruments } = req.body;
  dbRun(
    `UPDATE brokers SET broker_name=?, account_id=?, password=?, profit_share=?, total_pnl=?, exchange_type=? WHERE id=?`,
    [
      brokerName || broker.broker_name,
      accountId !== undefined ? (accountId || null) : broker.account_id,
      password  !== undefined ? (password  || null) : broker.password,
      parseFloat(profitShare) ?? broker.profit_share,
      parseFloat(totalPnl)    ?? broker.total_pnl,
      exchangeType || broker.exchange_type,  // ← was missing
      broker.id,
    ]
  );
  if (instruments !== undefined) saveInstruments(broker.id, instruments);
  res.json(brokerToFrontend(dbGet('SELECT * FROM brokers WHERE id = ?', [broker.id])));
});

router.delete('/brokers/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM brokers WHERE id = ? AND user_id = ?',
    [parseInt(req.params.id), req.user.id]);
  res.json({ ok: true });
});

// ───────────────────────────────────────────────────────────────────
module.exports = router;
