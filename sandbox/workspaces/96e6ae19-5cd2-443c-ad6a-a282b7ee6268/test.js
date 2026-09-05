const http = require('http');
const assert = require('assert');
const server = require('./server');

// Helper to perform HTTP GET request
function httpGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: process.env.PORT || 3000,
      path,
      method: 'GET',
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  // Ensure server is listening before test
  await new Promise((r) => setTimeout(r, 500));

  try {
    const response = await httpGet('/hello');
    assert.strictEqual(response.statusCode, 200, 'Expected status 200');
    const parsed = JSON.parse(response.body);
    assert.deepStrictEqual(parsed, { message: 'Hello, world!' }, 'Response body mismatch');
    console.log('✅ Test passed: /hello endpoint returns expected JSON');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  } finally {
    server.close();
  }
})();