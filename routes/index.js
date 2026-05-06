const apiRoutes = require('./api');
const dashboardRoutes = require('./dashboard');

function registerRoutes(app) {
  app.use('/api', apiRoutes);
  app.use('/', dashboardRoutes);
}

module.exports = registerRoutes;
