export type WindowMode = 'normal' | 'widget';
export type StartupPage = 'timeline' | 'inbox';
export type PositionMode = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'custom' | 'last';

export interface WindowSettings {
  mode: WindowMode;
  width: number;
  height: number;
  displayId?: string;
  positionMode: PositionMode;
  x?: number;
  y?: number;
  lastX?: number;
  lastY?: number;
  lastWidth?: number;
  lastHeight?: number;
}

export interface AppSettings {
  autoStart: boolean;
  startupPage: StartupPage;
  window: WindowSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: false,
  startupPage: 'timeline',
  window: {
    mode: 'normal',
    width: 1180,
    height: 800,
    positionMode: 'center'
  }
};

export interface DisplayInfo {
  id: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface WindowEnvironment {
  sessionType: string;
  ozonePlatform: string;
  hasX11: boolean;
  hasWayland: boolean;
  precisePositioning: boolean;
  skipTaskbarSupport: 'electron-api' | 'window-manager-dependent' | 'unsupported';
  explanation: string;
}
