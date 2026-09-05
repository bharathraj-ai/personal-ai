import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

/**
 * Creates a request handler for role‑specific dashboards.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool.
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void>}
 */
export function createDashboardHandler(pool) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const templatesDir = path.join(__dirname, 'templates');

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      // Expect authentication middleware to attach a user object.
      const user = req.user;
      if (!user?.role) {
        res.statusCode = 401;
        res.end('Unauthorized');
        return;
      }
      const role = user.role;

      // HTML dashboard
      if (pathname === '/dashboard') {
        const filePath = path.join(templatesDir, `${role}.html`);
        try {
          const html = await fs.readFile(filePath, 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch (e) {
          res.statusCode = 404;
          res.end('Dashboard not found');
        }
        return;
      }

      // JSON API endpoint
      if (pathname === '/api/dashboard') {
        const client = await pool.connect();
        try {
          const result = await client.query(
            'SELECT * FROM dashboard_data WHERE role = $1',
            [role]
          );
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(result.rows));
        } finally {
          client.release();
        }
        return;
      }

      // Not found
      res.statusCode = 404;
      res.end('Not Found');
    } catch (err) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  };
}
