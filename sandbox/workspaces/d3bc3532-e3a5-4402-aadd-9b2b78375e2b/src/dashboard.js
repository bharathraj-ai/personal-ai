const express = require('express');
const db = require('../database');

// Create a router for role‑specific dashboards
const router = express.Router();

/**
 * GET /:role
 * Returns dashboard data for the specified role.
 * Expected role values are defined by the application (e.g., 'admin', 'user', 'manager').
 */
router.get('/:role', async (req, res) => {
  const { role } = req.params;
  try {
    // Example query – adjust to your actual schema
    const data = await db.query('SELECT * FROM dashboards WHERE role = $1', [role]);
    if (data.rowCount === 0) {
      return res.status(404).json({ error: 'Dashboard not found for role: ' + role });
    }
    res.json(data.rows[0]);
  } catch (err) {
    console.error('Error fetching dashboard for role', role, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
