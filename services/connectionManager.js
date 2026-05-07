const connectionModel = require('../models/connection');
const tagModel = require('../models/tag');
const flowLog = require('../models/flowLog');
const ModbusConnection = require('../protocols/modbus');
const { OpcuaConnection } = require('../protocols/opcua');

const activeConnections = new Map();
const lastLogTimes = new Map();

function shouldLog(tagId, tagConfig) {
  if (!tagConfig.logToDatabase) return false;
  const interval = parseInt(tagConfig.logInterval) || 0;
  if (interval <= 0) return true;
  const now = Date.now();
  const last = lastLogTimes.get(tagId) || 0;
  if (now - last >= interval) {
    lastLogTimes.set(tagId, now);
    return true;
  }
  return false;
}

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
        const rawValue = typeof result === 'object' && result.decodedRaw !== undefined ? result.decodedRaw : null;
        await tagModel.updateLastValueWithRaw(tag.id, value, rawValue);
        if (shouldLog(tag.id, tagConfig)) {
          const source = `${conn.name}_${tag.name}`;
          await flowLog.insert(value, source);
        }
      },
      onError: async (errorMsg) => {
        await tagModel.updateError(tag.id, errorMsg || null);
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
