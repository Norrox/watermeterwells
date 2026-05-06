const express = require('express');
const router = express.Router();
const userModel = require('../models/user');
const { createSession, destroySession, getSession, extractToken } = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Användarnamn och lösenord krävs' });
  }

  try {
    const user = await userModel.verifyPassword(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Fel användarnamn eller lösenord' });
    }

    const token = createSession(user.id, user.username);
    res.cookie('session_token', token, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'strict'
    });
    res.json({ success: true, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Inloggningsfel' });
  }
});

router.post('/logout', (req, res) => {
  const token = extractToken(req);
  if (token) destroySession(token);
  res.clearCookie('session_token');
  res.json({ success: true });
});

router.get('/session', (req, res) => {
  const token = extractToken(req);
  if (!token) return res.json({ authenticated: false });
  const session = getSession(token);
  if (!session) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: session.username });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Både nuvarande och nytt lösenord krävs' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Lösenordet måste vara minst 4 tecken' });
  }

  try {
    const ok = await userModel.changePassword(req.user.userId, currentPassword, newPassword);
    if (!ok) return res.status(400).json({ error: 'Fel nuvarande lösenord' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Kunde inte ändra lösenord' });
  }
});

module.exports = router;
