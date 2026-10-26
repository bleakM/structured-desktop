import test from 'node:test';
import assert from 'node:assert/strict';
import { AppSettings } from '../src/main/types';
import { calculateStartupBoundsOnDisplay, clampBounds } from '../src/main/window-state';

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

test('restores the last window bounds relative to the display containing the saved position', () => {
  const settings: AppSettings = {
    autoStart: false,
    startupPage: 'inbox',
    window: {
      mode: 'widget', width: 411, height: 687, positionMode: 'last', displayId: 'old-display',
      lastX: 1291, lastY: 68, lastWidth: 411, lastHeight: 688
    }
  };
  assert.deepEqual(calculateStartupBoundsOnDisplay(settings, {
    workArea: { x: 1000, y: 0, width: 1200, height: 900 }
  }), { x: 1291, y: 68, width: 411, height: 688 });
});
