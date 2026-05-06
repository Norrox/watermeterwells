const apiRoutes = require('./api');
const adminRoutes = require('./admin');
const authRoutes = require('./auth');
const dashboardRoutes = require('./dashboard');

function registerRoutes(app) {
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', apiRoutes);
  app.use('/', dashboardRoutes);
}

module.exports = registerRoutes;
