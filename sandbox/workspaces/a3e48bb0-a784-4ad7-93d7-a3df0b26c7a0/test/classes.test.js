import { describe, test } from 'node:test';
import assert from 'node:assert';
import Classes from '../src/classes.js';

describe('Classes module', () => {
  test('should be a class or constructor function', () => {
    assert.strictEqual(typeof Classes, 'function');
  });
});
