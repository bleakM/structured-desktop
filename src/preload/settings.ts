import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('structuredSettings', {
  send: (channel: string, ...args: unknown[]) => {
    const allowed = ['settings-save', 'settings-close', 'settings-reset-window', 'shell-navigate', 'shell-refresh', 'shell-quit'];
    if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
  },
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on('settings-state', (_event, state) => callback(state));
  }
});
