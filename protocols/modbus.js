const Modbus = require('jsmodbus');
const net = require('net');

class ModbusConnection {
  constructor(config, onStatusChange) {
    this.config = {
      host: config.host || '127.0.0.1',
      port: parseInt(config.port) || 502,
      unitId: parseInt(config.unitId) || 1,
      timeout: parseInt(config.timeout) || 5000
    };
    this.onStatusChange = onStatusChange || (() => {});
    this.socket = null;
    this.client = null;
    this.timers = {};
    this.status = 'stopped';
    this.tags = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this._setStatus('connecting');
      this.socket = new net.Socket();
      this.client = new Modbus.client.TCP(this.socket, this.config.unitId);

      const timeoutId = setTimeout(() => {
        this.socket.destroy();
        this._setStatus('error', 'Anslutningstimeout');
        reject(new Error('Connection timeout'));
      }, this.config.timeout);

      this.socket.on('connect', () => {
        clearTimeout(timeoutId);
        this._setStatus('connected');
        resolve();
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeoutId);
        this._setStatus('error', err.message);
        reject(err);
      });

      this.socket.on('close', () => {
        this._setStatus('stopped');
      });

      this.socket.connect({ host: this.config.host, port: this.config.port });
    });
  }

  startPolling(tags) {
    this.tags = tags.filter(t => t.enabled);
    this.stopPolling();

    for (const tag of this.tags) {
      const cfg = typeof tag.config === 'string' ? JSON.parse(tag.config) : tag.config;
      const interval = parseInt(cfg.pollInterval) || 1000;

      this.timers[tag.id] = setInterval(async () => {
        try {
          const value = await this.readRegister(cfg);
          if (tag.onData) tag.onData(value);
        } catch {
          // individual read failures are silent
        }
      }, interval);
    }
  }

  stopPolling() {
    for (const id of Object.keys(this.timers)) {
      clearInterval(this.timers[id]);
    }
    this.timers = {};
  }

  async readRegister(cfg) {
    if (!this.client || !this.socket || this.socket.destroyed) {
      throw new Error('Inte ansluten');
    }

    const registerType = cfg.registerType || 'holding';
    const address = parseInt(cfg.address) || 0;
    const quantity = parseInt(cfg.quantity) || 1;

    let response;
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

    const values = registerType === 'coil' || registerType === 'discrete'
      ? response.response._body._values
      : response.response._body._values;

    const rawValue = this.decodeValue(values, cfg);
    const scaling = parseFloat(cfg.scalingFactor) || 1;
    const offset = parseFloat(cfg.offset) || 0;
    return rawValue * scaling + offset;
  }

  decodeValue(values, cfg) {
    const dataType = cfg.dataType || 'uint16';
    const byteOrder = cfg.byteOrder || 'big';
    const wordOrder = cfg.wordOrder || 'big';

    if (dataType === 'uint16') {
      return values[0];
    }

    if (dataType === 'int16') {
      const v = values[0];
      return v > 32767 ? v - 65536 : v;
    }

    let registers = wordOrder === 'little' ? [...values].reverse() : [...values];

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

    if (byteOrder === 'bigSwap' || byteOrder === 'littleSwap') {
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
      const raw = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
      return raw;
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
    if (!this.client || !this.socket || this.socket.destroyed) {
      await this.connect();
    }
    const value = await this.readRegister(cfg);
    return { success: true, value, config: cfg };
  }

  async testBulkRead(registers) {
    if (!this.client || !this.socket || this.socket.destroyed) {
      await this.connect();
    }
    const results = [];
    for (const cfg of registers) {
      try {
        const value = await this.readRegister(cfg);
        results.push({ address: cfg.address, name: cfg.name || `Reg ${cfg.address}`, success: true, value });
      } catch (err) {
        results.push({ address: cfg.address, name: cfg.name || `Reg ${cfg.address}`, success: false, error: err.message });
      }
    }
    return results;
  }

  disconnect() {
    this.stopPolling();
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
