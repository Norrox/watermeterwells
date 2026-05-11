module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT) || 3000,
  demoMode: (process.env.DEMO_MODE || 'true') === 'true',

  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'industrial_logs',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10
  },

  modbus: {
    host: process.env.MODBUS_IP || '192.168.1.50',
    port: parseInt(process.env.MODBUS_PORT) || 502,
    register: parseInt(process.env.MODBUS_REGISTER) || 100,
    interval: parseInt(process.env.MODBUS_INTERVAL) || 1000
  },

  opcua: {
    url: process.env.OPC_URL || 'opc.tcp://192.168.1.100:4840',
    nodeId: process.env.OPC_NODE_ID || 'ns=1;s=FlowSensor01',
    interval: parseInt(process.env.OPC_INTERVAL) || 1000
  }
};
