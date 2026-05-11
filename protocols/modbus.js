const Modbus = require('jsmodbus');
const net = require('net');
const { applyScaling } = require('./scaling');

const MODBUS_ERRORS = {
  1: 'Illegal Function - enheten stöder inte denna funktion',
  2: 'Illegal Data Address - ogiltig registeradress',
  3: 'Illegal Data Value - ogiltigt datavärde',
  4: 'Server Device Failure - enheten fungerar inte',
  5: 'Acknowledge - enheten bearbetar (försök igen)',
  6: 'Server Device Busy - enheten är upptagen',
  7: 'Negative Acknowledge - enheten nekade begäran',
  10: 'Gateway Path Unavailable',
  11: 'Gateway Target Device Failed to Respond'
};

class ModbusConnection {
  constructor(config, onStatusChange) {
    this.config = {
      host: config.host || '127.0.0.1',
      port: parseInt(config.port) || 502,
      unitId: parseInt(config.unitId) || 1,
      timeout: parseInt(config.timeout) || 5000
    };
    this.connected = false;
    this.onStatusChange = onStatusChange || (() => {});
    this.socket = null;
    this.client = null;
    this.status = 'stopped';
    this.tags = [];
    this.connId = null;
    this._connectPromise = null;
    this._lastReadError = {};
    this.config_ref = config;

    this.reconnectTimer = null;
    this._pollTimer = null;

    this._baseReconnectDelay = 1000;
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 30000;
    this._consecutiveFailures = 0;
    this._circuitBreakerThreshold = 10;
    this._circuitBreakerCooldown = 60000;
    this._circuitOpen = false;
    this._isReconnecting = false;
    this._reconnectScheduled = false;
  }

  _resetReconnectState() {
    this._reconnectDelay = this._baseReconnectDelay;
    this._consecutiveFailures = 0;
    this._circuitOpen = false;
    this._isReconnecting = false;
    this._reconnectScheduled = false;
  }

  _cleanupSocket() {
    if (this.socket) {
      try { this.socket.removeAllListeners(); } catch (e) {}
      try { this.socket.destroy(); } catch (e) {}
    }
    this.socket = null;
    this.client = null;
    this.connected = false;
  }

  _scheduleReconnect() {
    if (this._isReconnecting || this.status === 'stopped') return;
    if (this._reconnectScheduled) return;

    this._reconnectScheduled = true;
    this._consecutiveFailures++;

    let delay;
    if (this._consecutiveFailures >= this._circuitBreakerThreshold) {
      delay = this._circuitBreakerCooldown;
      if (!this._circuitOpen) {
        this._circuitOpen = true;
        console.warn(`[Modbus] Circuit breaker öppnad — ${this._consecutiveFailures} misslyckade försök, väntar ${delay / 1000}s`);
      }
    } else {
      delay = this._reconnectDelay;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, this._maxReconnectDelay);
      console.warn(`[Modbus] Återanslutning om ${Math.round(delay / 1000)}s (försök ${this._consecutiveFailures})`);
    }

    this.reconnectTimer = setTimeout(async () => {
      this._reconnectScheduled = false;
      this._isReconnecting = true;
      try {
        await this.connect();
        const attempts = this._consecutiveFailures;
        this._resetReconnectState();
        console.log(`[Modbus] Återansluten efter ${attempts} försök`);
      } catch (err) {
        this._isReconnecting = false;
        this._scheduleReconnect();
      }
    }, delay);
  }

  async connect() {
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      if (this.socket && !this.socket.destroyed && this.connected) {
        resolve();
        return;
      }

      this._cleanupSocket();
      this._setStatus('connecting');
      this.socket = new net.Socket();
      this.socket.setKeepAlive(true, 10000);
      this.socket.setNoDelay(true);
      this.client = new Modbus.client.TCP(this.socket, this.config.unitId);

      const timeoutId = setTimeout(() => {
        this.socket.destroy();
        this._setStatus('error', 'Anslutningstimeout');
        reject(new Error('Connection timeout'));
      }, this.config.timeout);

      this.socket.once('connect', () => {
        clearTimeout(timeoutId);
        this.connected = true;
        this._setStatus('connected');
        resolve();
      });

      this.socket.once('error', (err) => {
        clearTimeout(timeoutId);
        this.connected = false;
        if (this.status !== 'stopped') {
          this._setStatus('error', err.message);
        }
        reject(err);
      });

      this.socket.on('close', () => {
        this.connected = false;
        if (this.status !== 'stopped') {
          if (this._pollTimer) {
            console.warn(`[Modbus] Socket stängdes — schemalägger återanslutning`);
            this._scheduleReconnect();
          } else {
            console.warn(`[Modbus] Socket stängdes`);
          }
        }
      });

      this.socket.connect({ host: this.config.host, port: this.config.port });
    });

    try {
      return await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  async ensureConnected() {
    if (this.connected && this.socket && !this.socket.destroyed) return;
    if (this._isReconnecting || this._reconnectScheduled) return;
    this.connected = false;
    return this.connect();
  }

  _isConnectionError(err) {
    const msg = (err.message || String(err)).toLowerCase();
    return msg.includes('closed') || msg.includes('econnreset') || msg.includes('timed') || msg.includes('not connected');
  }

  startPolling(tags, connId) {
    this.tags = tags.filter(t => t.enabled);
    this.connId = connId;
    this.stopPolling();

    this._reconnectScheduled = false;
    this._isReconnecting = false;

    if (this.tags.length === 0) return;

    const interval = this.tags.reduce((min, tag) => {
      const cfg = typeof tag.config === 'string' ? JSON.parse(tag.config) : tag.config;
      const t = parseInt(cfg.pollInterval) || 1000;
      return Math.min(min, t);
    }, Infinity);

    this._pollTimer = setInterval(async () => {
      if (this._isReconnecting || this._reconnectScheduled) return;
      if (!this.connected) {
        this._scheduleReconnect();
        return;
      }

      for (const tag of this.tags) {
        const cfg = typeof tag.config === 'string' ? JSON.parse(tag.config) : tag.config;
        try {
          const result = await this.readRegister(cfg);
          if (tag.onData) tag.onData(result);
          if (tag.onError) tag.onError(null);
        } catch (err) {
          if (this._isConnectionError(err)) {
            this.connected = false;
            if (tag.onError) tag.onError('Anslutningsfel — återansluter');
            this._scheduleReconnect();
            return;
          }
          const msg = this.parseError(err, cfg);
          const key = `${tag.id}`;
          const now = Date.now();
          const lastLog = this._lastReadError[key] || 0;
          if (now - lastLog > 60000) {
            this._lastReadError[key] = now;
            console.error(`[Modbus] ${msg}`);
          }
          if (tag.onError) tag.onError(msg);
        }
      }
    }, interval);
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this._reconnectScheduled = false;
    }
  }

  parseError(err, cfg) {
    const msg = err.message || String(err);
    let code = 0;

    if (err.response && err.response.body) {
      code = err.response.body.code || err.response.body.exceptionCode || 0;
    }

    if (!code) {
      const m1 = msg.match(/code\s*(?:is|=)?\s*(\d+)/i);
      if (m1) code = parseInt(m1[1]);
    }
    if (!code) {
      const m2 = msg.match(/exception\s*.*?(\d+)/i);
      if (m2) code = parseInt(m2[1]);
    }

    const address = cfg.address !== undefined ? cfg.address : '?';
    let desc;
    if (code !== 0) {
      desc = MODBUS_ERRORS[code] || `Okänd felkod ${code}`;
    } else {
      desc = msg.length > 100 ? msg.substring(0, 100) + '...' : msg;
    }
    let hint = '';
    if (code === 2) hint = ' — Kontrollera att adressen är rätt. PLC-notation 40001 = adress 0.';
    return `Adress ${address}: ${desc}${hint}`;
  }

  async readRegister(cfg) {
    await this.ensureConnected();

    const registerType = cfg.registerType || 'holding';
    let address = parseInt(cfg.address) || 0;
    if (cfg.addressOffset) address += 1;
    const quantity = parseInt(cfg.quantity) || 1;

    let response;
    try {
      switch (registerType) {
        case 'holding':
          response = await this.client.readHoldingRegisters(address, quantity);
          break;
        case 'input':
          response = await this.client.readInputRegisters(address, quantity);
          break;
        case 'coil':
          response = await this.client.readCoils(address, quantity);
          break;
        case 'discrete':
          response = await this.client.readDiscreteInputs(address, quantity);
          break;
        default:
          response = await this.client.readHoldingRegisters(address, quantity);
      }
    } catch (err) {
      if (this._isConnectionError(err)) {
        this.connected = false;
      }
      throw err;
    }

    const rawValues = response.response._body._valuesAsArray || response.response._body._values;
    const rawArray = Array.from(rawValues).map(v => v);

    const decodedValue = this.decodeValue(rawValues, cfg);
    const finalValue = applyScaling(decodedValue, cfg);

    return { value: finalValue, rawRegisters: rawArray, decodedRaw: decodedValue };
  }

  decodeValue(values, cfg) {
    const dataType = cfg.dataType || 'uint16';
    const byteOrder = cfg.byteOrder || 'big';
    const wordOrder = cfg.wordOrder || 'big';
    const byteSwap = !!cfg.byteSwap;
    const wordSwap = !!cfg.wordSwap;

    if (dataType === 'uint16') {
      let v = values[0];
      if (byteSwap) v = ((v & 0xFF) << 8) | ((v >> 8) & 0xFF);
      return v;
    }

    if (dataType === 'int16') {
      let v = values[0];
      if (byteSwap) v = ((v & 0xFF) << 8) | ((v >> 8) & 0xFF);
      return v > 32767 ? v - 65536 : v;
    }

    let registers = [...values];

    if (wordOrder === 'little' || wordSwap) {
      registers = [...registers].reverse();
    }

    let bytes = [];
    for (const reg of registers) {
      if (byteOrder === 'big' || byteOrder === 'bigSwap') {
        bytes.push((reg >> 8) & 0xFF);
        bytes.push(reg & 0xFF);
      } else {
        bytes.push(reg & 0xFF);
        bytes.push((reg >> 8) & 0xFF);
      }
    }

    if (byteOrder === 'bigSwap' || byteOrder === 'littleSwap' || byteSwap) {
      const swapped = [];
      for (let i = 0; i < bytes.length; i += 2) {
        swapped.push(bytes[i + 1]);
        swapped.push(bytes[i]);
      }
      bytes = swapped;
    }

    if (dataType === 'uint32') {
      return (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    }

    if (dataType === 'int32') {
      return (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    }

    if (dataType === 'float32') {
      const buf = Buffer.alloc(4);
      for (let i = 0; i < 4; i++) buf[i] = bytes[i];
      return buf.readFloatBE(0);
    }

    if (dataType === 'float64') {
      const buf = Buffer.alloc(8);
      for (let i = 0; i < 8; i++) buf[i] = bytes[i];
      return buf.readDoubleBE(0);
    }

    return values[0];
  }

  async testRead(cfg) {
    await this.ensureConnected();
    const result = await this.readRegister(cfg);
    return { success: true, ...result, address: cfg.address, config: cfg };
  }

  async testBulkRead(registers) {
    await this.ensureConnected();
    const results = [];
    for (const cfg of registers) {
      try {
        const result = await this.readRegister(cfg);
        results.push({ address: cfg.address, name: cfg.name || `Reg ${cfg.address}`, success: true, ...result });
      } catch (err) {
        results.push({ address: cfg.address, name: cfg.name || `Reg ${cfg.address}`, success: false, error: err.message });
      }
    }
    return results;
  }

  disconnect() {
    this.stopPolling();
    this._resetReconnectState();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._cleanupSocket();
    this._setStatus('stopped');
  }

  _setStatus(status, error) {
    this.status = status;
    this.onStatusChange(status, error);
  }
}

module.exports = ModbusConnection;
