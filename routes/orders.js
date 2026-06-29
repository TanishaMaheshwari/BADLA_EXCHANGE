const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const requireAuth = require('../middleware/auth');

// ── GET /api/orders — list all orders for current user ───────────────────
router.get('/orders', requireAuth, (req, res) => {
  const orders = dbAll(`
    SELECT o.*,
      mb.name  AS mcx_broker_name,
      cb.name  AS comex_broker_name,
      db.name  AS dgcx_broker_name
    FROM orders o
    LEFT JOIN brokers mb ON mb.id = o.mcx_broker_id
    LEFT JOIN brokers cb ON cb.id = o.comex_broker_id
    LEFT JOIN brokers db ON db.id = o.dgcx_broker_id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `, [req.user.id]);

  res.json(orders);
});

// ── GET /api/orders/:id — single order ──────────────────────────────────
router.get('/orders/:id', requireAuth, (req, res) => {
  const order = dbGet(`
    SELECT o.*,
      mb.name AS mcx_broker_name,
      cb.name AS comex_broker_name,
      db.name AS dgcx_broker_name
    FROM orders o
    LEFT JOIN brokers mb ON mb.id = o.mcx_broker_id
    LEFT JOIN brokers cb ON cb.id = o.comex_broker_id
    LEFT JOIN brokers db ON db.id = o.dgcx_broker_id
    WHERE o.id = ? AND o.user_id = ?
  `, [req.params.id, req.user.id]);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// ── POST /api/orders — create new order ─────────────────────────────────
router.post('/orders', requireAuth, (req, res) => {
  const {
    instrument, instrument_id, note,
    mcx_side, mcx_qty, mcx_broker_id,
    comex_side, comex_qty, comex_broker_id,
    dgcx_enabled, dgcx_side, dgcx_qty, dgcx_broker_id,
    has_condition, condition_field, condition_dir, condition_value,
    place_immediately
  } = req.body;

  if (!instrument) return res.status(400).json({ error: 'instrument is required' });

  const id = dbInsert(`
    INSERT INTO orders (
      user_id, instrument, instrument_id, note,
      mcx_side, mcx_qty, mcx_broker_id,
      comex_side, comex_qty, comex_broker_id,
      dgcx_enabled, dgcx_side, dgcx_qty, dgcx_broker_id,
      has_condition, condition_field, condition_dir, condition_value,
      place_immediately, status
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, 'pending'
    )
  `, [
    req.user.id, instrument, instrument_id || null, note || null,
    mcx_side || null, mcx_qty || null, mcx_broker_id || null,
    comex_side || null, comex_qty || null, comex_broker_id || null,
    dgcx_enabled ? 1 : 0, dgcx_side || null, dgcx_qty || null, dgcx_broker_id || null,
    has_condition ? 1 : 0, condition_field || null, condition_dir || null, condition_value || null,
    place_immediately ? 1 : 0
  ]);

  const order = dbGet('SELECT * FROM orders WHERE id = ?', [id]);
  res.status(201).json(order);
});

// ── DELETE /api/orders/:id — cancel/delete order ─────────────────────────
router.delete('/orders/:id', requireAuth, (req, res) => {
  const order = dbGet('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (order.status === 'triggered') {
    return res.status(400).json({ error: 'Cannot delete an already triggered order' });
  }

  dbRun('DELETE FROM orders WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ── PATCH /api/orders/:id — update order status or fields ────────────────
router.patch('/orders/:id', requireAuth, (req, res) => {
  const order = dbGet('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const {
    status, note, condition_field, condition_dir, condition_value,
    has_condition, place_immediately
  } = req.body;

  dbRun(`
    UPDATE orders SET
      status            = COALESCE(?, status),
      note              = COALESCE(?, note),
      condition_field   = COALESCE(?, condition_field),
      condition_dir     = COALESCE(?, condition_dir),
      condition_value   = COALESCE(?, condition_value),
      has_condition     = COALESCE(?, has_condition),
      place_immediately = COALESCE(?, place_immediately)
    WHERE id = ?
  `, [
    status || null, note || null,
    condition_field || null, condition_dir || null, condition_value || null,
    has_condition !== undefined ? (has_condition ? 1 : 0) : null,
    place_immediately !== undefined ? (place_immediately ? 1 : 0) : null,
    req.params.id
  ]);

  const updated = dbGet('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  res.json(updated);
});

module.exports = router;