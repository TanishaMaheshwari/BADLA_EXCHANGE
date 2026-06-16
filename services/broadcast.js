// services/broadcast.js
const fs = require('fs');
const path = require('path');
const { broadcast, latestPrices } = require('./websocket');
const { dbAll, dbGet, dbRun } = require('../db');
const { sendPushToUser } = require('./push');

const BROADCAST_FILE = path.join(__dirname, '../broadcast.json');

function getCurrentValue(data, field) {
  if (field.includes('.')) {
    const [obj, key] = field.split('.');
    return data[obj] ? parseFloat(data[obj][key]) : NaN;
  }
  return parseFloat(data[field]);
}

// ── Price alerts (type='price_alert') ───────────────────────────────────
async function checkNotifications(data) {
  const firedAlerts = dbAll(`
    SELECT n.*, di.user_id AS owner_id
    FROM notifications n
    JOIN dashboard_instruments di ON n.dashboard_instrument_id = di.id
    WHERE n.status = 'armed'
      AND n.type = 'price_alert'
      AND n.instrument_name = ?
  `, [data.name]);

  for (const alert of firedAlerts) {
    const val = getCurrentValue(data, alert.field);
    if (isNaN(val)) continue;
    const hit = alert.direction === 'above' ? val >= alert.target : val <= alert.target;
    if (hit) {
      dbRun(
        "UPDATE notifications SET status='fired', fired_at=datetime('now','localtime') WHERE id=?",
        [alert.id]
      );
      await sendPushToUser(alert.owner_id, {
        title: `🔔 Alert: ${alert.instrument_name}`,
        body: `${alert.field} ${alert.direction === 'above' ? '≥' : '≤'} ${alert.target} (now ${val.toFixed(2)})`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `alert-${alert.id}`,
        requireInteraction: true
      });
      // Also broadcast to any open tabs via WebSocket
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
  }
}

// ── Deal P&L alerts (type='deal_pnl_alert') ───────────────────────────────
// Mirrors the client-side getLivePnl() math in public/js/deals.js so the
// server can independently verify a deal's live P&L without a browser tab open.
function computeLegPnl(side, entryPrice, nowPrice, qty, brokerage, isComex) {
  if (nowPrice == null || isNaN(parseFloat(nowPrice))) return null;
  const raw = side === 'SELL'
    ? (parseFloat(entryPrice) - parseFloat(nowPrice))
    : (parseFloat(nowPrice) - parseFloat(entryPrice));
  if (isComex) {
    const convRate = raw >= 0 ? 88.88 : 89;
    return raw * qty * convRate - brokerage;
  }
  return raw * qty - brokerage;
}

function getDealLivePnl(deal, priceData) {
  let mcxPnl = null, comexPnl = null, dgcxPnl = null;

  if (deal.mcx_side && priceData.mcx) {
    const qty   = parseFloat(deal.mcx_qty) || 1;
    const brok  = parseFloat(deal.mcx_brokerage) || 0;
    const now   = deal.mcx_side === 'SELL' ? priceData.mcx.bid : priceData.mcx.ask;
    const share = deal.mcx_profit_share != null ? deal.mcx_profit_share / 100 : 1;
    const raw   = computeLegPnl(deal.mcx_side, deal.mcx_price, now, qty, brok, false);
    if (raw != null) mcxPnl = raw * share;
  }
  if (deal.comex_side && priceData.comex) {
    const qty   = parseFloat(deal.comex_qty) || 1;
    const brok  = parseFloat(deal.comex_brokerage) || 0;
    const now   = deal.comex_side === 'SELL' ? priceData.comex.bid : priceData.comex.ask;
    const share = deal.comex_profit_share != null ? deal.comex_profit_share / 100 : 1;
    const raw   = computeLegPnl(deal.comex_side, deal.comex_price, now, qty, brok, true);
    if (raw != null) comexPnl = raw * share;
  }
  if (deal.dgcx_enabled && deal.dgcx_side && priceData.dgcx) {
    const qty   = parseFloat(deal.dgcx_qty) || 1;
    const brok  = parseFloat(deal.dgcx_brokerage) || 0;
    const now   = priceData.dgcx.ltp;
    const share = deal.dgcx_profit_share != null ? deal.dgcx_profit_share / 100 : 1;
    const raw   = computeLegPnl(deal.dgcx_side, deal.dgcx_price, now, qty, brok, true);
    if (raw != null) dgcxPnl = raw * share;
  }

  return (mcxPnl || 0) + (comexPnl || 0) + (dgcxPnl || 0);
}

// Checks armed deal_pnl_alerts for any open deal on the ticked instrument.
// Needs the full price object for that instrument (mcx+comex+dgcx) since a
// deal's P&L spans all its legs, not just whichever single leg just ticked.
async function checkDealPnlNotifications(priceData, tickedInstrumentName) {
  const firedAlerts = dbAll(`
    SELECT n.*, d.user_id AS owner_id,
           d.instrument AS deal_instrument,
           d.mcx_side, d.mcx_price, d.mcx_qty, d.mcx_brokerage, d.mcx_broker_id,
           d.comex_side, d.comex_price, d.comex_qty, d.comex_brokerage, d.comex_broker_id,
           d.dgcx_enabled, d.dgcx_side, d.dgcx_price, d.dgcx_qty, d.dgcx_brokerage, d.dgcx_broker_id
    FROM notifications n
    JOIN deals d ON n.deal_id = d.id
    WHERE n.status = 'armed'
      AND n.type = 'deal_pnl_alert'
      AND d.status = 'open'
      AND d.instrument = ?
  `, [tickedInstrumentName]);

  if (firedAlerts.length === 0) return;
  if (!priceData) return;

  for (const alert of firedAlerts) {
    const mcxBroker   = alert.mcx_broker_id   ? dbGet('SELECT profit_share FROM brokers WHERE id = ?', [alert.mcx_broker_id])   : null;
    const comexBroker = alert.comex_broker_id ? dbGet('SELECT profit_share FROM brokers WHERE id = ?', [alert.comex_broker_id]) : null;
    const dgcxBroker  = alert.dgcx_broker_id  ? dbGet('SELECT profit_share FROM brokers WHERE id = ?', [alert.dgcx_broker_id])  : null;

    const dealForPnl = {
      ...alert,
      mcx_profit_share:   mcxBroker   ? mcxBroker.profit_share   : null,
      comex_profit_share: comexBroker ? comexBroker.profit_share : null,
      dgcx_profit_share:  dgcxBroker  ? dgcxBroker.profit_share  : null,
    };

    const pnl = getDealLivePnl(dealForPnl, priceData);
    const hit = alert.direction === 'above' ? pnl >= alert.target : pnl <= alert.target;
    if (hit) {
      dbRun(
        "UPDATE notifications SET status='fired', fired_at=datetime('now','localtime') WHERE id=?",
        [alert.id]
      );
      await sendPushToUser(alert.owner_id, {
        title: `🔔 Deal Alert: ${alert.deal_instrument}`,
        body: `NET P/L ${alert.direction === 'above' ? '≥' : '≤'} ${alert.target} (now ${pnl.toFixed(0)})`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `deal-alert-${alert.id}`,
        requireInteraction: true
      });
      broadcast({
        type: 'notification_fired',
        alertId: alert.id,
        instrument: alert.deal_instrument,
        field: 'pnl',
        direction: alert.direction,
        target: alert.target,
        value: pnl,
        dealAlert: true
      });
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
          await checkNotifications(result);                       // price alerts
          await checkDealPnlNotifications(result, result.name);   // deal P&L alerts
        }
      } catch(e) {}
    }, 4);
  });

  console.log(`Watching ${BROADCAST_FILE}`);
}

module.exports = { startBroadcastWatcher, checkNotifications, checkDealPnlNotifications };