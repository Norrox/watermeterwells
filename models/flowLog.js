const pool = require('../db/pool');

async function insert(flowRate, source) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO flow_logs (flow_rate, source) VALUES (?, ?)',
      [flowRate, source]
    );
  } catch {
    // silent: high-frequency logging, avoid console spam
  } finally {
    if (conn) conn.release();
  }
}

async function getRecent(limit) {
  limit = Math.min(parseInt(limit) || 60, 500);
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT flow_rate, timestamp, source FROM flow_logs ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
    return rows.reverse();
  } finally {
    if (conn) conn.release();
  }
}

async function getFiltered({ from, to, source, limit }) {
  limit = Math.min(parseInt(limit) || 100, 1000);
  let conn;
  try {
    conn = await pool.getConnection();
    const conditions = [];
    const params = [];

    if (from) {
      conditions.push('timestamp >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('timestamp <= ?');
      params.push(to);
    }
    if (source) {
      conditions.push('source = ?');
      params.push(source);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit);

    const rows = await conn.query(
      `SELECT flow_rate, timestamp, source FROM flow_logs ${where} ORDER BY timestamp DESC LIMIT ?`,
      params
    );
    return rows.reverse();
  } finally {
    if (conn) conn.release();
  }
}

async function getStats() {
  let conn;
  try {
    conn = await pool.getConnection();
    const avg = await conn.query(
      'SELECT AVG(flow_rate) AS avg_flow, MIN(flow_rate) AS min_flow, MAX(flow_rate) AS max_flow, COUNT(*) AS total_samples FROM flow_logs'
    );
    const latest = await conn.query(
      'SELECT flow_rate, timestamp FROM flow_logs ORDER BY timestamp DESC LIMIT 1'
    );
    return {
      avgFlow: avg[0].avg_flow ? Math.round(avg[0].avg_flow * 100) / 100 : 0,
      minFlow: avg[0].min_flow || 0,
      maxFlow: avg[0].max_flow || 0,
      totalSamples: avg[0].total_samples || 0,
      latestFlow: latest[0] ? latest[0].flow_rate : 0,
      latestTimestamp: latest[0] ? latest[0].timestamp : null
    };
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { insert, getRecent, getFiltered, getStats };
