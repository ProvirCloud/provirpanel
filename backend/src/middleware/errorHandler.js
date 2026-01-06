'use strict';

module.exports = (err, req, res, next) => {
  // Basic error handler; expand with logging as needed.
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Internal server error'
  });
};
