module.exports = function(app, deps) {
  const { pool } = deps;

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'OK', message: 'Backend conectado a PostgreSQL' });
    } catch (error) {
      res.status(500).json({ status: 'ERROR', error: error.message });
    }
  });
};
