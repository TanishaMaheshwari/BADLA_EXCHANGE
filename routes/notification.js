const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const requireAuth = require('../middleware/auth');

// Get all armed alerts for current user
router.get('/notifications', requireAuth, (req, res) => {
  res.json(dbAll(
    "SELECT * FROM notifications WHERE user_id = ? AND status = 'armed' ORDER BY created_at DESC",
    [req.user.id]
  ));
});

// Save a price alert
router.post('/notifications', requireAuth, (req, res) => {
  const { instrumentName, dashboardInstrumentId, field, direction, target, type, dealId } = req.body;
    if (!instrumentName || !direction || target == null || (type !== 'deal_pnl_alert' && !field))
    return res.status(400).json({ error: 'Missing fields' });
    const id = dbInsert(`
        INSERT INTO notifications
        (user_id, dashboard_instrument_id, type, instrument_name, field, direction, target, status, push_enabled, deal_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'armed', 1, ?)
    `, [req.user.id, dashboardInstrumentId || null, type || 'price_alert',
        instrumentName, field, direction, parseFloat(target), dealId || null]);

  res.json(dbGet('SELECT * FROM notifications WHERE id = ?', [id]));
});

// Update existing alert
router.put('/notifications/:id', requireAuth, (req, res) => {
  const { field, direction, target } = req.body;
  dbRun(`
    UPDATE notifications SET field=?, direction=?, target=?, status='armed'
    WHERE id=? AND user_id=?
  `, [field, direction, parseFloat(target), parseInt(req.params.id), req.user.id]);
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