const Modbus = require('jsmodbus');
const net = require('net');

let socket = null;
let timer = null;

function start(config, onData) {
  socket = new net.Socket();
  const client = new Modbus.client.TCP(socket);

  socket.on('connect', () => {
    console.log('[Modbus] Ansluten till', config.host + ':' + config.port);
    timer = setInterval(async () => {
      try {
        const res = await client.readHoldingRegisters(config.register, 2);
        const value = res.response._body._values[0];
        onData(value);
      } catch {
        // silent: individual read failures
      }
    }, config.interval);
  });

  socket.on('error', (err) => {
    console.error('[Modbus] Anslutningsfel:', err.message);
  });

  socket.on('close', () => {
    console.log('[Modbus] Anslutning stängd.');
  });

  socket.connect({ host: config.host, port: config.port });
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (socket) {
    socket.destroy();
    socket = null;
  }
}

module.exports = { start, stop };
