const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const requireAuth = require('../middleware/auth');
const { broadcast } = require('../services/websocket');
const { activeEAs, getEAStatus, checkDealStatus } = require('../services/ea-registry');

router.post('/ea/heartbeat', (req, res) => {
  const { accountId, brokerName, exchange, symbol, symbolValid, marketOpen, lotUsed, lotMax, lotHeadroom, error, status } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });

  const ea = {
    accountId: String(accountId),
    brokerName: brokerName || '',
    exchange: exchange || '',
    symbol: symbol || '',
    symbolValid: symbolValid !== undefined ? !!symbolValid : true,
    marketOpen: marketOpen !== undefined ? !!marketOpen : true,
    lotUsed: parseFloat(lotUsed) || 0,
    lotMax: parseFloat(lotMax) || 0,
    lotHeadroom: parseFloat(lotHeadroom) || 0,
    error: error || '',
    lastSeen: Date.now(),
    status: status || 'ready'
  };

  activeEAs[ea.accountId] = ea;

  broadcast({
    type: 'ea_status_update',
    ea: { ...ea, status: getEAStatus(ea) }
  });

  const pending = dbAll(`
    SELECT * FROM mt5_orders
    WHERE account_id = ? AND status = 'pending'
    ORDER BY created_at
  `, [ea.accountId]);

  if (req.query.format === 'csv' || req.headers['accept'] === 'text/plain') {
    res.setHeader('Content-Type', 'text/plain');
    let csvRes = 'ea_status:ok\n';
    pending.forEach(o => {
      csvRes += `order:${o.id},${o.mt5_symbol},${o.action},${o.lots.toFixed(2)}\n`;
    });
    return res.send(csvRes);
  }

  res.json({
    status: 'ok',
    orders: pending.map(o => ({
      order_id: o.id,
      symbol: o.mt5_symbol,
      action: o.action,
      lots: o.lots
    }))
  });
});

router.post('/ea/report', (req, res) => {
  const { accountId, orderId, success, ticket, price, error } = req.body;
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  const order = dbGet('SELECT * FROM mt5_orders WHERE id = ?', [parseInt(orderId)]);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const newStatus = success ? 'done' : 'failed';
  const mt5Ticket = ticket ? parseInt(ticket) : null;
  const mt5Price = price ? parseFloat(price) : null;
  const errMsg = error || null;

  dbRun(`
    UPDATE mt5_orders
    SET status = ?, mt5_ticket = ?, mt5_price = ?, error_message = ?, executed_at = datetime('now','localtime')
    WHERE id = ?
  `, [newStatus, mt5Ticket, mt5Price, errMsg, order.id]);

  broadcast({
    type: 'order_confirmed',
    orderId: order.id,
    success: !!success,
    ticket: mt5Ticket,
    error: errMsg
  });

  if (order.deal_id) {
    checkDealStatus(order.deal_id);
  }

  res.json({ ok: true });
});

// ── Shared leg validation, using the new single-symbol broker_instruments schema ──
function validateLeg(deal, exchange, brokerId, qty) {
  if (!brokerId) return { ok: true, skip: true };

  const broker = dbGet('SELECT * FROM brokers WHERE id = ?', [brokerId]);
  if (!broker || !broker.account_id)
    return { ok: false, exchange, qty, reason: 'No broker account configured' };

  const activeEa = activeEAs[broker.account_id];
  if (!activeEa || getEAStatus(activeEa) === 'offline')
    return { ok: false, exchange, qty, reason: 'EA offline' };

  const mapping = dbGet(`
    SELECT * FROM broker_instruments
    WHERE broker_id = ? AND name = ?
  `, [broker.id, deal.instrument]);

  if (!mapping)
    return { ok: false, exchange, qty, reason: 'No instrument mapping' };

  const symbol = mapping.broker_symbol;
  if (!symbol)
    return { ok: false, exchange, qty, reason: 'Broker symbol not set for this instrument' };

  if (activeEa.symbol !== symbol)
    return { ok: false, exchange, qty, reason: `EA symbol mismatch (expected ${symbol}, got ${activeEa.symbol})` };

  const lotQty = mapping.lot_qty || 1;
  const requiredLots = qty / lotQty;

  if (activeEa.lotHeadroom < requiredLots)
    return { ok: false, exchange, qty: requiredLots, reason: `Insufficient headroom (${activeEa.lotHeadroom} < ${requiredLots.toFixed(2)} lots)` };

  if (!activeEa.marketOpen)
    return { ok: false, exchange, qty: requiredLots, reason: 'Market is closed' };

  if (mapping.max_lots && requiredLots > mapping.max_lots)
    return { ok: false, exchange, qty: requiredLots, reason: `Exceeds max lots (${mapping.max_lots})` };

  return { ok: true, exchange, qty: requiredLots, reason: '', broker, mapping, symbol, lots: requiredLots };
}

router.post('/ea/check', requireAuth, (req, res) => {
  const { dealId } = req.body;

  const easList = Object.values(activeEAs).map(ea => ({
    ...ea,
    status: getEAStatus(ea)
  }));

  let dealValidation = null;
  let allReady = easList.length > 0 && easList.every(e => e.status === 'ready');

  if (dealId) {
    const deal = dbGet('SELECT * FROM deals WHERE id = ?', [parseInt(dealId)]);
    if (deal) {
      dealValidation = [];

      const mcx = validateLeg(deal, 'MCX', deal.mcx_broker_id, deal.mcx_qty);
      if (!mcx.skip) dealValidation.push(mcx);

      const comex = validateLeg(deal, 'COMEX', deal.comex_broker_id, deal.comex_qty);
      if (!comex.skip) dealValidation.push(comex);

      if (deal.dgcx_enabled) {
        const dgcx = validateLeg(deal, 'DGCX', deal.dgcx_broker_id, deal.dgcx_qty);
        if (!dgcx.skip) dealValidation.push(dgcx);
      }

      allReady = dealValidation.every(l => l.ok);
    }
  }

  res.json({ eas: easList, allReady, dealValidation });
});

router.post('/ea/commit', requireAuth, (req, res) => {
  const { dealId } = req.body;
  if (!dealId) return res.status(400).json({ error: 'dealId is required' });

  const deal = dbGet('SELECT * FROM deals WHERE id = ?', [parseInt(dealId)]);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  const mcxRes = validateLeg(deal, 'MCX', deal.mcx_broker_id, deal.mcx_qty);
  const comexRes = validateLeg(deal, 'COMEX', deal.comex_broker_id, deal.comex_qty);
  const dgcxRes = deal.dgcx_enabled
    ? validateLeg(deal, 'DGCX', deal.dgcx_broker_id, deal.dgcx_qty)
    : { ok: true, skip: true };

  const failed = [mcxRes, comexRes, dgcxRes].filter(r => !r.ok && !r.skip);
  if (failed.length > 0) {
    return res.status(400).json({
      error: 'One or more legs are not ready for execution',
      notReady: failed.map(f => f.exchange),
      reasons: failed.map(f => `${f.exchange}: ${f.reason}`)
    });
  }

  dbRun("DELETE FROM mt5_orders WHERE deal_id = ?", [deal.id]);

  const insertOrder = (legRes, side) => {
    if (legRes.skip || !legRes.broker) return;
    dbInsert(`
      INSERT INTO mt5_orders (
        deal_id, instrument_name, broker_id, account_id, exchange_type, mt5_symbol, action, lots, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [
      deal.id, deal.instrument, legRes.broker.id, legRes.broker.account_id,
      legRes.broker.exchange_type || 'MCX', legRes.symbol, side, legRes.lots
    ]);
  };

  insertOrder(mcxRes, deal.mcx_side);
  insertOrder(comexRes, deal.comex_side);
  if (deal.dgcx_enabled) insertOrder(dgcxRes, deal.dgcx_side);

  dbRun("UPDATE deals SET status = 'triggered' WHERE id = ?", [deal.id]);

  broadcast({
    type: 'order_triggered',
    orderId: deal.id,
    instrument: deal.instrument
  });

  res.json({ ok: true });
});

module.exports = router;