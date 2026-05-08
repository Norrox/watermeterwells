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
    this._lastCloseLog = 0;
    this.onStatusChange = onStatusChange || (() => {});
    this.socket = null;
    this.client = null;
    this.timers = {};
    this.status = 'stopped';
    this.tags = [];
    this.reconnectTimer = null;
    this.config_ref = config;
    this.connId = null;
    this._connectPromise = null;
    this._lastReadError = {};
    this._closeCount = 0;
    this._closeWindow = 0;
    this._warnedRapidReconnect = false;
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
          const now = Date.now();
          if (now - this._closeWindow > 60000) {
            this._closeWindow = now;
            this._closeCount = 1;
            this._warnedRapidReconnect = false;
            console.warn(`[Modbus] Socket stängdes — återansluter automatiskt`);
          } else {
            this._closeCount++;
            if (this._closeCount >= 5 && !this._warnedRapidReconnect) {
              this._warnedRapidReconnect = true;
              console.warn(`[Modbus] Frekventa frånkopplingar (${this._closeCount} st på 60s) — kontrollera nätverk/enhet`);
            }
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

  _cleanupSocket() {
    if (this.socket) {
      try { this.socket.removeAllListeners(); } catch (e) {}
      try { this.socket.destroy(); } catch (e) {}
    }
    this.socket = null;
    this.client = null;
    this.connected = false;
  }

  async ensureConnected() {
    if (this.connected && this.socket && !this.socket.destroyed) return;
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

    for (const tag of this.tags) {
      const cfg = typeof tag.config === 'string' ? JSON.parse(tag.config) : tag.config;
      const interval = parseInt(cfg.pollInterval) || 1000;

      this.timers[tag.id] = setInterval(async () => {
        try {
          await this.ensureConnected();
          const result = await this.readRegister(cfg);
          if (tag.onData) tag.onData(result);
          if (tag.onError) tag.onError(null);
        } catch (err) {
          const msg = this.parseError(err, cfg);
          if (!this._isConnectionError(err)) {
            const key = `${tag.id}`;
            const now = Date.now();
            const lastLog = this._lastReadError[key] || 0;
            if (now - lastLog > 60000) {
              this._lastReadError[key] = now;
              console.error(`[Modbus] ${msg}`);
            }
          }
          if (tag.onError) tag.onError(msg);
        }
      }, interval);
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

  stopPolling() {
    for (const id of Object.keys(this.timers)) {
      clearInterval(this.timers[id]);
    }
    this.timers = {};
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async readRegister(cfg, _retry = true) {
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
      if (_retry && this._isConnectionError(err)) {
        this.connected = false;
        await this.ensureConnected();
        return this.readRegister(cfg, false);
      }
      throw new Error(this.parseError(err, cfg));
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
    this.connected = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.client = null;
    }
    this._setStatus('stopped');
  }

  _setStatus(status, error) {
    this.status = status;
    this.onStatusChange(status, error);
  }
}

module.exports = ModbusConnection;
