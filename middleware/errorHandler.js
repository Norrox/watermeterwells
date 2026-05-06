function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err.message || err);
  res.status(err.status || 500).json({
    error: err.message || 'Internt serverfel'
  });
}

module.exports = errorHandler;
