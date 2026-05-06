const cron = require('node-cron');
const config = require('../config');
const meterReading = require('../models/meterReading');

const SCHEDULES = [
  { cron: '0 * * * *',    interval: 'hourly'  },
  { cron: '0 0 * * *',    interval: 'daily'   },
  { cron: '59 23 * * 0',  interval: 'weekly'  },
  { cron: '5 * 1 * *',    interval: 'monthly' },
  { cron: '10 0 1 1 *',   interval: 'yearly'  }
];

const tasks = [];

function start() {
  SCHEDULES.forEach(({ cron: expression, interval }) => {
    const task = cron.schedule(expression, () => fetchAndLog(interval));
    tasks.push(task);
  });
  console.log('[Scheduler] Cron-jobb aktiva:', SCHEDULES.map(s => s.interval).join(', '));
}

function stop() {
  tasks.forEach((task) => task.stop());
  tasks.length = 0;
  console.log('[Scheduler] Stoppad.');
}

async function fetchAndLog(interval) {
  let value;
  if (config.demoMode) {
    value = Math.floor(Math.random() * 10000);
  } else {
    value = 1000;
  }
  await meterReading.insert(value, 'System_Main', interval);
}

module.exports = { start, stop };
