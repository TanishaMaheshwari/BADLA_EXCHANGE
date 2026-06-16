const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const requireAuth = require('../middleware/auth');

// ── Migration note ──────────────────────────────────────────────────────
// Run once: ALTER TABLE notifications ADD COLUMN deal_id INTEGER;
// Existing price_alert rows are unaffected (deal_id stays NULL for them).

// Get all armed alerts for current user (price alerts + deal P/L alerts)
router.get('/notifications', requireAuth, (req, res) => {
  res.json(dbAll(
    "SELECT * FROM notifications WHERE user_id = ? AND status = 'armed' ORDER BY created_at DESC",
    [req.user.id]
  ));
});

// Save an alert — price_alert (instrumentName/field) or deal_pnl_alert (dealId)
router.post('/notifications', requireAuth, (req, res) => {
  const { instrumentName, dashboardInstrumentId, dealId, field, direction, target, type } = req.body;
  const alertType = type || 'price_alert';

  if (alertType === 'deal_pnl_alert') {
    if (!dealId || !direction || target == null)
      return res.status(400).json({ error: 'Missing fields' });
  } else {
    if (!instrumentName || !field || !direction || target == null)
      return res.status(400).json({ error: 'Missing fields' });
  }

  const id = dbInsert(`
    INSERT INTO notifications
      (user_id, dashboard_instrument_id, deal_id, type, instrument_name, field, direction, target, status, push_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'armed', 1)
  `, [req.user.id, dashboardInstrumentId || null, dealId || null, alertType,
      instrumentName || null, field || 'pnl', direction, parseFloat(target)]);

  res.json(dbGet('SELECT * FROM notifications WHERE id = ?', [id]));
});

// Update existing alert (works for both types)
router.put('/notifications/:id', requireAuth, (req, res) => {
  const { field, direction, target } = req.body;
  dbRun(`
    UPDATE notifications SET field=?, direction=?, target=?, status='armed'
    WHERE id=? AND user_id=?
  `, [field || 'pnl', direction, parseFloat(target), parseInt(req.params.id), req.user.id]);
  res.json(dbGet('SELECT * FROM notifications WHERE id = ?', [parseInt(req.params.id)]));
});

// Delete alert
router.delete('/notifications/:id', requireAuth, (req, res) => {
  dbRun('DELETE FROM notifications WHERE id = ? AND user_id = ?',
    [parseInt(req.params.id), req.user.id]);
  res.json({ ok: true });
});

// Reset fired alert back to armed
router.post('/notifications/:id/reset', requireAuth, (req, res) => {
  dbRun("UPDATE notifications SET status='armed', fired_at=NULL WHERE id=? AND user_id=?",
    [parseInt(req.params.id), req.user.id]);
  res.json({ ok: true });
});

module.exports = router;