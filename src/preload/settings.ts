import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('structuredSettings', {
  send: (channel: string, ...args: unknown[]) => {
    const allowed = ['settings-save', 'settings-close', 'settings-reset-window', 'settings-use-current-size', 'shell-navigate', 'shell-refresh', 'shell-quit'];
    if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
  },
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on('settings-state', (_event, state) => callback(state));
  },
  onCurrentSize: (callback: (size: { width: number; height: number }) => void) => {
    ipcRenderer.on('settings-current-size', (_event, size) => callback(size));
  }
});
