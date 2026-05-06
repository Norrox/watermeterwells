const pool = require('./pool');

const FLOW_LOGS_TABLE = `
  CREATE TABLE IF NOT EXISTS flow_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
    flow_rate DOUBLE,
    source VARCHAR(50)
  )
`;

const METER_READINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS meter_readings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    reading_value DOUBLE,
    interval_type ENUM('hourly', 'daily', 'weekly', 'monthly', 'yearly'),
    source VARCHAR(50)
  )
`;

async function setupDatabase() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(FLOW_LOGS_TABLE);
    await conn.query(METER_READINGS_TABLE);
    console.log('[DB] Tabeller och schema är redo.');
  } catch (err) {
    console.error('[DB] Fel vid setup:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { setupDatabase };
