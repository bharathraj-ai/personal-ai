const express = require('express');
const { authenticate } = require('./auth');

// Create Express application
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Example protected route
app.get('/protected', authenticate, (req, res) => {
  // At this point, req.user is set by the authenticate middleware
  res.json({ message: `Hello, ${req.user.username}!` });
});

// Example public route
app.get('/public', (req, res) => {
  res.json({ message: 'This is a public endpoint.' });
});

// Export the configured app for use in other modules or tests
module.exports = { app };
