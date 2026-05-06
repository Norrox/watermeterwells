const pool = require('../db/pool');

async function list() {
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(
      'SELECT id, name, type, enabled, status, config, error_message, created_at, updated_at FROM connections ORDER BY id'
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
      'SELECT id, name, type, enabled, status, config, error_message, created_at, updated_at FROM connections WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  } finally {
    if (conn) conn.release();
  }
}

async function create({ name, type, enabled, config }) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(
      'INSERT INTO connections (name, type, enabled, config) VALUES (?, ?, ?, ?)',
      [name, type, enabled !== false, JSON.stringify(config)]
    );
    return { id: Number(result.insertId), name, type, enabled: enabled !== false, config };
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
    await conn.query(`UPDATE connections SET ${fields.join(', ')} WHERE id = ?`, params);
    return getById(id);
  } finally {
    if (conn) conn.release();
  }
}

async function remove(id) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM connections WHERE id = ?', [id]);
  } finally {
    if (conn) conn.release();
  }
}

async function updateStatus(id, status, errorMessage) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'UPDATE connections SET status = ?, error_message = ? WHERE id = ?',
      [status, errorMessage || null, id]
    );
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { list, getById, create, update, remove, updateStatus };
