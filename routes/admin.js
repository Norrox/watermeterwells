const express = require('express');
const router = express.Router();
const connectionModel = require('../models/connection');
const tagModel = require('../models/tag');
const connectionManager = require('../services/connectionManager');
const ModbusConnection = require('../protocols/modbus');
const { OpcuaConnection } = require('../protocols/opcua');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/connections', async (req, res, next) => {
  try {
    const status = await connectionManager.getStatus();
    for (const conn of status) {
      const tags = await tagModel.listByConnection(conn.id);
      conn.tags = tags.map(t => ({
        ...t,
        config: typeof t.config === 'string' ? JSON.parse(t.config) : t.config
      }));
    }
    res.json(status);
  } catch (err) { next(err); }
});

router.get('/connections/:id', async (req, res, next) => {
  try {
    const conn = await connectionModel.getById(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Hittades inte' });
    const tags = await tagModel.listByConnection(conn.id);
    const instance = connectionManager.getConnection(conn.id);
    res.json({
      ...conn,
      config: typeof conn.config === 'string' ? JSON.parse(conn.config) : conn.config,
      status: instance ? instance.status : conn.status,
      active: !!instance,
      tags: tags.map(t => ({
        ...t,
        config: typeof t.config === 'string' ? JSON.parse(t.config) : t.config
      }))
    });
  } catch (err) { next(err); }
});

router.post('/connections', async (req, res, next) => {
  try {
    const { name, type, enabled, config } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'Namn och typ krävs' });
    if (!['modbus', 'opcua'].includes(type)) return res.status(400).json({ error: 'Ogiltig typ' });

    const conn = await connectionModel.create({ name, type, enabled, config });
    res.status(201).json(conn);
  } catch (err) { next(err); }
});

router.put('/connections/:id', async (req, res, next) => {
  try {
    const wasActive = !!connectionManager.getConnection(req.params.id);
    const conn = await connectionModel.update(req.params.id, req.body);
    if (!conn) return res.status(404).json({ error: 'Hittades inte' });
    if (wasActive) {
      try { await connectionManager.startConnection(req.params.id); } catch {}
    }
    res.json(conn);
  } catch (err) { next(err); }
});

router.delete('/connections/:id', async (req, res, next) => {
  try {
    connectionManager.stopConnection(req.params.id);
    await connectionModel.remove(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/connections/:id/start', async (req, res, next) => {
  try {
    await connectionManager.startConnection(req.params.id);
    const conn = await connectionModel.getById(req.params.id);
    res.json({ success: true, status: 'connected' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/connections/:id/stop', (req, res) => {
  connectionManager.stopConnection(req.params.id);
  res.json({ success: true, status: 'stopped' });
});

router.post('/connections/:id/test', async (req, res, next) => {
  try {
    const conn = await connectionModel.getById(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Hittades inte' });

    const config = typeof conn.config === 'string' ? JSON.parse(conn.config) : conn.config;
    let instance;

    if (conn.type === 'modbus') {
      instance = new ModbusConnection(config);
    } else {
      instance = new OpcuaConnection(config);
    }

    try {
      await instance.connect();
      let registerTest = null;
      if (conn.type === 'modbus') {
        try {
          const tags = await tagModel.listByConnection(conn.id);
          const firstTag = tags.find(t => t.enabled);
          if (firstTag) {
            const tagConfig = typeof firstTag.config === 'string' ? JSON.parse(firstTag.config) : firstTag.config;
            const readResult = await instance.testRead(tagConfig);
            registerTest = { tag: firstTag.name, success: true, value: readResult.value, raw: readResult.rawRegisters };
          } else {
            registerTest = { tag: null, success: true, note: 'Inga taggar att testa' };
          }
        } catch (err) {
          registerTest = { tag: 'test', success: false, error: err.message };
        }
      }
      const result = {
        success: true,
        message: `Ansluten till ${conn.type === 'modbus' ? config.host + ':' + config.port : config.url}`,
        registerTest
      };
      await instance.disconnect();
      res.json(result);
    } catch (err) {
      await instance.disconnect();
      res.json({ success: false, error: err.message });
    }
  } catch (err) { next(err); }
});

router.get('/connections/:connId/tags', async (req, res, next) => {
  try {
    const tags = await tagModel.listByConnection(req.params.connId);
    res.json(tags.map(t => ({
      ...t,
      config: typeof t.config === 'string' ? JSON.parse(t.config) : t.config
    })));
  } catch (err) { next(err); }
});

router.post('/connections/:connId/tags', async (req, res, next) => {
  try {
    const { name, enabled, config } = req.body;
    if (!name) return res.status(400).json({ error: 'Namn krävs' });
    const tag = await tagModel.create(req.params.connId, { name, enabled, config });
    const wasActive = !!connectionManager.getConnection(req.params.connId);
    if (wasActive) {
      try { await connectionManager.startConnection(req.params.connId); } catch {}
    }
    res.status(201).json(tag);
  } catch (err) { next(err); }
});

router.put('/tags/:id', async (req, res, next) => {
  try {
    const tag = await tagModel.update(req.params.id, req.body);
    if (!tag) return res.status(404).json({ error: 'Hittades inte' });
    const wasActive = !!connectionManager.getConnection(tag.connection_id);
    if (wasActive) {
      try { await connectionManager.startConnection(tag.connection_id); } catch {}
    }
    res.json(tag);
  } catch (err) { next(err); }
});

router.delete('/tags/:id', async (req, res, next) => {
  try {
    const tag = await tagModel.getById(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Hittades inte' });
    await tagModel.remove(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/tags/:id/test', async (req, res, next) => {
  try {
    const tag = await tagModel.getById(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Hittades inte' });

    const conn = await connectionModel.getById(tag.connection_id);
    const config = typeof conn.config === 'string' ? JSON.parse(conn.config) : conn.config;
    const tagConfig = typeof tag.config === 'string' ? JSON.parse(tag.config) : tag.config;

    let instance;
    if (conn.type === 'modbus') {
      instance = new ModbusConnection(config);
    } else {
      instance = new OpcuaConnection(config);
    }

    try {
      await instance.connect();
      let result;
      if (conn.type === 'modbus') {
        result = await instance.testRead(tagConfig);
      } else {
        result = await instance.readNode(tagConfig.nodeId);
      }
      await instance.disconnect();
      res.json(result);
    } catch (err) {
      try { await instance.disconnect(); } catch {}
      res.json({ success: false, error: err.message, config: tagConfig });
    }
  } catch (err) { next(err); }
});

router.post('/connections/:connId/test-read', async (req, res, next) => {
  try {
    const conn = await connectionModel.getById(req.params.connId);
    if (!conn) return res.status(404).json({ error: 'Hittades inte' });

    const tags = await tagModel.listByConnection(req.params.connId);
    const enabledTags = tags.filter(t => t.enabled);

    const config = typeof conn.config === 'string' ? JSON.parse(conn.config) : conn.config;
    let instance;

    if (conn.type === 'modbus') {
      instance = new ModbusConnection(config);
    } else {
      instance = new OpcuaConnection(config);
    }

    try {
      await instance.connect();
      let results;
      if (conn.type === 'modbus') {
        const registers = enabledTags.map(t => typeof t.config === 'string' ? JSON.parse(t.config) : t.config);
        results = await instance.testBulkRead(registers);
      } else {
        const nodeIds = enabledTags.map(t => {
          const c = typeof t.config === 'string' ? JSON.parse(t.config) : t.config;
          return c.nodeId;
        });
        results = await instance.testRead(nodeIds);
      }
      await instance.disconnect();
      res.json({ success: true, results });
    } catch (err) {
      await instance.disconnect();
      res.json({ success: false, error: err.message });
    }
  } catch (err) { next(err); }
});

router.post('/test/modbus-read', async (req, res) => {
  try {
    const { host, port, unitId, timeout, registers } = req.body;
    if (!host || !registers || !registers.length) {
      return res.status(400).json({ error: 'Host och registerlista krävs' });
    }

    const instance = new ModbusConnection({ host, port, unitId, timeout });
    try {
      await instance.connect();
      const results = await instance.testBulkRead(registers);
      await instance.disconnect();
      res.json({ success: true, results });
    } catch (err) {
      await instance.disconnect();
      res.json({ success: false, error: err.message });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/test/opcua-read', async (req, res) => {
  try {
    const { url, securityMode, securityPolicy, username, password, nodeIds } = req.body;
    if (!url || !nodeIds || !nodeIds.length) {
      return res.status(400).json({ error: 'URL och nodeId-lista krävs' });
    }

    const instance = new OpcuaConnection({ url, securityMode, securityPolicy, username, password });
    try {
      await instance.connect();
      const results = await instance.testRead(nodeIds);
      await instance.disconnect();
      res.json({ success: true, results });
    } catch (err) {
      await instance.disconnect();
      res.json({ success: false, error: err.message });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

router.post('/test/opcua-browse', async (req, res) => {
  try {
    const { url, securityMode, securityPolicy, username, password, nodeId } = req.body;
    if (!url) return res.status(400).json({ error: 'URL krävs' });

    const instance = new OpcuaConnection({ url, securityMode, securityPolicy, username, password });
    try {
      await instance.connect();
      const result = await instance.browse(nodeId || 'RootFolder');
      await instance.disconnect();
      res.json(result);
    } catch (err) {
      await instance.disconnect();
      res.json({ success: false, error: err.message });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
