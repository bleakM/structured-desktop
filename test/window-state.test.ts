import test from 'node:test';
import assert from 'node:assert/strict';
import { AppSettings } from '../src/main/types';
import { calculateCollapsedWidgetBounds, calculateExpandedWidgetBounds, calculateStartupBoundsOnDisplay, calculateVisibleWidgetBounds, calculateWidgetShape, clampBounds, WIDGET_ORB_SIZE } from '../src/main/window-state';

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

test('restores the last position and uses the configured startup size', () => {
  const settings: AppSettings = {
    autoStart: false,
    startupPage: 'inbox',
    window: {
      mode: 'widget', width: 411, height: 687, positionMode: 'last', displayId: 'old-display',
      lastX: 1291, lastY: 68, lastWidth: 206, lastHeight: 344
    }
  };
  assert.deepEqual(calculateStartupBoundsOnDisplay(settings, {
    workArea: { x: 1000, y: 0, width: 1200, height: 900 }
  }), { x: 1291, y: 68, width: 411, height: 687 });
});

test('moves half of the complete orb beyond the screen edge while collapsed', () => {
  const workArea = { x: 0, y: 27, width: 1704, height: 1038 };
  assert.deepEqual(calculateCollapsedWidgetBounds(workArea, 'left', 500), { x: -28, y: 500, width: 56, height: 56 });
  assert.deepEqual(calculateCollapsedWidgetBounds(workArea, 'right', 500), { x: 1676, y: 500, width: 56, height: 56 });
  assert.deepEqual(calculateVisibleWidgetBounds(workArea, 'left', 500), { x: 0, y: 500, width: 56, height: 56 });
  assert.deepEqual(calculateVisibleWidgetBounds(workArea, 'right', 500), { x: 1648, y: 500, width: 56, height: 56 });
  const shape = calculateWidgetShape();
  assert.ok(shape.every(({ x, width }) => x >= 0 && x + width <= WIDGET_ORB_SIZE));
  assert.ok(shape.some(({ x }) => x < WIDGET_ORB_SIZE / 2));
  assert.ok(shape.some(({ x, width }) => x + width > WIDGET_ORB_SIZE / 2));
  assert.ok(shape.some(({ width }) => width === WIDGET_ORB_SIZE));
});

test('reveals the orb fully and anchors the expanded window to its dock edge', () => {
  const workArea = { x: 0, y: 27, width: 1704, height: 1038 };
  const fullShape = calculateWidgetShape();
  assert.ok(fullShape.every(({ x, y, width, height }) => x >= 0 && x + width <= 56 && y >= 0 && y + height <= 56));
  assert.ok(fullShape.some(({ width }) => width === 56));
  assert.deepEqual(calculateVisibleWidgetBounds(workArea, 'right', 500), { x: 1648, y: 500, width: 56, height: 56 });
  assert.deepEqual(calculateExpandedWidgetBounds(workArea, 'right', 500, 411, 687), { x: 1293, y: 185, width: 411, height: 687 });
  assert.deepEqual(calculateExpandedWidgetBounds(workArea, 'left', 500, 411, 687), { x: 0, y: 185, width: 411, height: 687 });
});
