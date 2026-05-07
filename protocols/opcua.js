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
    this.subscriptions = {};
    this.status = 'stopped';
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

      const connectTimeout = ms => new Promise((_, reject) =>
        setTimeout(() => { this.client?.disconnect().catch(() => {}); reject(new Error(`OPC UA-anslutningstimeout (${ms}ms) — kan inte n&#229; ${this.config.url}`)); }, ms)
      );

      const hasCredentials = this.config.username && this.config.username.trim();
        await Promise.race([
          this.client.connect(this.config.url),
          connectTimeout(this.config.timeout)
        ]);
        this.session = await Promise.race([
          this.client.createSession({
            userName: this.config.username,
            password: this.config.password
          }),
          connectTimeout(this.config.timeout)
        ]);
      } else {
        await Promise.race([
          this.client.connect(this.config.url),
          connectTimeout(this.config.timeout)
        ]);
        this.session = await Promise.race([
          this.client.createSession(),
          connectTimeout(this.config.timeout)
        ]);
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
      this._subscribeTag(tag);
    }
  }

  async _subscribeTag(tag) {
    const cfg = typeof tag.config === 'string' ? JSON.parse(tag.config) : tag.config;
    const interval = parseInt(cfg.samplingInterval) || 1000;

    try {
      const subscription = await this.session.createSubscription2({
        requestedPublishingInterval: interval
      });

      const monitoredItem = await subscription.monitor(
        { nodeId: cfg.nodeId, attributeId: AttributeIds.Value },
        { samplingInterval: interval }
      );

      monitoredItem.on('changed', (dataValue) => {
        let value = dataValue.value.value;
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

        if (tag.onData) tag.onData(value);
      });

      this.subscriptions[tag.id] = subscription;
    } catch (err) {
      this._setStatus('error', `Tag ${cfg.nodeId}: ${err.message}`);
    }
  }

  stopSubscriptions() {
    for (const id of Object.keys(this.subscriptions)) {
      try {
        this.subscriptions[id].terminate();
      } catch {
        // best-effort cleanup
      }
    }
    this.subscriptions = {};
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

module.exports = { OpcuaConnection, SECURITY_MODES, SECURITY_POLICIES };
