const express = require('express');
const cookieParser = require('cookie-parser');

// Application modules (may be stubbed elsewhere)
const auth = require('./auth');
const routes = require('./routes');
const store = require('./store'); // Ensure store is initialized if needed

// Initialize Express app
const app = express();

// Middleware configuration
app.use(express.json()); // Parse JSON bodies
app.use(cookieParser()); // Parse cookies

// Register authentication routes (expects router export)
if (auth && auth.router) {
  app.use('/auth', auth.router);
} else if (typeof auth === 'function') {
  // Fallback: auth may be a middleware function
  app.use('/auth', auth);
}

// Register main application routes
if (routes && routes.router) {
  app.use('/', routes.router);
} else if (typeof routes === 'function') {
  app.use('/', routes);
}

// Default health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Start the server when this file is executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app };
