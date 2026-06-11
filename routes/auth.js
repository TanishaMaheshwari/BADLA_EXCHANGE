const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { dbGet, dbInsert, dbRun, hashPassword } = require('../db');
const requireAuth = require('../middleware/auth');
const { latestPrices } = require('../services/websocket');

// ─── Auth ROUTES─────────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = dbGet('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || user.password !== hashPassword(password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  // FIX 10: Store expiry on insert
  dbInsert("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now','localtime','+30 days'))", [token, user.id]);
  res.json({ token, username: user.username });
});

router.post('/logout', requireAuth, (req, res) => {
  dbRun('DELETE FROM sessions WHERE token = ?', [req.headers['x-session-token']]);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

router.post('/admin/users', requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    dbInsert('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashPassword(password)]);
    res.json({ ok: true, username });
  } catch(e) { res.status(400).json({ error: 'Username already exists' }); }
});

// ───────────────────────────────────────────────────────────────────
module.exports = router;