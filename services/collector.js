const config = require('../config');
const flowLog = require('../models/flowLog');
const modbus = require('../protocols/modbus');
const opcua = require('../protocols/opcua');
const simulator = require('../protocols/simulator');

const SOURCE_DEMO = 'Simulerad_Givare';
const SOURCE_MODBUS = 'Modbus_PLC';
const SOURCE_OPCUA = 'OPC_UA';

function start() {
  if (config.demoMode) {
    simulator.start((value) => flowLog.insert(value, SOURCE_DEMO));
  } else {
    modbus.start(config.modbus, (value) => flowLog.insert(value, SOURCE_MODBUS));
    opcua.start(config.opcua, (value) => flowLog.insert(value, SOURCE_OPCUA));
  }
  console.log(`[Collector] Startad (läge: ${config.demoMode ? 'DEMO' : 'PRODUKTION'})`);
}

function stop() {
  if (config.demoMode) {
    simulator.stop();
  } else {
    modbus.stop();
    opcua.stop();
  }
  console.log('[Collector] Stoppad.');
}

module.exports = { start, stop };
