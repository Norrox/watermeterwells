const { extractToken, getSession } = require('../services/auth');

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Inte inloggad' });
  }

  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Session har gått ut' });
  }

  req.user = session;
  next();
}

module.exports = { requireAuth };
