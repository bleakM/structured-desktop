import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppSettings, DEFAULT_SETTINGS, PositionMode, StartupPage, WindowMode } from './types';

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitize(raw: unknown): AppSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const window = (value.window && typeof value.window === 'object' ? value.window : {}) as Record<string, unknown>;
  const mode: WindowMode = window.mode === 'widget' ? 'widget' : 'normal';
  const positionMode: PositionMode = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'custom', 'last'].includes(String(window.positionMode))
    ? String(window.positionMode) as PositionMode : 'center';
  const startupPage: StartupPage = value.startupPage === 'inbox' ? 'inbox' : 'timeline';
  const result: AppSettings = {
    autoStart: value.autoStart === true,
    startupPage,
    window: {
      mode,
      width: numberOr(window.width, DEFAULT_SETTINGS.window.width),
      height: numberOr(window.height, DEFAULT_SETTINGS.window.height),
      positionMode,
      displayId: typeof window.displayId === 'string' ? window.displayId : undefined,
      x: numberOr(window.x, Number.NaN),
      y: numberOr(window.y, Number.NaN),
      lastX: numberOr(window.lastX, Number.NaN),
      lastY: numberOr(window.lastY, Number.NaN),
      lastWidth: numberOr(window.lastWidth, Number.NaN),
      lastHeight: numberOr(window.lastHeight, Number.NaN)
    }
  };
  const normalized = normalizeSize(result.window.width, result.window.height);
  result.window.width = normalized.width;
  result.window.height = normalized.height;
  return result;
}

export function normalizeSize(width: number, height: number): { width: number; height: number } {
  const finiteWidth = Number.isFinite(width) ? Math.round(width) : DEFAULT_SETTINGS.window.width;
  const finiteHeight = Number.isFinite(height) ? Math.round(height) : DEFAULT_SETTINGS.window.height;
  return { width: Math.min(3840, Math.max(320, finiteWidth)), height: Math.min(2160, Math.max(240, finiteHeight)) };
}

function stripNaN(settings: AppSettings): AppSettings {
  const copy = JSON.parse(JSON.stringify(settings)) as AppSettings;
  for (const key of ['x', 'y', 'lastX', 'lastY', 'lastWidth', 'lastHeight'] as const) {
    if (typeof copy.window[key] === 'number' && !Number.isFinite(copy.window[key])) delete copy.window[key];
  }
  return copy;
}

export class SettingsStore {
  private current: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private readonly path: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.path = join(app.getPath('userData'), 'settings.json');
  }

  async load(): Promise<AppSettings> {
    try {
      this.current = sanitize(JSON.parse(await readFile(this.path, 'utf8')));
    } catch {
      this.current = structuredClone(DEFAULT_SETTINGS);
    }
    return structuredClone(this.current);
  }

  get(): AppSettings { return structuredClone(this.current); }

  async update(partial: AppSettingsPatch): Promise<AppSettings> {
    const merged = {
      ...this.current,
      ...partial,
      window: { ...this.current.window, ...(partial.window ?? {}) }
    } as AppSettings;
    this.current = sanitize(merged);
    await this.save();
    return this.get();
  }

  async save(): Promise<void> {
    const snapshot = stripNaN(this.current);
    this.writeQueue = this.writeQueue.then(async () => {
      const target = this.path;
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      await rename(temporary, target);
    });
    await this.writeQueue;
  }

  getPath(): string { return this.path; }
}

export type AppSettingsPatch = Omit<Partial<AppSettings>, 'window'> & { window?: Partial<AppSettings['window']> };
