const express = require('express');
const path = require('path');
const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'dashboard.html'));
});

router.get('/d/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'public-dashboard.html'));
});

module.exports = router;
