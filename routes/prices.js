// routes/prices.js
const express = require('express');
const router  = express.Router();
const requireAuth = require('../middleware/auth');
const { latestPrices } = require('../services/websocket');

router.post('/push', (req, res) => {
  res.json({ ok: true, note: 'push endpoint deprecated — using broadcast.json' });
});

router.get('/prices', requireAuth, (req, res) => {
  res.json(Object.values(latestPrices));
});

module.exports = router;