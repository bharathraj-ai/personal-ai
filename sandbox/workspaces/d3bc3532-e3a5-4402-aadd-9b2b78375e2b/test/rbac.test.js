const request = require('supertest');
const app = require('../src/app'); // Express app
const { createRole, assignRoleToUser, checkPermission, clearAll } = require('../src/rbac');

describe('RBAC integration tests', () => {
  let server;

  beforeAll(async () => {
    server = app.listen();
    await clearAll();
    await createRole('admin', ['read:any', 'write:any']);
    await createRole('user', ['read:own']);
    await assignRoleToUser('testuser', 'admin');
  });

  afterAll(async () => {
    await clearAll();
    server.close();
  });

  test('admin can access protected route', async () => {
    const res = await request(server)
      .get('/protected')
      .set('x-user', 'testuser');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('access granted');
  });

  test('direct permission checks work', async () => {
    const canWrite = await checkPermission('testuser', 'write:any');
    expect(canWrite).toBe(true);
    const canDelete = await checkPermission('testuser', 'delete:any');
    expect(canDelete).toBe(false);
  });
});