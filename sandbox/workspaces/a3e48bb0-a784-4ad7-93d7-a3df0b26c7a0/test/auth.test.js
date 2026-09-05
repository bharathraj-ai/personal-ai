import { describe, test } from 'node:test';
import assert from 'node:assert';
import { login } from '../src/auth.js';

describe('Authentication', () => {
  test('login returns a token for valid credentials', async () => {
    const token = await login('validUser', 'validPassword');
    assert.ok(typeof token === 'string' && token.length > 0, 'Token should be a non‑empty string');
  });

  test('login throws on invalid credentials', async () => {
    await assert.rejects(
      async () => {
        await login('invalidUser', 'wrongPassword');
      },
      {
        name: 'Error',
        message: /invalid/i,
      },
      'Should reject with an error for invalid credentials'
    );
  });
});