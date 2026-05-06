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
    this.connected = false;
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
        this.connected = true;
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
        this.connected = false;
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
          if (tag.onError) tag.onError(null);
        } catch (err) {
          console.error(`[Modbus] Fel vid läsning av ${tag.name} (addr ${cfg.address}): ${err.message}`);
          if (tag.onError) tag.onError(err.message);
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
    if (!this.client || !this.socket || this.socket.destroyed || !this.connected) {
      throw new Error('Inte ansluten');
    }

    const registerType = cfg.registerType || 'holding';
    let address = parseInt(cfg.address) || 0;
    if (cfg.addressOffset) address += 1;
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

    const rawValues = response.response._body._valuesAsArray || response.response._body._values;
    const rawArray = Array.from(rawValues).map(v => v);

    const decodedValue = this.decodeValue(rawValues, cfg);
    const scaling = parseFloat(cfg.scalingFactor) || 1;
    const offset = parseFloat(cfg.offset) || 0;
    const finalValue = decodedValue * scaling + offset;

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
    if (!this.client || !this.socket || this.socket.destroyed || !this.connected) {
      await this.connect();
    }
    const result = await this.readRegister(cfg);
    return { success: true, ...result, address: cfg.address, config: cfg };
  }

  async testBulkRead(registers) {
    if (!this.client || !this.socket || this.socket.destroyed || !this.connected) {
      await this.connect();
    }
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
