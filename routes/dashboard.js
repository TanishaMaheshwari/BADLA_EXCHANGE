const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbInsert, dbRun } = require('../db');
const requireAuth = require('../middleware/auth');

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', requireAuth, (req, res) => {
  res.json(dbAll('SELECT instrument_name, position FROM dashboard_instruments WHERE user_id = ? ORDER BY position', [req.user.id]));
});

router.post('/dashboard', requireAuth, (req, res) => {
  const { instrument_name } = req.body;
  if (!instrument_name) return res.status(400).json({ error: 'Missing instrument_name' });
  const maxPos = dbGet('SELECT MAX(position) as m FROM dashboard_instruments WHERE user_id = ?', [req.user.id]);
  const pos = (maxPos?.m ?? -1) + 1;
  try {
    dbInsert('INSERT INTO dashboard_instruments (user_id, instrument_name, position) VALUES (?, ?, ?)', [req.user.id, instrument_name, pos]);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: 'Already on dashboard' }); }
});

router.delete('/dashboard/:name', requireAuth, (req, res) => {
  let name; try { name = decodeURIComponent(req.params.name); } catch (_) { name = req.params.name; }
  dbRun('DELETE FROM dashboard_instruments WHERE user_id = ? AND instrument_name = ?', [req.user.id, name]);
  res.json({ ok: true });
});

//───────────────────────────────────────────────────────────────────
module.exports = router;