const express = require('express');
const errorHandler = require('./middleware/errorHandler');
const registerRoutes = require('./routes');

const app = express();

app.use(express.json());
registerRoutes(app);
app.use(errorHandler);

module.exports = app;
