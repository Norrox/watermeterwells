const crypto = require('crypto');

const SESSIONS = new Map();

function createSession(userId, username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 24 * 60 * 60 * 1000;
  SESSIONS.set(token, { userId, username, expires });
  return token;
}

function getSession(token) {
  const session = SESSIONS.get(token);
  if (!session) return null;
  if (Date.now() > session.expires) {
    SESSIONS.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  SESSIONS.delete(token);
}

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.cookies && req.cookies.session_token) return req.cookies.session_token;
  return null;
}

module.exports = { createSession, getSession, destroySession, extractToken };
