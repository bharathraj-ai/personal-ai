const http = require('http');

const PORT = process.env.PORT || 3000;

const requestListener = (req, res) => {
  if (req.method === 'GET' && req.url === '/hello') {
    const responseBody = { message: 'Hello, world!' };
    const payload = JSON.stringify(responseBody);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
};

const server = http.createServer(requestListener);

server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

module.exports = server; // Export for testing purposes
