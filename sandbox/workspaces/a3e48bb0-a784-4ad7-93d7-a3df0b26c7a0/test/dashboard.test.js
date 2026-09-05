import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { dashboardHandler } from '../src/dashboard.js';

// Helper to perform a GET request with a specific role header
function requestDashboard(port, role) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/dashboard',
        method: 'GET',
        headers: {
          'x-user-role': role
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            resolve({ statusCode: res.statusCode, body: json });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('role-specific dashboards return correct data', async (t) => {
  // Start a temporary HTTP server using the dashboard handler
  const server = http.createServer(dashboardHandler);
  await new Promise((res) => server.listen(0, res)); // listen on random free port
  const { port } = server.address();

  // Ensure server is closed after tests
  t.after(() => new Promise((res) => server.close(res)));

  const roles = ['admin', 'user', 'guest'];

  for (const role of roles) {
    const { statusCode, body } = await requestDashboard(port, role);
    assert.strictEqual(statusCode, 200, `Expected 200 for role ${role}`);
    // The dashboard data shape is implementation‑specific; we assert that a "role" field matches the requested role.
    assert.strictEqual(body.role, role, `Dashboard role should be ${role}`);
  }
});