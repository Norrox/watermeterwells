const { OPCUAClient, AttributeIds, MessageSecurityMode, SecurityPolicy } = require('node-opcua');

const SECURITY_MODES = {
  'None': MessageSecurityMode.None,
  'Sign': MessageSecurityMode.Sign,
  'SignAndEncrypt': MessageSecurityMode.SignAndEncrypt
};

const SECURITY_POLICIES = {
  'None': SecurityPolicy.None,
  'Basic128': SecurityPolicy.Basic128,
  'Basic256': SecurityPolicy.Basic256,
  'Basic128Rsa15': SecurityPolicy.Basic128Rsa15,
  'Basic256Sha256': SecurityPolicy.Basic256Sha256
};

class OpcuaConnection {
  constructor(config, onStatusChange) {
    let url = (config.url || 'opc.tcp://localhost:4840').trim();
    if (!url.startsWith('opc.tcp://')) url = 'opc.tcp://' + url;
    if (!/:\d+$/.test(url.replace(/\/+$/, ''))) url = url.replace(/\/+$/, '') + ':4840';
    this.config = {
      url,
      timeout: parseInt(config.timeout) || 5000,
      securityMode: config.securityMode || 'None',
      securityPolicy: config.securityPolicy || 'None',
      username: config.username || null,
      password: config.password || null
    };
    this.onStatusChange = onStatusChange || (() => {});
    this.client = null;
    this.session = null;
    this.timers = {};
    this.status = 'stopped';
    this._reconnecting = false;
    this.tags = [];
  }

  async connect() {
    this._setStatus('connecting');

    try {
      const securityMode = SECURITY_MODES[this.config.securityMode] || MessageSecurityMode.None;
      const securityPolicy = SECURITY_POLICIES[this.config.securityPolicy] || SecurityPolicy.None;

      this.client = OPCUAClient.create({
        endpointMustExist: false,
        securityMode,
        securityPolicy,
        connectionStrategy: {
          maxRetry: 0,
          initialDelay: 100,
          maxDelay: 1000
        }
      });

      const client = this.client;
      const pendingTimers = [];

      const connectTimeout = ms => new Promise((_, reject) => {
        const id = setTimeout(() => {
          client.disconnect().catch(() => {});
          reject(new Error(`OPC UA-anslutningstimeout (${ms}ms) — kan inte nå ${this.config.url}`));
        }, ms);
        pendingTimers.push(id);
      });

      const clearPendingTimers = () => {
        for (const id of pendingTimers) clearTimeout(id);
        pendingTimers.length = 0;
      };

      await Promise.race([
        client.connect(this.config.url),
        connectTimeout(this.config.timeout)
      ]);
      clearPendingTimers();

      const hasCredentials = this.config.username && this.config.username.trim();
      if (hasCredentials) {
        try {
          this.session = await Promise.race([
            client.createSession({
              userName: this.config.username.trim(),
              password: this.config.password || ''
            }),
            connectTimeout(this.config.timeout)
          ]);
          clearPendingTimers();
        } catch (err) {
          clearPendingTimers();
          if (err.message && err.message.includes('user token policy')) {
            this.session = await Promise.race([
              client.createSession(),
              connectTimeout(this.config.timeout)
            ]);
            clearPendingTimers();
          } else {
            throw err;
          }
        }
      } else {
        this.session = await Promise.race([
          client.createSession(),
          connectTimeout(this.config.timeout)
        ]);
        clearPendingTimers();
      }

      this._setStatus('connected');
    } catch (err) {
      this._setStatus('error', err.message);
      throw err;
    }
  }

  startSubscriptions(tags) {
    this.stopSubscriptions();
    this.tags = tags.filter(t => t.enabled);

    if (!this.session) return;

    for (const tag of this.tags) {
      const cfg = typeof tag.config === 'string' ? JSON.parse(tag.config) : tag.config;
      const interval = parseInt(cfg.samplingInterval) || 1000;

      this.timers[tag.id] = setInterval(async () => {
        try {
          const result = await this.readNode(cfg.nodeId);
          if (result.success && tag.onData) {
            let value = result.value;
            if (typeof value === 'bigint') value = Number(value);
            if (cfg.dataType && cfg.dataType !== 'auto') {
              switch (cfg.dataType) {
                case 'boolean': value = Boolean(value); break;
                case 'float': value = parseFloat(value); break;
                case 'integer': value = parseInt(value, 10); break;
                case 'string': value = String(value); break;
              }
            }
            if (cfg.unitMultiplier) value *= parseFloat(cfg.unitMultiplier);
            const decimals = cfg.decimals !== undefined ? parseInt(cfg.decimals) : null;
            if (decimals !== null) value = parseFloat(value.toFixed(decimals));
            tag.onData(value);
            if (tag.onError) tag.onError(null);
          } else if (result.error && tag.onError) {
            if (/closed|session/i.test(result.error)) await this.ensureConnected();
            tag.onError(result.error);
          }
        } catch (err) {
          if (/closed|session/i.test(err.message)) await this.ensureConnected();
          if (tag.onError) tag.onError(err.message);
        }
      }, interval);
    }
  }

  stopSubscriptions() {
    for (const id of Object.keys(this.timers)) {
      clearInterval(this.timers[id]);
    }
    this.timers = {};
  }

  async ensureConnected() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    try {
      this.session = null;
      if (this.client) { try { await this.client.disconnect(); } catch {} }
      this.client = null;
      await this.connect();
    } finally {
      this._reconnecting = false;
    }
  }

  async readNode(nodeId) {
    if (!this.session) {
      await this.connect();
    }

    try {
      const dataValue = await Promise.race([
        this.session.read({ nodeId, attributeId: AttributeIds.Value }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`L&#228;sningstimeout (${this.config.timeout}ms) f&#246;r ${nodeId}`)), this.config.timeout))
      ]);

      let value = dataValue.value.value;
      if (typeof value === 'bigint') value = Number(value);

      return {
        success: true,
        value,
        statusCode: dataValue.statusCode.name,
        sourceTimestamp: dataValue.sourceTimestamp ? dataValue.sourceTimestamp.toISOString() : null,
        serverTimestamp: dataValue.serverTimestamp ? dataValue.serverTimestamp.toISOString() : null
      };
    } catch (err) {
      return { success: false, error: err.message, nodeId };
    }
  }

  async testRead(nodeIds) {
    if (!this.session) {
      await this.connect();
    }

    const results = [];
    for (const nodeId of nodeIds) {
      results.push({ nodeId, ...(await this.readNode(nodeId)) });
    }
    return results;
  }

  async browse(nodeId) {
    if (!this.session) {
      await this.connect();
    }

    try {
      const browseResult = await Promise.race([
        this.session.browse(nodeId || 'RootFolder'),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Bl&#228;ddringstimeout (${this.config.timeout}ms)`)), this.config.timeout))
      ]);
      const nodes = browseResult.references.map(ref => ({
        nodeId: ref.nodeId.toString(),
        browseName: ref.browseName.name,
        nodeClass: ref.nodeClass.toString(),
        displayName: ref.displayName.text
      }));
      return { success: true, nodeId: nodeId || 'RootFolder', nodes };
    } catch (err) {
      return { success: false, error: err.message, nodeId };
    }
  }

  async disconnect() {
    this.stopSubscriptions();
    try {
      if (this.session) await this.session.close();
      if (this.client) await this.client.disconnect();
    } catch {
      // best-effort cleanup
    }
    this.session = null;
    this.client = null;
    this._setStatus('stopped');
  }

  _setStatus(status, error) {
    this.status = status;
    this.onStatusChange(status, error);
  }
}

module.exports = { OpcuaConnection, SECURITY_MODES, SECURITY_POLICIES, normalizeNodeId };

function normalizeNodeId(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  const m = raw.match(/^NS(\d+)\|(Numeric|String|Guid|Opaque)\|(.+)$/i);
  if (!m) return raw;
  const ns = m[1];
  const type = m[2].toLowerCase();
  const id = m[3];
  switch (type) {
    case 'numeric': return `ns=${ns};i=${id}`;
    case 'string': return `ns=${ns};s=${id}`;
    case 'guid': return `ns=${ns};g=${id}`;
    case 'opaque': return `ns=${ns};b=${id}`;
    default: return raw;
  }
}
