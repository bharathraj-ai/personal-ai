const express = require('express');
const auth = require('./auth');

// Initialize Express application
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Apply authentication middleware to all routes (you can adjust as needed)
app.use(auth);

// Example protected route (optional placeholder)
app.get('/protected', (req, res) => {
  // Assuming auth middleware attaches a user object to req
  if (req.user) {
    res.json({ message: 'Access granted', user: req.user });
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

module.exports = { app };
