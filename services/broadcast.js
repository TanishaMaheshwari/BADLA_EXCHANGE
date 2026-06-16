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

async function checkNotifications(data) {
  const firedAlerts = dbAll(`
    SELECT n.*, di.user_id
    FROM notifications n
    JOIN dashboard_instruments di ON n.dashboard_instrument_id = di.id
    WHERE n.status = 'armed'
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
      await sendPushToUser(alert.user_id, {
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
      } catch(e) {}
    }, 4);
  });

  console.log(`Watching ${BROADCAST_FILE}`);
}

async function checkNotifications(data) {
  const firedAlerts = dbAll(`
    SELECT n.*
    FROM notifications n
    WHERE n.status = 'armed'
      AND n.instrument_name = ?
  `, [data.name]);

  // console.log(`checkNotifications: ${data.name} — ${firedAlerts.length} armed alerts`);

  for (const alert of firedAlerts) {
    const val = getCurrentValue(data, alert.field);
    if (isNaN(val)) continue;
    const hit = alert.direction === 'above' ? val >= alert.target : val <= alert.target;
    if (hit) {
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
  }
}

module.exports = { startBroadcastWatcher, checkNotifications };