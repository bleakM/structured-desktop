import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBounds } from '../src/main/window-state';

test('clamps a window to the display work area', () => {
  assert.deepEqual(clampBounds({ x: -100, y: 700, width: 900, height: 500 }, { x: 0, y: 0, width: 800, height: 600 }), {
    x: 0, y: 100, width: 800, height: 500
  });
});

test('keeps a valid window unchanged', () => {
  assert.deepEqual(clampBounds({ x: 20, y: 30, width: 400, height: 300 }, { x: 0, y: 0, width: 800, height: 600 }), {
    x: 20, y: 30, width: 400, height: 300
  });
});
