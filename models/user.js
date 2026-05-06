const pool = require('../db/pool');
const bcrypt = require('bcrypt');

async function findByUsername(username) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM users WHERE username = ?', [username]);
    return rows[0] || null;
  } finally {
    if (conn) conn.release();
  }
}

async function verifyPassword(username, password) {
  const user = await findByUsername(username);
  if (!user) return null;
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return null;
  return { id: user.id, username: user.username };
}

async function changePassword(userId, currentPassword, newPassword) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
    if (!rows[0]) return false;
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return false;
    const hash = await bcrypt.hash(newPassword, 10);
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
    return true;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { findByUsername, verifyPassword, changePassword };
