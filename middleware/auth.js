const { dbGet } = require('../db');
module.exports = function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  // FIX 10: Also reject expired sessions
  const session = dbGet(
    "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now','localtime')",
    [token]
  );
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  const user = dbGet('SELECT * FROM users WHERE id = ?', [session.user_id]);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}
