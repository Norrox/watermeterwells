const pool = require('../db/pool');

function generateSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9åäö\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .substring(0, 120);
}

async function ensureUniqueSlug(slug) {
  let conn;
  try {
    conn = await pool.getConnection();
    let finalSlug = slug;
    let counter = 1;
    while (true) {
      const rows = await conn.query('SELECT id FROM dashboards WHERE slug = ?', [finalSlug]);
      if (rows.length === 0) return finalSlug;
      finalSlug = slug + '-' + counter++;
    }
  } finally {
    if (conn) conn.release();
  }
}

async function list() {
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(
      'SELECT id, name, slug, description, is_public, is_default, created_by, created_at, updated_at FROM dashboards ORDER BY id'
    );
  } finally {
    if (conn) conn.release();
  }
}

async function getBySlug(slug) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT id, name, slug, description, is_public, created_by, created_at, updated_at FROM dashboards WHERE slug = ?',
      [slug]
    );
    return rows[0] || null;
  } finally {
    if (conn) conn.release();
  }
}

async function getById(id) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT id, name, slug, description, is_public, created_by, created_at, updated_at FROM dashboards WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  } finally {
    if (conn) conn.release();
  }
}

async function create({ name, description, is_public, created_by }) {
  let conn;
  try {
    conn = await pool.getConnection();
    const baseSlug = generateSlug(name);
    const slug = await ensureUniqueSlug(baseSlug);
    const result = await conn.query(
      'INSERT INTO dashboards (name, slug, description, is_public, created_by) VALUES (?, ?, ?, ?, ?)',
      [name, slug, description || null, is_public || false, created_by || null]
    );
    return { id: Number(result.insertId), name, slug };
  } finally {
    if (conn) conn.release();
  }
}

async function update(id, { name, description, is_public }) {
  let conn;
  try {
    conn = await pool.getConnection();
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (is_public !== undefined) { fields.push('is_public = ?'); params.push(is_public); }
    if (fields.length === 0) return getById(id);
    params.push(id);
    await conn.query(`UPDATE dashboards SET ${fields.join(', ')} WHERE id = ?`, params);
    return getById(id);
  } finally {
    if (conn) conn.release();
  }
}

async function remove(id) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM dashboards WHERE id = ?', [id]);
  } finally {
    if (conn) conn.release();
  }
}

async function getWidgets(dashboardId) {
  let conn;
  try {
    conn = await pool.getConnection();
    const widgets = await conn.query(
      'SELECT w.id, w.dashboard_id, w.title, w.widget_type, w.connection_id, w.tag_id, w.config, w.position, w.created_at, ' +
      'c.name AS connection_name, c.type AS connection_type, c.config AS connection_config, ' +
      't.name AS tag_name, t.config AS tag_config, t.last_value AS tag_last_value, t.last_read_at AS tag_last_read_at ' +
      'FROM dashboard_widgets w ' +
      'LEFT JOIN connections c ON w.connection_id = c.id ' +
      'LEFT JOIN tags t ON w.tag_id = t.id ' +
      'WHERE w.dashboard_id = ? ORDER BY w.position, w.id',
      [dashboardId]
    );
    return widgets.map(w => ({
      ...w,
      config: typeof w.config === 'string' ? JSON.parse(w.config) : (w.config || {}),
      connection_config: typeof w.connection_config === 'string' ? JSON.parse(w.connection_config) : (w.connection_config || {}),
      tag_config: typeof w.tag_config === 'string' ? JSON.parse(w.tag_config) : (w.tag_config || {})
    }));
  } finally {
    if (conn) conn.release();
  }
}

async function addWidget(dashboardId, { title, widget_type, connection_id, tag_id, config, position }) {
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(
      'INSERT INTO dashboard_widgets (dashboard_id, title, widget_type, connection_id, tag_id, config, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [dashboardId, title, widget_type, connection_id || null, tag_id || null, JSON.stringify(config || {}), position || 0]
    );
    return { id: Number(result.insertId) };
  } finally {
    if (conn) conn.release();
  }
}

async function updateWidget(widgetId, { title, widget_type, connection_id, tag_id, config, position }) {
  let conn;
  try {
    conn = await pool.getConnection();
    const fields = [];
    const params = [];
    if (title !== undefined) { fields.push('title = ?'); params.push(title); }
    if (widget_type !== undefined) { fields.push('widget_type = ?'); params.push(widget_type); }
    if (connection_id !== undefined) { fields.push('connection_id = ?'); params.push(connection_id); }
    if (tag_id !== undefined) { fields.push('tag_id = ?'); params.push(tag_id); }
    if (config !== undefined) { fields.push('config = ?'); params.push(JSON.stringify(config)); }
    if (position !== undefined) { fields.push('position = ?'); params.push(position); }
    if (fields.length === 0) return;
    params.push(widgetId);
    await conn.query(`UPDATE dashboard_widgets SET ${fields.join(', ')} WHERE id = ?`, params);
  } finally {
    if (conn) conn.release();
  }
}

async function removeWidget(widgetId) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM dashboard_widgets WHERE id = ?', [widgetId]);
  } finally {
    if (conn) conn.release();
  }
}

async function getWidgetHistory(tagId, minutes) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT flow_rate, source, timestamp FROM flow_logs WHERE source LIKE ? AND timestamp >= DATE_SUB(NOW(), INTERVAL ? MINUTE) ORDER BY timestamp ASC',
      ['%' + '_%' + '%', parseInt(minutes) || 60]
    );
    return rows;
  } finally {
    if (conn) conn.release();
  }
}

async function getHistoryBySource(sourcePattern, minutes) {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT flow_rate, timestamp FROM flow_logs WHERE source = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL ? MINUTE) ORDER BY timestamp ASC',
      [sourcePattern, parseInt(minutes) || 60]
    );
    return rows;
  } finally {
    if (conn) conn.release();
  }
}

async function setDefault(id) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('UPDATE dashboards SET is_default = FALSE');
    await conn.query('UPDATE dashboards SET is_default = TRUE WHERE id = ?', [id]);
  } finally {
    if (conn) conn.release();
  }
}

async function getDefault() {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT id, name, slug, description, is_public, is_default, created_by, created_at, updated_at FROM dashboards WHERE is_default = TRUE LIMIT 1'
    );
    if (!rows[0]) return null;
    const dashboard = rows[0];
    const widgets = await conn.query(
      'SELECT w.id, w.dashboard_id, w.title, w.widget_type, w.connection_id, w.tag_id, w.config, w.position, w.created_at, ' +
      'c.name AS connection_name, c.type AS connection_type, c.config AS connection_config, ' +
      't.name AS tag_name, t.config AS tag_config, t.last_value AS tag_last_value, t.last_read_at AS tag_last_read_at ' +
      'FROM dashboard_widgets w ' +
      'LEFT JOIN connections c ON w.connection_id = c.id ' +
      'LEFT JOIN tags t ON w.tag_id = t.id ' +
      'WHERE w.dashboard_id = ? ORDER BY w.position, w.id',
      [dashboard.id]
    );
    dashboard.widgets = widgets.map(w => ({
      ...w,
      config: typeof w.config === 'string' ? JSON.parse(w.config) : (w.config || {}),
      connection_config: typeof w.connection_config === 'string' ? JSON.parse(w.connection_config) : (w.connection_config || {}),
      tag_config: typeof w.tag_config === 'string' ? JSON.parse(w.tag_config) : (w.tag_config || {})
    }));
    return dashboard;
  } finally {
    if (conn) conn.release();
  }
}

async function resolveMapMarkers(widgets) {
  const mapWidgets = widgets.filter(w => w.widget_type === 'map');
  if (!mapWidgets.length) return;

  const markerIds = new Set();
  for (const w of mapWidgets) {
    const markers = w.config.markers || [];
    for (const m of markers) {
      if (m.connection_id && m.tag_id) markerIds.add(m.connection_id + '_' + m.tag_id);
    }
  }
  if (!markerIds.size) return;

  const entries = [...markerIds];
  const connIds = [...new Set(entries.map(e => parseInt(e.split('_')[0])))];
  const tagIds = [...new Set(entries.map(e => parseInt(e.split('_')[1])))];

  let connDb;
  try {
    connDb = await pool.getConnection();
    const connections = await connDb.query(
      'SELECT id, name, type, config FROM connections WHERE id IN (' + connIds.map(() => '?').join(',') + ')',
      connIds
    );
    const tags = await connDb.query(
      'SELECT id, name, connection_id, last_value, last_read_at FROM tags WHERE id IN (' + tagIds.map(() => '?').join(',') + ')',
      tagIds
    );

    const connMap = {};
    connections.forEach(c => { connMap[c.id] = c; });
    const tagMap = {};
    tags.forEach(t => { tagMap[t.id] = t; });

    for (const w of mapWidgets) {
      w._resolvedMarkers = (w.config.markers || []).map(m => {
        const c = connMap[m.connection_id];
        const t = tagMap[m.tag_id];
        return {
          ...m,
          connection_name: c ? c.name : 'Okänd',
          connection_type: c ? c.type : '',
          tag_name: t ? t.name : 'Okänd',
          tag_last_value: t ? t.last_value : null,
          tag_last_read_at: t ? t.last_read_at : null,
          source: (c ? c.name : '') + '_' + (t ? t.name : '')
        };
      });
    }
  } finally {
    if (connDb) connDb.release();
  }
}

module.exports = { list, getBySlug, getById, create, update, remove, getWidgets, addWidget, updateWidget, removeWidget, getHistoryBySource, setDefault, getDefault, resolveMapMarkers };
