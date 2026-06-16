const express = require('express');
const router  = express.Router();
const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const requireAuth = require('../middleware/auth');
const { latestPrices } = require('../services/websocket');

// Save browser push subscription
router.post('/push/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    return res.status(400).json({ error: 'Invalid subscription' });
  try {
    dbInsert(
      `INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Unsubscribe
router.delete('/push/subscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  dbRun('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
    [req.user.id, endpoint]);
  res.json({ ok: true });
});

// Get VAPID public key (frontend needs this to subscribe)
router.get('/push/vapid-key', requireAuth, (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post('/push/test', requireAuth, async (req, res) => {
  const { sendPushToUser } = require('../services/push');
  await sendPushToUser(req.user.id, {
    title: '🔔 Test Alert',
    body: 'Push notifications are working!',
    icon: '/icons/icon-192.png',
    tag: 'test',
    requireInteraction: true
  });
  res.json({ ok: true });
});

module.exports = router;

