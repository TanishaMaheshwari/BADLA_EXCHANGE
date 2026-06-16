// services/broadcast.js
const fs = require('fs');
const path = require('path');
const { broadcast, latestPrices } = require('./websocket');
const { dbAll, dbRun } = require('../db');
const { sendPushToUser } = require('./push');

const BROADCAST_FILE = path.join(__dirname, '../broadcast.json');

function getCurrentValue(data, field) {
  if (field.includes('.')) {
    const [obj, key] = field.split('.');
    return data[obj] ? parseFloat(data[obj][key]) : NaN;
  }
  return parseFloat(data[field]);
}

function getBrokerShare(brokerId) {
  if (!brokerId) return 1;
  const broker = dbAll('SELECT * FROM brokers WHERE id = ?', [brokerId])[0];
  return broker ? (parseFloat(broker.profit_share) || 0) / 100 : 1;
}

function computeDealLivePnl(deal, p) {
  let mcxPnl = 0, comexPnl = 0, dgcxPnl = 0;

  if (deal.mcx_side && deal.mcx_price != null && p?.mcx) {
    const qty = parseFloat(deal.mcx_qty) || 1;
    const brok = parseFloat(deal.mcx_brokerage) || 0;
    const now = deal.mcx_side === 'SELL' ? p.mcx.bid : p.mcx.ask;
    if (now != null) {
      const raw = deal.mcx_side === 'SELL'
        ? (parseFloat(deal.mcx_price) - parseFloat(now))
        : (parseFloat(now) - parseFloat(deal.mcx_price));
      mcxPnl = (raw * qty - brok) * getBrokerShare(deal.mcx_broker_id);
    }
  }

  if (deal.comex_side && deal.comex_price != null && p?.comex) {
    const qty = parseFloat(deal.comex_qty) || 1;
    const brok = parseFloat(deal.comex_brokerage) || 0;
    const now = deal.comex_side === 'SELL' ? p.comex.bid : p.comex.ask;
    if (now != null) {
      const raw = deal.comex_side === 'SELL'
        ? (parseFloat(deal.comex_price) - parseFloat(now))
        : (parseFloat(now) - parseFloat(deal.comex_price));
      const convRate = raw >= 0 ? 88.88 : 89;
      comexPnl = (raw * qty * convRate - brok) * getBrokerShare(deal.comex_broker_id);
    }
  }

  if (deal.dgcx_enabled && deal.dgcx_side && deal.dgcx_price != null && p?.dgcx) {
    const qty = parseFloat(deal.dgcx_qty) || 1;
    const brok = parseFloat(deal.dgcx_brokerage) || 0;
    const now = p.dgcx.ltp;
    if (now != null) {
      const raw = deal.dgcx_side === 'SELL'
        ? (parseFloat(deal.dgcx_price) - parseFloat(now))
        : (parseFloat(now) - parseFloat(deal.dgcx_price));
      const convRate = raw >= 0 ? 88.88 : 89;
      dgcxPnl = (raw * qty * convRate - brok) * getBrokerShare(deal.dgcx_broker_id);
    }
  }

  return mcxPnl + comexPnl + dgcxPnl;
}

async function checkDealPnlAlert(alert, data) {
  const deal = dbAll('SELECT * FROM deals WHERE id = ?', [alert.deal_id])[0];
  if (!deal) return;
  if (deal.status !== 'open') return;   // skip alerts on closed deals

  const total = computeDealLivePnl(deal, data);
  const hit = alert.direction === 'above' ? total >= alert.target : total <= alert.target;
  if (!hit) return;

  dbRun(
    "UPDATE notifications SET status='fired', fired_at=datetime('now','localtime') WHERE id=?",
    [alert.id]
  );

  await sendPushToUser(alert.user_id, {
    title: `🔔 Deal P/L: ${alert.instrument_name}`,
    body: `NET P/L ${alert.direction === 'above' ? '≥' : '≤'} ₹${alert.target} (now ₹${total.toFixed(2)})`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `alert-${alert.id}`,
    requireInteraction: true
  });

  broadcast({
    type: 'notification_fired',
    alertId: alert.id,
    instrument: alert.instrument_name,
    dealId: alert.deal_id,
    direction: alert.direction,
    target: alert.target,
    value: total
  });
}

async function checkPriceFieldAlert(alert, data) {
  const val = getCurrentValue(data, alert.field);
  if (isNaN(val)) return;
  const hit = alert.direction === 'above' ? val >= alert.target : val <= alert.target;
  if (!hit) return;

  dbRun(
    "UPDATE notifications SET status='fired', fired_at=datetime('now','localtime') WHERE id=?",
    [alert.id]
  );

  await sendPushToUser(alert.user_id, {
    title: `🔔 Alert: ${alert.instrument_name}`,
    body: `${alert.field} ${alert.direction === 'above' ? '≥' : '≤'} ${alert.target} (now ${val.toFixed(2)})`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `alert-${alert.id}`,
    requireInteraction: true
  });

  broadcast({
    type: 'notification_fired',
    alertId: alert.id,
    instrument: alert.instrument_name,
    field: alert.field,
    direction: alert.direction,
    target: alert.target,
    value: val
  });
}

async function checkNotifications(data) {
  const armed = dbAll(
    `SELECT * FROM notifications WHERE status = 'armed' AND instrument_name = ?`,
    [data.name]
  );

  for (const alert of armed) {
    if (alert.type === 'deal_pnl_alert') {
      await checkDealPnlAlert(alert, data);
    } else {
      await checkPriceFieldAlert(alert, data);
    }
  }
}

function startBroadcastWatcher() {
  if (fs.existsSync(BROADCAST_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(BROADCAST_FILE, 'utf8'));
      for (const [id, result] of Object.entries(raw.data || {}))
        latestPrices[id] = result;
      console.log(`Seeded ${Object.keys(latestPrices).length} instruments`);
    } catch(e) { console.warn('Could not seed:', e.message); }
  }

  let debounceTimer = null;
  const watchDir  = path.dirname(BROADCAST_FILE);
  const watchFile = path.basename(BROADCAST_FILE);

  fs.watch(watchDir, (eventType, filename) => {
    if (filename !== watchFile) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const raw = JSON.parse(fs.readFileSync(BROADCAST_FILE, 'utf8'));
        for (const [id, result] of Object.entries(raw.data || {})) {
          latestPrices[id] = result;
          broadcast({ type: 'update', data: result });
          await checkNotifications(result);  // ← check alerts on every price update
        }
      } catch(e) { console.error('broadcast watcher error:', e.message); }
    }, 4);
  });

  console.log(`Watching ${BROADCAST_FILE}`);
}

module.exports = { startBroadcastWatcher, checkNotifications };