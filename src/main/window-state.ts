import { Display, Rectangle, screen } from 'electron';
import { AppSettings, DisplayInfo, PositionMode } from './types';

export const WIDGET_ORB_SIZE = 56;
export const WIDGET_ORB_VISIBLE = WIDGET_ORB_SIZE / 2;

export function listDisplays(): DisplayInfo[] {
  return screen.getAllDisplays().map((display) => ({
    id: String(display.id),
    label: display.id === screen.getPrimaryDisplay().id ? '主显示器' : `显示器 ${display.id}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor
  }));
}

function validNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

export function clampBounds(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width));
  const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function calculateCollapsedWidgetBounds(workArea: Rectangle, edge: 'left' | 'right', y: number): Rectangle {
  const size = Math.min(WIDGET_ORB_SIZE, workArea.width, workArea.height);
  const x = edge === 'left'
    ? workArea.x - size / 2
    : workArea.x + workArea.width - size / 2;
  const top = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - size));
  return { x: Math.round(x), y: Math.round(top), width: size, height: size };
}

export function calculateVisibleWidgetBounds(workArea: Rectangle, edge: 'left' | 'right', y: number): Rectangle {
  const size = Math.min(WIDGET_ORB_SIZE, workArea.width, workArea.height);
  const x = edge === 'left' ? workArea.x : workArea.x + workArea.width - size;
  const top = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - size));
  return { x: Math.round(x), y: Math.round(top), width: size, height: size };
}

export function calculateWidgetShape(scaleFactor = 1): Rectangle[] {
  const size = WIDGET_ORB_SIZE;
  const step = 1 / Math.max(1, scaleFactor);
  const circleCenterY = size / 2;
  const circleRadius = size / 2;
  const circleCenterX = size / 2;
  const rects: Rectangle[] = [];

  for (let y = 0; y < size; y += step) {
    const dy = y + step / 2 - circleCenterY;
    const halfWidth = Math.sqrt(Math.max(0, circleRadius ** 2 - dy ** 2));
    const left = Math.max(0, Math.ceil((circleCenterX - halfWidth) / step - 0.5) * step);
    const right = Math.min(size, Math.ceil((circleCenterX + halfWidth) / step - 0.5) * step);
    if (right <= left) continue;

    const previous = rects[rects.length - 1];
    if (previous && previous.x === left && previous.width === right - left && previous.y + previous.height === y) {
      previous.height += step;
    } else {
      rects.push({ x: left, y, width: right - left, height: step });
    }
  }
  return rects;
}

export function calculateExpandedWidgetBounds(workArea: Rectangle, edge: 'left' | 'right', orbY: number, width: number, height: number): Rectangle {
  const x = edge === 'left' ? workArea.x : workArea.x + workArea.width - width;
  const y = orbY + Math.round((WIDGET_ORB_SIZE - height) / 2);
  return clampBounds({ x, y, width, height }, workArea);
}

export function getDisplayForSettings(settings: AppSettings): Display {
  const displays = screen.getAllDisplays();
  return displays.find((display) => String(display.id) === settings.window.displayId) ?? screen.getPrimaryDisplay();
}

export function calculateStartupBoundsOnDisplay(settings: AppSettings, display: Pick<Display, 'workArea'>): Rectangle {
  const area = display.workArea;
  const width = Math.round(settings.window.width);
  const height = Math.round(settings.window.height);
  const mode: PositionMode = settings.window.positionMode;
  let x = area.x + Math.round((area.width - width) / 2);
  let y = area.y + Math.round((area.height - height) / 2);
  if (mode === 'top-left') { x = area.x; y = area.y; }
  if (mode === 'top-right') { x = area.x + area.width - width; y = area.y; }
  if (mode === 'bottom-left') { x = area.x; y = area.y + area.height - height; }
  if (mode === 'bottom-right') { x = area.x + area.width - width; y = area.y + area.height - height; }
  if (mode === 'custom' && validNumber(settings.window.x) && validNumber(settings.window.y)) { x = settings.window.x; y = settings.window.y; }
  if (mode === 'last' && validNumber(settings.window.lastX) && validNumber(settings.window.lastY)) { x = settings.window.lastX; y = settings.window.lastY; }
  return clampBounds({ x, y, width, height }, area);
}

export function calculateStartupBounds(settings: AppSettings): Rectangle {
  const { positionMode, lastX, lastY, width, height } = settings.window;
  const hasLastPosition = positionMode === 'last' && validNumber(lastX) && validNumber(lastY);
  const display = hasLastPosition
    ? screen.getDisplayMatching({
      x: lastX,
      y: lastY,
      width,
      height
    })
    : getDisplayForSettings(settings);
  return calculateStartupBoundsOnDisplay(settings, display);
}
