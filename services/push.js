const webpush = require('web-push');
const { dbAll, dbRun } = require('../db');

webpush.setVapidDetails(
  'mailto:you@yourdomain.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushToUser(userId, payload) {
  const subs = dbAll('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
  console.log(`Sending push to user ${userId}, ${subs.length} subscription(s)`);

  // WebSocket fallback — works instantly for open tabs
  const { broadcast } = require('./websocket');
  console.log('broadcasting show_notification to all clients');
  broadcast({ type: 'show_notification', userId, payload });

  // FCM push for closed/background tabs
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      console.log('Push sent successfully to', sub.endpoint.substring(0, 50));
    } catch(e) {
      console.error('Push failed:', e.statusCode, e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        dbRun('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
      }
    }
  }
}

module.exports = { sendPushToUser };