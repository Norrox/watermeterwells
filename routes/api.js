const express = require('express');
const router = express.Router();
const flowLog = require('../models/flowLog');
const meterReading = require('../models/meterReading');
const pool = require('../db/pool');
const config = require('../config');

router.get('/data', async (req, res, next) => {
  try {
    const flow = await flowLog.getRecent(60);
    const meters = await meterReading.getRecent(20);
    res.json({ flow, meters });
  } catch (err) {
    next(err);
  }
});

router.get('/flow', async (req, res, next) => {
  try {
    const { from, to, source, limit } = req.query;

    if (from || to || source) {
      const rows = await flowLog.getFiltered({ from, to, source, limit });
      return res.json({ flow: rows });
    }

    const rows = await flowLog.getRecent(limit);
    res.json({ flow: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/meters', async (req, res, next) => {
  try {
    const { type, source, limit } = req.query;

    if (type || source) {
      const rows = await meterReading.getFiltered({ type, source, limit });
      return res.json({ meters: rows });
    }

    const rows = await meterReading.getRecent(limit);
    res.json({ meters: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await flowLog.getStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

router.get('/health', async (req, res) => {
  let dbOk = false;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('SELECT 1');
    dbOk = true;
  } catch {
    dbOk = false;
  } finally {
    if (conn) conn.release();
  }

  const status = dbOk ? 'ok' : 'degraded';
  const code = dbOk ? 200 : 503;

  res.status(code).json({
    status,
    mode: config.demoMode ? 'demo' : 'production',
    database: dbOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
