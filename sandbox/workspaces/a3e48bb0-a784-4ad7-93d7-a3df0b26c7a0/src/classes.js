import { Pool } from 'pg';

// Create a connection pool using environment variables (PGHOST, PGUSER, PGDATABASE, PGPASSWORD, PGPORT)
const pool = new Pool();

/**
 * Handler to retrieve all classes from the database and return them as JSON.
 * Expected to be used with the Node.js http module: (req, res) => {}
 */
export async function getClasses(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM classes ORDER BY id');
    const payload = JSON.stringify(rows);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(payload);
  } catch (err) {
    console.error('Error fetching classes:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
}

/**
 * Handler to retrieve all classes and render them as a simple HTML page.
 * Expected to be used with the Node.js http module.
 */
export async function renderClassList(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM classes ORDER BY id');
    const listItems = rows
      .map(
        (cls) =>
          `<li>${cls.id}: ${escapeHtml(cls.name || 'Unnamed Class')}</li>`
      )
      .join('');
    const html = `<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\" />
  <title>Class List</title>
</head>
<body>
  <h1>Class List</h1>
  <ul>${listItems}</ul>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (err) {
    console.error('Error rendering class list:', err);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h1>Internal Server Error</h1>');
  }
}

/**
 * Simple HTML escaping to avoid injection when rendering class names.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
