const express = require('express');
const app = express();

app.get('/hello', (req, res) => {
  // Return the greeting message expected by the unit tests
  res.json({ message: 'Hello, world!' });
});

module.exports = app;
