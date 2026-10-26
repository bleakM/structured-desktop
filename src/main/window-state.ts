import { Display, Rectangle, screen } from 'electron';
import { AppSettings, DisplayInfo, PositionMode } from './types';

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
  const savedWidth = mode === 'last' && validNumber(settings.window.lastWidth) ? settings.window.lastWidth : width;
  const savedHeight = mode === 'last' && validNumber(settings.window.lastHeight) ? settings.window.lastHeight : height;
  return clampBounds({ x, y, width: savedWidth, height: savedHeight }, area);
}

export function calculateStartupBounds(settings: AppSettings): Rectangle {
  const { positionMode, lastX, lastY, lastWidth, lastHeight, width, height } = settings.window;
  const hasLastPosition = positionMode === 'last' && validNumber(lastX) && validNumber(lastY);
  const display = hasLastPosition
    ? screen.getDisplayMatching({
      x: lastX,
      y: lastY,
      width: validNumber(lastWidth) ? lastWidth : width,
      height: validNumber(lastHeight) ? lastHeight : height
    })
    : getDisplayForSettings(settings);
  return calculateStartupBoundsOnDisplay(settings, display);
}
