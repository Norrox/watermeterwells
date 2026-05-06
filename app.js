const express = require('express');
const errorHandler = require('./middleware/errorHandler');
const registerRoutes = require('./routes');

BigInt.prototype.toJSON = function () { return Number(this); };

const app = express();

app.use(express.json());
app.use(require('cookie-parser')());
registerRoutes(app);
app.use(errorHandler);

module.exports = app;
