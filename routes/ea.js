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
    ea: {
      ...ea,
      status: getEAStatus(ea)
    }
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

router.post('/ea/check', requireAuth, (req, res) => {
  const { dealId } = req.body;
  
  const easList = Object.values(activeEAs).map(ea => {
    return {
      ...ea,
      status: getEAStatus(ea)
    };
  });
  
  let dealValidation = null;
  let allReady = easList.length > 0 && easList.every(e => e.status === 'ready');
  
  if (dealId) {
    const deal = dbGet('SELECT * FROM deals WHERE id = ?', [parseInt(dealId)]);
    if (deal) {
      dealValidation = [];
      
      const checkLeg = (exchange, brokerId, qty) => {
        if (!brokerId) return;
        const broker = dbGet('SELECT * FROM brokers WHERE id = ?', [brokerId]);
        if (!broker || !broker.account_id) {
          dealValidation.push({ exchange, qty, ready: false, reason: 'No broker account configured' });
          return;
        }
        
        const activeEa = activeEAs[broker.account_id];
        if (!activeEa || getEAStatus(activeEa) === 'offline') {
          dealValidation.push({ exchange, qty, ready: false, reason: 'EA offline' });
          return;
        }
        
        const mapping = dbGet(`
          SELECT * FROM broker_instruments 
          WHERE broker_id = ? AND name = ?
        `, [broker.id, deal.instrument]);
        
        if (!mapping) {
          dealValidation.push({ exchange, qty, ready: false, reason: 'No instrument mapping' });
          return;
        }
        
        const symbol = exchange === 'MCX' ? mapping.mcx_symbol :
                       exchange === 'COMEX' ? mapping.comex_symbol : mapping.mt5_symbol;
                       
        if (!symbol) {
          dealValidation.push({ exchange, qty, ready: false, reason: 'Symbol mapping missing' });
          return;
        }
        
        if (activeEa.symbol !== symbol) {
          dealValidation.push({ exchange, qty, ready: false, reason: `EA symbol mismatch (expected ${symbol})` });
          return;
        }
        
        const lotQty = exchange === 'MCX' ? mapping.mcx_lot_qty :
                      exchange === 'COMEX' ? mapping.comex_lot_qty : mapping.lot_qty;
                      
        const requiredLots = qty / (lotQty || 1);
        
        if (activeEa.lotHeadroom < requiredLots) {
          dealValidation.push({ exchange, qty: requiredLots, ready: false, reason: `Insufficient headroom (${activeEa.lotHeadroom} < ${requiredLots.toFixed(2)} lots)` });
          return;
        }
        
        if (!activeEa.marketOpen) {
          dealValidation.push({ exchange, qty: requiredLots, ready: false, reason: 'Market is closed' });
          return;
        }
        
        dealValidation.push({ exchange, qty: requiredLots, ready: true, reason: '' });
      };
      
      checkLeg('MCX', deal.mcx_broker_id, deal.mcx_qty);
      checkLeg('COMEX', deal.comex_broker_id, deal.comex_qty);
      if (deal.dgcx_enabled) {
        checkLeg('DGCX', deal.dgcx_broker_id, deal.dgcx_qty);
      }
      
      allReady = dealValidation.every(l => l.ready);
    }
  }
  
  res.json({
    eas: easList,
    allReady,
    dealValidation
  });
});

router.post('/ea/commit', requireAuth, (req, res) => {
  const { dealId } = req.body;
  if (!dealId) return res.status(400).json({ error: 'dealId is required' });
  
  const deal = dbGet('SELECT * FROM deals WHERE id = ?', [parseInt(dealId)]);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  
  const validateLeg = (exchange, brokerId, qty) => {
    if (!brokerId) return { ok: true };
    const broker = dbGet('SELECT * FROM brokers WHERE id = ?', [brokerId]);
    if (!broker || !broker.account_id) return { ok: false, reason: `${exchange}: No broker account configured` };
    
    const activeEa = activeEAs[broker.account_id];
    if (!activeEa || getEAStatus(activeEa) === 'offline') return { ok: false, reason: `${exchange}: EA offline` };
    
    const mapping = dbGet(`
      SELECT * FROM broker_instruments 
      WHERE broker_id = ? AND name = ?
    `, [broker.id, deal.instrument]);
    if (!mapping) return { ok: false, reason: `${exchange}: No instrument mapping` };
    
    const symbol = exchange === 'MCX' ? mapping.mcx_symbol :
                   exchange === 'COMEX' ? mapping.comex_symbol : mapping.mt5_symbol;
    if (!symbol) return { ok: false, reason: `${exchange}: Symbol mapping missing` };
    
    if (activeEa.symbol !== symbol) return { ok: false, reason: `${exchange}: EA symbol mismatch` };
    
    const lotQty = exchange === 'MCX' ? mapping.mcx_lot_qty :
                  exchange === 'COMEX' ? mapping.comex_lot_qty : mapping.lot_qty;
    const requiredLots = qty / (lotQty || 1);
    if (activeEa.lotHeadroom < requiredLots) return { ok: false, reason: `${exchange}: Insufficient headroom` };
    
    return { ok: true, broker, mapping, symbol, lots: requiredLots };
  };
  
  const mcxRes = validateLeg('MCX', deal.mcx_broker_id, deal.mcx_qty);
  const comexRes = validateLeg('COMEX', deal.comex_broker_id, deal.comex_qty);
  const dgcxRes = deal.dgcx_enabled ? validateLeg('DGCX', deal.dgcx_broker_id, deal.dgcx_qty) : { ok: true };
  
  if (!mcxRes.ok || !comexRes.ok || !dgcxRes.ok) {
    const notReady = [];
    if (!mcxRes.ok) notReady.push('MCX');
    if (!comexRes.ok) notReady.push('COMEX');
    if (deal.dgcx_enabled && !dgcxRes.ok) notReady.push('DGCX');
    return res.status(400).json({
      error: 'One or more legs are not ready for execution',
      notReady
    });
  }
  
  dbRun("DELETE FROM mt5_orders WHERE deal_id = ?", [deal.id]);
  
  const insertOrder = (legRes, side) => {
    if (!legRes.broker) return;
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
  if (deal.dgcx_enabled) {
    insertOrder(dgcxRes, deal.dgcx_side);
  }
  
  dbRun("UPDATE deals SET status = 'triggered' WHERE id = ?", [deal.id]);
  
  broadcast({
    type: 'order_triggered',
    orderId: deal.id,
    instrument: deal.instrument
  });
  
  res.json({ ok: true });
});


module.exports = router;