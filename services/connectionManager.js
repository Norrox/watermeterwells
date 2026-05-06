const connectionModel = require('../models/connection');
const tagModel = require('../models/tag');
const flowLog = require('../models/flowLog');
const ModbusConnection = require('../protocols/modbus');
const { OpcuaConnection } = require('../protocols/opcua');

const activeConnections = new Map();

async function startAll() {
  const connections = await connectionModel.list();
  for (const conn of connections) {
    if (conn.enabled) {
      try {
        await startConnection(conn.id);
      } catch (err) {
        console.error(`[ConnectionManager] Kunde inte starta ${conn.name}:`, err.message);
      }
    }
  }
  console.log(`[ConnectionManager] ${activeConnections.size} anslutning(ar) startade`);
}

async function stopAll() {
  for (const [id] of activeConnections) {
    stopConnection(id);
  }
  console.log('[ConnectionManager] Alla anslutningar stoppade');
}

async function startConnection(id) {
  stopConnection(id);

  const conn = await connectionModel.getById(id);
  if (!conn) throw new Error('Anslutning hittades inte');

  const tags = await tagModel.listByConnection(id);
  const enabledTags = tags.filter(t => t.enabled);

  const config = typeof conn.config === 'string' ? JSON.parse(conn.config) : conn.config;

  let instance;
  if (conn.type === 'modbus') {
    instance = new ModbusConnection(config, async (status, error) => {
      await connectionModel.updateStatus(id, status, error);
    });
  } else {
    instance = new OpcuaConnection(config, async (status, error) => {
      await connectionModel.updateStatus(id, status, error);
    });
  }

  try {
    await connectionModel.updateStatus(id, 'connecting', null);
    await instance.connect();
    await connectionModel.updateStatus(id, 'connected', null);
  } catch (err) {
    await connectionModel.updateStatus(id, 'error', err.message);
    throw err;
  }

  const tagsWithCallbacks = enabledTags.map(tag => {
    const tagConfig = typeof tag.config === 'string' ? JSON.parse(tag.config) : tag.config;
    return {
      ...tag,
      config: tagConfig,
      onData: async (result) => {
        const value = typeof result === 'object' && result.value !== undefined ? result.value : result;
        await tagModel.updateLastValue(tag.id, value);
        const source = `${conn.name}_${tag.name}`;
        await flowLog.insert(value, source);
      },
      onError: async (errorMsg) => {
        if (errorMsg) await tagModel.updateError(tag.id, errorMsg);
      }
    };
  });

  if (conn.type === 'modbus') {
    instance.startPolling(tagsWithCallbacks, id);
  } else {
    instance.startSubscriptions(tagsWithCallbacks);
  }

  activeConnections.set(id, instance);
  console.log(`[ConnectionManager] Startade: ${conn.name} (${conn.type})`);
}

function stopConnection(id) {
  const instance = activeConnections.get(id);
  if (instance) {
    instance.disconnect();
    activeConnections.delete(id);
    connectionModel.updateStatus(id, 'stopped', null).catch(() => {});
    console.log(`[ConnectionManager] Stoppade anslutning ${id}`);
  }
}

function getConnection(id) {
  return activeConnections.get(id) || null;
}

async function getStatus() {
  const connections = await connectionModel.list();
  return connections.map(conn => {
    const instance = activeConnections.get(conn.id);
    return {
      id: conn.id,
      name: conn.name,
      type: conn.type,
      enabled: conn.enabled,
      status: instance ? instance.status : 'stopped',
      active: !!instance,
      config: typeof conn.config === 'string' ? JSON.parse(conn.config) : conn.config,
      error: conn.error_message
    };
  });
}

module.exports = { startAll, stopAll, startConnection, stopConnection, getConnection, getStatus };
