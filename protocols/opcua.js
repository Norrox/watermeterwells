const { OPCUAClient, AttributeIds } = require('node-opcua');

let client = null;
let session = null;
let subscription = null;

async function start(config, onData) {
  client = OPCUAClient.create({ endpointMustExist: false });

  try {
    await client.connect(config.url);
    console.log('[OPC UA] Ansluten till', config.url);

    session = await client.createSession();
    subscription = await session.createSubscription2({
      requestedPublishingInterval: config.interval
    });

    const monitoredItem = await subscription.monitor(
      { nodeId: config.nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: config.interval }
    );

    monitoredItem.on('changed', (dataValue) => {
      onData(dataValue.value.value);
    });

    console.log('[OPC UA] Bevakar', config.nodeId);
  } catch (err) {
    console.error('[OPC UA] Kunde inte starta:', err.message);
  }
}

async function stop() {
  try {
    if (subscription) await subscription.terminate();
    if (session) await session.close();
    if (client) await client.disconnect();
  } catch {
    // best-effort cleanup
  }
  subscription = null;
  session = null;
  client = null;
}

module.exports = { start, stop };
