import test from 'node:test';
import assert from 'node:assert/strict';
import { AppSettings } from '../src/main/types';
import { calculateCollapsedWidgetBounds, calculateExpandedWidgetBounds, calculateStartupBoundsOnDisplay, calculateWidgetShape, clampBounds, WIDGET_ORB_SIZE, WIDGET_ORB_VISIBLE } from '../src/main/window-state';

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

test('keeps the widget window on screen and clips only a small part of the orb', () => {
  const workArea = { x: 0, y: 27, width: 1704, height: 1038 };
  assert.deepEqual(calculateCollapsedWidgetBounds(workArea, 'left', 500), { x: 0, y: 500, width: 56, height: 56 });
  assert.deepEqual(calculateCollapsedWidgetBounds(workArea, 'right', 500), { x: 1648, y: 500, width: 56, height: 56 });
  const leftShape = calculateWidgetShape('left');
  const rightShape = calculateWidgetShape('right');
  const halfSize = WIDGET_ORB_SIZE - WIDGET_ORB_VISIBLE;
  assert.ok(leftShape.every(({ x, width }) => x >= 0 && x + width <= WIDGET_ORB_VISIBLE));
  assert.ok(rightShape.every(({ x, width }) => x >= halfSize && x + width <= WIDGET_ORB_SIZE));
  assert.ok(leftShape.some(({ x, y, width, height }) => x === 0 && y <= 27 && y + height >= 28 && width === WIDGET_ORB_VISIBLE));
  assert.ok(rightShape.some(({ x, y, width, height }) => x === halfSize && y <= 27 && y + height >= 28 && width === WIDGET_ORB_VISIBLE));
});

test('reveals the orb fully and anchors the expanded window to its dock edge', () => {
  const workArea = { x: 0, y: 27, width: 1704, height: 1038 };
  const fullShape = calculateWidgetShape('right', true);
  assert.ok(fullShape.every(({ x, y, width, height }) => x >= 0 && x + width <= 56 && y >= 0 && y + height <= 56));
  assert.ok(fullShape.some(({ width }) => width === 56));
  assert.deepEqual(calculateCollapsedWidgetBounds(workArea, 'right', 500), { x: 1648, y: 500, width: 56, height: 56 });
  assert.deepEqual(calculateExpandedWidgetBounds(workArea, 'right', 500, 411, 687), { x: 1293, y: 185, width: 411, height: 687 });
  assert.deepEqual(calculateExpandedWidgetBounds(workArea, 'left', 500, 411, 687), { x: 0, y: 185, width: 411, height: 687 });
});
