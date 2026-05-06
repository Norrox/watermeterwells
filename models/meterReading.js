const pool = require('../db/pool');

async function insert(readingValue, source, intervalType) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO meter_readings (reading_value, source, interval_type) VALUES (?, ?, ?)',
      [readingValue, source, intervalType]
    );
    console.log(`[LOGG] Mätarställning (${intervalType}) sparad: ${readingValue} från ${source}`);
  } catch (err) {
    console.error(`[DB] Mätarfel (${intervalType}):`, err.message);
  } finally {
    if (conn) conn.release();
  }
}

async function getRecent(limit) {
  limit = Math.min(parseInt(limit) || 20, 200);
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(
      'SELECT id, reading_value, interval_type, source, timestamp FROM meter_readings ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
  } finally {
    if (conn) conn.release();
  }
}

async function getFiltered({ type, source, limit }) {
  limit = Math.min(parseInt(limit) || 50, 200);
  let conn;
  try {
    conn = await pool.getConnection();
    const conditions = [];
    const params = [];

    if (type) {
      conditions.push('interval_type = ?');
      params.push(type);
    }
    if (source) {
      conditions.push('source = ?');
      params.push(source);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit);

    return await conn.query(
      `SELECT id, reading_value, interval_type, source, timestamp FROM meter_readings ${where} ORDER BY timestamp DESC LIMIT ?`,
      params
    );
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { insert, getRecent, getFiltered };
