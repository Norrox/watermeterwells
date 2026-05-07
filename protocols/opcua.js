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
    this.config = {
      url: config.url || 'opc.tcp://localhost:4840',
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
        securityPolicy
      });

      if (this.config.username) {
        await this.client.connect(this.config.url);
        this.session = await this.client.createSession({
          userName: this.config.username,
          password: this.config.password
        });
      } else {
        await this.client.connect(this.config.url);
        this.session = await this.client.createSession();
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
      const dataValue = await this.session.read({
        nodeId,
        attributeId: AttributeIds.Value
      });

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
      const browseResult = await this.session.browse(nodeId || 'RootFolder');
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
