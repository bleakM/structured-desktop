import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('structuredShell', {
  send: (channel: string, ...args: unknown[]) => {
    const allowed = ['shell-navigate', 'shell-settings', 'shell-refresh', 'shell-quit'];
    if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
  },
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on('shell-state', (_event, state) => callback(state));
  }
});
