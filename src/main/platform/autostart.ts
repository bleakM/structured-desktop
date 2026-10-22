import { app } from 'electron';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const desktopFileName = 'structured-desktop.desktop';

export async function setAutoStart(enabled: boolean): Promise<void> {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--autostart'] });
    return;
  }
  if (process.platform !== 'linux') return;
  const dir = join(app.getPath('home'), '.config', 'autostart');
  const path = join(dir, desktopFileName);
  if (!enabled) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const execPath = process.execPath.replaceAll('"', '\\"');
  const appPath = app.getAppPath().replaceAll('"', '\\"');
  await writeFile(path, `[Desktop Entry]\nType=Application\nName=Structured Desktop\nComment=Open Structured in a desktop window\nExec="${execPath}" "${appPath}" --autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o600 });
}

export function getAutoStart(): boolean {
  if (process.platform === 'win32') return app.getLoginItemSettings().openAtLogin;
  return false;
}
