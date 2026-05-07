require('dotenv').config();

const app = require('./app');
const config = require('./config');
const { setupDatabase } = require('./db/setup');
const pool = require('./db/pool');
const collector = require('./services/collector');
const scheduler = require('./services/scheduler');

async function boot() {
  console.log(`[Boot] Startar server på port ${config.port}...`);
  console.log(`[Boot] Läge: ${config.demoMode ? 'DEMO' : 'PRODUKTION'}`);

  await setupDatabase();
  collector.start();
  scheduler.start();

  const server = app.listen(config.port, () => {
    console.log(`[Boot] Webserver aktiv på http://localhost:${config.port}`);
  });
  server.setTimeout(30000);

  process.on('SIGTERM', () => shutdown(server));
  process.on('SIGINT', () => shutdown(server));
}

async function shutdown(server) {
  console.log('[Shutdown] Stänger ner...');
  collector.stop();
  scheduler.stop();
  server.close(() => {
    pool.end();
    console.log('[Shutdown] Avslutad.');
    process.exit(0);
  });
}

boot().catch((err) => {
  console.error('[Boot] Misslyckades:', err);
  process.exit(1);
});
