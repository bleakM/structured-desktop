import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, session } from 'electron';
import log from 'electron-log';
import { join } from 'node:path';
import { SettingsStore } from './settings';
import { WindowManager } from './window-manager';
import { configureOzoneForEnvironment, detectWindowEnvironment } from './platform/environment';

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  void main();
}

async function main(): Promise<void> {
  configureOzoneForEnvironment();
  log.initialize();
  app.setAppUserModelId('app.structured.desktop');
  app.on('second-instance', () => { void manager?.showMainWindow(); });
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'notifications'));
  const store = new SettingsStore();
  await store.load();
  manager = new WindowManager(store);
  for (const channel of ['shell-navigate', 'shell-settings', 'shell-refresh', 'shell-quit', 'settings-save', 'settings-close', 'settings-reset-window', 'settings-use-current-size', 'widget-hover', 'widget-expand', 'widget-collapse', 'widget-drag-start', 'widget-drag-move', 'widget-drag-end']) {
    ipcMain.on(channel, (_event, ...args) => {
      if (channel === 'shell-quit') void manager?.quit().finally(() => app.quit());
      else void manager?.handleLocalMessage(channel, args);
    });
  }
  await manager.create();
  createTray();
  app.on('activate', () => void manager?.create());
  let shutdownStarted = false;
  app.on('before-quit', (event) => {
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    void manager?.quit().finally(() => app.quit());
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

let manager: WindowManager | undefined;
let tray: Tray | undefined;

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Structured Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: () => { void manager?.showMainWindow(); } },
    { label: 'Timeline', click: () => void manager?.navigate('timeline') },
    { label: 'Inbox', click: () => void manager?.navigate('inbox') },
    { label: '设置', click: () => { void manager?.openSettings(); } },
    { type: 'separator' },
    { label: '退出应用', click: () => { void manager?.quit().finally(() => app.quit()); } }
  ]));
}

ipcMain.handle('get-environment', () => detectWindowEnvironment());
