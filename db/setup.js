const pool = require('./pool');
const bcrypt = require('bcrypt');

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

const CONNECTIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS connections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type ENUM('modbus', 'opcua') NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    status ENUM('stopped', 'connecting', 'connected', 'error') DEFAULT 'stopped',
    config JSON NOT NULL,
    error_message TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    connection_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    config JSON NOT NULL,
    last_value DOUBLE DEFAULT NULL,
    last_raw_value DOUBLE DEFAULT NULL,
    last_read_at DATETIME DEFAULT NULL,
    error_message TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
  )
`;

const USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

const DASHBOARDS_TABLE = `
  CREATE TABLE IF NOT EXISTS dashboards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT DEFAULT NULL,
    is_public BOOLEAN DEFAULT FALSE,
    created_by INT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const DASHBOARD_WIDGETS_TABLE = `
  CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dashboard_id INT NOT NULL,
    title VARCHAR(100) NOT NULL,
    widget_type ENUM('well', 'flow_meter', 'pressure_meter', 'level_meter', 'gauge', 'chart') NOT NULL DEFAULT 'gauge',
    connection_id INT DEFAULT NULL,
    tag_id INT DEFAULT NULL,
    config JSON DEFAULT NULL,
    position INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
  )
`;

async function setupDatabase() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(FLOW_LOGS_TABLE);
    await conn.query(METER_READINGS_TABLE);
    await conn.query(CONNECTIONS_TABLE);
    await conn.query(TAGS_TABLE);
    try { await conn.query("ALTER TABLE tags ADD COLUMN last_raw_value DOUBLE DEFAULT NULL AFTER last_value"); } catch {}
    await conn.query(USERS_TABLE);
    await conn.query(DASHBOARDS_TABLE);
    await conn.query(DASHBOARD_WIDGETS_TABLE);
    try { await conn.query("ALTER TABLE dashboards ADD COLUMN is_default BOOLEAN DEFAULT FALSE"); } catch {}

    const rows = await conn.query('SELECT COUNT(*) AS cnt FROM users');
    if (Number(rows[0].cnt) === 0) {
      const hash = await bcrypt.hash('admin', 10);
      await conn.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
      console.log('[DB] Standardanvändare skapad: admin / admin');
    }

    console.log('[DB] Tabeller och schema är redo.');
  } catch (err) {
    console.error('[DB] Fel vid setup:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { setupDatabase };
