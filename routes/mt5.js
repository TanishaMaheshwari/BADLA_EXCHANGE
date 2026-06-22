const express = require('express');
const path = require('path');
const router = express.Router();
const { dbAll } = require('../db');
const requireAuth = require('../middleware/auth');

router.get('/mt5/orders', requireAuth, (req, res) => {
  const orders = dbAll(`
    SELECT o.*, b.broker_name FROM mt5_orders o
    JOIN brokers b ON o.broker_id = b.id
    WHERE b.user_id = ? ORDER BY o.created_at DESC LIMIT 100
  `, [req.user.id]);
  res.json(orders);
});

module.exports = { router, pollMT5Status: () => {} };