const express = require('express');
const bodyParser = require('body-parser');
const { verifyUser, generateToken, authenticate } = require('./auth');

const app = express();
app.use(bodyParser.json());

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await verifyUser(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = generateToken(user);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Example protected route
app.get('/profile', authenticate, (req, res) => {
  // authenticate middleware should attach user to req
  res.json({ user: req.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Auth server listening on port ${PORT}`);
});

module.exports = app;