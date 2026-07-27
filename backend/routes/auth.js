const { registerAuthRoutes } = require('../middleware/auth');

module.exports = function(app, deps) {
  registerAuthRoutes(app);
};