let timer = null;

function start(onData) {
  console.log('[Simulator] DEMO-LÄGE: Genererar simulerad data...');
  timer = setInterval(() => {
    const mockFlow = 45 + Math.random() * 10;
    onData(mockFlow);
  }, 1000);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop };
