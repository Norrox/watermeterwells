const pool = require('../db/pool');

async function listByConnection(connectionId) {
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(
      'SELECT id, connection_id, name, enabled, config, last_value, last_raw_value, last_read_at, error_message, created_at FROM tags WHERE connection_id = ? ORDER BY id',
      [connectionId]
    );
  } finally {
    if (conn) conn.release();
  }
}

async function getById(id) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT id, connection_id, name, enabled, config, last_value, last_raw_value, last_read_at, error_message, created_at FROM tags WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  } finally {
    if (conn) conn.release();
  }
}

async function create(connectionId, { name, enabled, config }) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(
      'INSERT INTO tags (connection_id, name, enabled, config) VALUES (?, ?, ?, ?)',
      [connectionId, name, enabled !== false, JSON.stringify(config)]
    );
    return { id: Number(result.insertId), connection_id: connectionId, name, enabled: enabled !== false, config };
  } finally {
    if (conn) conn.release();
  }
}

async function update(id, { name, enabled, config }) {
  let conn;
  try {
    conn = await pool.getConnection();
    const fields = [];
    const params = [];

    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (enabled !== undefined) { fields.push('enabled = ?'); params.push(enabled); }
    if (config !== undefined) { fields.push('config = ?'); params.push(JSON.stringify(config)); }

    if (fields.length === 0) return getById(id);

    params.push(id);
    await conn.query(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`, params);
    return getById(id);
  } finally {
    if (conn) conn.release();
  }
}

async function remove(id) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM tags WHERE id = ?', [id]);
  } finally {
    if (conn) conn.release();
  }
}

async function updateLastValue(id, value) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'UPDATE tags SET last_value = ?, last_read_at = NOW(), error_message = NULL WHERE id = ?',
      [value, id]
    );
  } finally {
    if (conn) conn.release();
  }
}

async function updateLastValueWithRaw(id, value, rawValue) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'UPDATE tags SET last_value = ?, last_raw_value = ?, last_read_at = NOW(), error_message = NULL WHERE id = ?',
      [value, rawValue, id]
    );
  } finally {
    if (conn) conn.release();
  }
}

async function updateError(id, errorMessage) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'UPDATE tags SET error_message = ? WHERE id = ?',
      [errorMessage, id]
    );
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { listByConnection, getById, create, update, remove, updateLastValue, updateLastValueWithRaw, updateError };
