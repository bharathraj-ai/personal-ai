const http = require('http');
const { authenticate } = require('./auth');

/**
 * Create an HTTP server with a simple authentication check.
 * The request handler expects `authenticate` to follow the signature
 * `(req, res) => boolean` where a true return value means the request is
 * authorized. If unauthorized, a 401 response is sent.
 *
 * @returns {http.Server}
 */
function createServer() {
  const server = http.createServer((req, res) => {
    try {
      // Simple auth check – if authenticate throws or returns falsy, reject.
      const authorized = authenticate(req, res);
      if (!authorized) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    } catch (err) {
      // If auth throws, treat as unauthorized.
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // If we reach here, the request is authorized.
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'OK' }));
  });

  return server;
}

/**
 * Start the provided server on the given port.
 * Returns a Promise that resolves when the server is listening.
 *
 * @param {http.Server} server
 * @param {number} port
 * @returns {Promise<void>}
 */
function startServer(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.listen(port, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Stop the provided server.
 * Returns a Promise that resolves when the server is fully closed.
 *
 * @param {http.Server} server
 * @returns {Promise<void>}
 */
function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = { createServer, startServer, stopServer };