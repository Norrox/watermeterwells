const mariadb = require('mariadb');
const config = require('../config');

const pool = mariadb.createPool(config.db);

module.exports = pool;
