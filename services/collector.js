const config = require('../config');
const flowLog = require('../models/flowLog');
const connectionManager = require('./connectionManager');
const simulator = require('../protocols/simulator');

const SOURCE_DEMO = 'Simulerad_Givare';

function start() {
  if (config.demoMode) {
    simulator.start((value) => flowLog.insert(value, SOURCE_DEMO));
  }
  connectionManager.startAll().catch(err => {
    console.error('[Collector] Kunde inte starta DB-anslutningar:', err.message);
  });
  console.log(`[Collector] Startad (läge: ${config.demoMode ? 'DEMO' : 'PRODUKTION'})`);
}

function stop() {
  simulator.stop();
  connectionManager.stopAll();
  console.log('[Collector] Stoppad.');
}

module.exports = { start, stop };
