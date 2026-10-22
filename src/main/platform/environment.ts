import { app } from 'electron';
import { WindowEnvironment } from '../types';

export function detectWindowEnvironment(): WindowEnvironment {
  const sessionType = process.env.XDG_SESSION_TYPE ?? 'unknown';
  const hasWayland = Boolean(process.env.WAYLAND_DISPLAY);
  const hasX11 = Boolean(process.env.DISPLAY);
  const ozonePlatform = process.env.ELECTRON_OZONE_PLATFORM_HINT ?? (hasWayland && !hasX11 ? 'wayland' : hasX11 ? 'x11-or-xwayland' : 'unknown');
  const nativeWayland = hasWayland && !hasX11 && ozonePlatform === 'wayland';
  if (process.platform === 'win32') {
    return { sessionType: 'windows', ozonePlatform: 'win32', hasX11: false, hasWayland: false, precisePositioning: true, skipTaskbarSupport: 'electron-api', explanation: 'Windows uses Electron bounds and skipTaskbar APIs.' };
  }
  if (nativeWayland) {
    return { sessionType, ozonePlatform, hasX11, hasWayland, precisePositioning: false, skipTaskbarSupport: 'window-manager-dependent', explanation: 'Native Wayland may reject application-controlled global positions and taskbar hints. The app preserves requested values and lets the compositor manage placement.' };
  }
  if (hasX11) {
    return { sessionType, ozonePlatform, hasX11, hasWayland, precisePositioning: true, skipTaskbarSupport: 'window-manager-dependent', explanation: 'X11/XWayland supports Electron positioning. Skip-taskbar behavior depends on the window manager.' };
  }
  return { sessionType, ozonePlatform, hasX11, hasWayland, precisePositioning: false, skipTaskbarSupport: 'unsupported', explanation: 'The current display server did not expose a positioning API that Electron can verify.' };
}

export function configureOzoneForEnvironment(): void {
  // Do not change a user's desktop session automatically. Users can start the app
  // with --ozone-platform=x11 when exact placement is needed on a Wayland desktop.
  if (process.platform === 'linux' && app.commandLine.hasSwitch('ozone-platform')) return;
}
