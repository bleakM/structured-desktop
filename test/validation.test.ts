import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWindowSize } from '../src/main/validation';

test('accepts valid DIP sizes', () => {
  assert.deepEqual(validateWindowSize(450, 750), { ok: true, width: 450, height: 750 });
});

test('rejects zero, negative, fractional and oversized values', () => {
  for (const [width, height] of [[0, 500], [-1, 500], [450.5, 750], [4000, 750], [450, 2200]]) {
    assert.equal(validateWindowSize(width, height).ok, false);
  }
});

test('rejects NaN and empty input', () => {
  assert.equal(validateWindowSize(Number.NaN, 500).ok, false);
  assert.equal(validateWindowSize('', 500).ok, false);
});
