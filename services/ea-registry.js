const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const { broadcast } = require('./websocket');

let activeEAs = {};

// ── EA Registry & Connector Endpoints ────────────────────────────────────────
function getEAStatus(ea) {
  if (!ea.lastSeen || Date.now() - ea.lastSeen > 10000) return 'offline';
  if (ea.error || !ea.symbolValid || !ea.marketOpen) return 'degraded';
  return ea.status || 'ready';
}

function checkDealStatus(dealId) {
  const orders = dbAll('SELECT * FROM mt5_orders WHERE deal_id = ?', [dealId]);
  if (!orders.length) return;
  
  const totalLegs = orders.length;
  const doneLegs = orders.filter(o => o.status === 'done').length;
  const failedLegs = orders.filter(o => o.status === 'failed').length;
  
  if (doneLegs === totalLegs) {
    // All legs succeeded!
    // Update deal entry prices from actual fill prices
    const deal = dbGet('SELECT * FROM deals WHERE id = ?', [dealId]);
    if (deal) {
      const mcxOrder = orders.find(o => o.exchange_type === 'MCX');
      const comexOrder = orders.find(o => o.exchange_type === 'COMEX');
      const dgcxOrder = orders.find(o => o.exchange_type === 'DGCX');
      
      const mcxPrice = mcxOrder ? mcxOrder.mt5_price : deal.mcx_price;
      const comexPrice = comexOrder ? comexOrder.mt5_price : deal.comex_price;
      const dgcxPrice = dgcxOrder ? dgcxOrder.mt5_price : deal.dgcx_price;
      
      dbRun(`
        UPDATE deals 
        SET mcx_price = ?, comex_price = ?, dgcx_price = ?, status = 'open'
        WHERE id = ?
      `, [mcxPrice, comexPrice, dgcxPrice, dealId]);
    }
    
    // Broadcast success
    broadcast({
      type: 'commit_success',
      dealId: dealId,
      legs: orders.map(o => ({
        exchange: o.exchange_type,
        ticket: o.mt5_ticket,
        price: o.mt5_price
      }))
    });
  } else if (failedLegs > 0 && (doneLegs + failedLegs === totalLegs)) {
    // Some legs succeeded, but at least one failed.
    // Trigger reversals for the legs that succeeded to avoid unhedged exposure!
    const succeededOrders = orders.filter(o => o.status === 'done');
    const failedOrders = orders.filter(o => o.status === 'failed');
    
    for (const succ of succeededOrders) {
      // Find opposite action
      const revAction = succ.action === 'BUY' ? 'SELL' : 'BUY';
      
      // Insert reversal order into mt5_orders
      dbInsert(`
        INSERT INTO mt5_orders (
          deal_id, instrument_name, broker_id, account_id, exchange_type, mt5_symbol, action, lots, status, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `, [
        dealId, succ.instrument_name, succ.broker_id, succ.account_id, 
        succ.exchange_type, succ.mt5_symbol, revAction, succ.lots, `Reversal for failed order #${succ.id}`
      ]);
    }
    
    // Broadcast failure
    broadcast({
      type: 'commit_failure',
      dealId: dealId,
      message: `Leg execution failed. Reversal orders queued for successful legs.`,
      failedLegs: failedOrders.map(o => ({
        exchange: o.exchange_type,
        error: o.error_message || 'Execution failed'
      }))
    });
  }
}

function checkOrderTimeouts() {
  const now = Date.now();
  // We check pending orders that timed out (older than 15 seconds) using database-native timezone calculation
  const pendingOrders = dbAll(`
    SELECT * FROM mt5_orders 
    WHERE status = 'pending' 
      AND strftime('%s', 'now', 'localtime') - strftime('%s', created_at) > 15
  `);
  
  for (const o of pendingOrders) {
    dbRun(`
      UPDATE mt5_orders 
      SET status = 'failed', error_message = 'Timeout waiting for EA execution'
      WHERE id = ?
    `, [o.id]);
    
    broadcast({
      type: 'order_confirmed',
      orderId: o.id,
      success: false,
      error: 'Timeout waiting for EA execution'
    });
    
    if (o.deal_id) {
      checkDealStatus(o.deal_id);
    }
  }
}
setInterval(checkOrderTimeouts, 5000);

module.exports = { activeEAs, getEAStatus, checkDealStatus, checkOrderTimeouts };
