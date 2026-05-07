const express = require('express');
const path = require('path');
const router = express.Router();
const dashboardModel = require('../models/dashboard');
const { getSession } = require('../services/auth');

router.get('/', async (req, res) => {
  try {
    const token = req.cookies && req.cookies.session_token;
    const session = token ? getSession(token) : null;
    if (!session) {
      const defaultDb = await dashboardModel.getDefault();
      if (defaultDb) {
        return res.sendFile(path.join(__dirname, '..', 'views', 'public-dashboard.html'));
      }
    }
    res.sendFile(path.join(__dirname, '..', 'views', 'dashboard.html'));
  } catch {
    res.sendFile(path.join(__dirname, '..', 'views', 'dashboard.html'));
  }
});

router.get('/d/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'public-dashboard.html'));
});

module.exports = router;
