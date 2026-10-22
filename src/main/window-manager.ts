import { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, screen, session, WebContentsView } from 'electron';
import { AppSettingsPatch, SettingsStore } from './settings';
import { calculateStartupBounds, clampBounds, listDisplays } from './window-state';
import { AppSettings, StartupPage } from './types';
import { StructuredUiAdapter } from './structured/ui-adapter';
import { setAutoStart } from './platform/autostart';
import { detectWindowEnvironment } from './platform/environment';

const STRUCTURED_URL = 'https://web.structured.app/';
const SESSION_PARTITION = 'persist:structured-cloud';

export class WindowManager {
  private window?: BrowserWindow;
  private webView?: WebContentsView;
  private localView?: WebContentsView;
  private settingsView?: WebContentsView;
  private ready = false;
  private currentPage: StartupPage;

  constructor(private readonly store: SettingsStore) { this.currentPage = store.get().startupPage; }

  getWindow(): BrowserWindow | undefined { return this.window; }
  getPage(): StartupPage { return this.currentPage; }
  getSettings(): AppSettings { return this.store.get(); }
  getDisplays() { return listDisplays(); }

  async create(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const settings = this.store.get();
    const bounds = calculateStartupBounds(settings);
    const options: BrowserWindowConstructorOptions = {
      ...bounds,
      show: false,
      title: 'Structured Desktop',
      frame: settings.window.mode === 'normal',
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      skipTaskbar: settings.window.mode === 'widget',
      backgroundColor: '#f7f7fb',
      webPreferences: {
        partition: SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        webviewTag: false
      }
    };
    this.window = new BrowserWindow(options);
    this.window.setMenuBarVisibility(false);
    this.window.on('resize', () => { this.layout(); this.persistLastBounds(); });
    this.window.on('move', () => this.persistLastBounds());
    this.window.on('close', () => { void this.persistLastBounds(); });
    this.window.on('closed', () => { this.disposeViews(); this.window = undefined; });
    await this.attachStructuredView();
    await this.attachLocalView();
    this.window.show();
    this.window.focus();
    return this.window;
  }

  private async attachStructuredView(): Promise<void> {
    if (!this.window) return;
    const ses = session.fromPartition(SESSION_PARTITION);
    this.webView = new WebContentsView({ webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }});
    this.window.contentView.addChildView(this.webView);
    this.webView.webContents.on('did-finish-load', () => {
      this.ready = true;
      void this.navigate(this.currentPage).catch(() => undefined);
    });
    this.webView.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://web.structured.app/')) return { action: 'allow' };
      return { action: 'deny' };
    });
    this.webView.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('https://web.structured.app/')) event.preventDefault();
    });
    await this.webView.webContents.loadURL(STRUCTURED_URL);
  }

  private async attachLocalView(): Promise<void> {
    if (!this.window) return;
    this.localView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: require('node:path').join(__dirname, '../preload/shell.js') }});
    this.window.contentView.addChildView(this.localView);
    await this.localView.webContents.loadFile(require('node:path').join(__dirname, '../renderer/shell.html'));
    this.localView.webContents.on('did-finish-load', () => {
      void this.sendShellState();
    });
  }

  async handleLocalMessage(channel: string, args: unknown[]): Promise<void> {
    if (channel === 'shell-navigate') await this.navigate(args[0] as StartupPage);
    if (channel === 'shell-settings') await this.openSettings();
    if (channel === 'shell-refresh') await this.webView?.webContents.reload();
    if (channel === 'shell-quit') await this.quit();
    if (channel === 'settings-save') await this.saveSettings(args[0] as AppSettingsPatch);
    if (channel === 'settings-close') await this.closeSettings();
    if (channel === 'settings-reset-window') await this.resetWindow();
  }

  private async sendShellState(): Promise<void> {
    if (!this.localView) return;
    const settings = this.store.get();
    await this.localView.webContents.send('shell-state', { mode: settings.window.mode, page: this.currentPage, settings, displays: this.getDisplays() });
  }

  async navigate(page: StartupPage): Promise<void> {
    this.currentPage = page;
    if (this.ready && this.webView) await new StructuredUiAdapter(this.webView.webContents).navigate(page);
    await this.sendShellState();
  }

  private layout(): void {
    if (!this.window) return;
    const [width, height] = this.window.getContentSize();
    const settings = this.store.get();
    const toolbarHeight = settings.window.mode === 'normal' ? 54 : 42;
    this.webView?.setBounds({ x: 0, y: toolbarHeight, width, height: Math.max(1, height - toolbarHeight) });
    this.localView?.setBounds({ x: 0, y: 0, width, height: toolbarHeight });
    this.settingsView?.setBounds({ x: Math.max(16, width - Math.min(520, width - 32)), y: 16, width: Math.min(504, width - 32), height: Math.min(height - 32, 720) });
  }

  private persistLastBounds(): void {
    if (!this.window || this.window.isMinimized() || this.window.isMaximized()) return;
    const bounds = this.window.getBounds();
    void this.store.update({ window: { lastX: bounds.x, lastY: bounds.y, lastWidth: bounds.width, lastHeight: bounds.height } });
  }

  async saveSettings(partial: AppSettingsPatch): Promise<void> {
    const old = this.store.get();
    const next = await this.store.update(partial);
    await setAutoStart(next.autoStart);
    if (old.window.mode !== next.window.mode) {
      await this.rebuildForMode(next.window.mode);
      return;
    }
    if (old.window.width !== next.window.width || old.window.height !== next.window.height || old.window.positionMode !== next.window.positionMode || old.window.displayId !== next.window.displayId || old.window.x !== next.window.x || old.window.y !== next.window.y) {
      this.window?.setBounds(calculateStartupBounds(next));
    }
    this.layout();
    await this.sendShellState();
  }

  private async rebuildForMode(_mode: AppSettings['window']['mode']): Promise<void> {
    const oldWindow = this.window;
    if (!oldWindow) return;
    const currentPage = this.currentPage;
    this.disposeViews();
    oldWindow.destroy();
    this.window = undefined;
    this.ready = false;
    this.currentPage = currentPage;
    await this.create();
  }

  async resetWindow(): Promise<void> {
    await this.store.update({ window: { positionMode: 'center', displayId: undefined, x: undefined, y: undefined, lastX: undefined, lastY: undefined, lastWidth: undefined, lastHeight: undefined } });
    this.window?.setBounds(calculateStartupBounds(this.store.get()));
    await this.sendShellState();
  }

  async openSettings(): Promise<void> {
    if (!this.window) return;
    if (!this.settingsView) {
      this.settingsView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: require('node:path').join(__dirname, '../preload/settings.js') }});
      this.window.contentView.addChildView(this.settingsView);
      await this.settingsView.webContents.loadFile(require('node:path').join(__dirname, '../renderer/settings.html'));
    }
    this.settingsView.setBackgroundColor('#ffffff');
    this.settingsView.setBounds({ x: 16, y: 16, width: Math.min(504, this.window.getBounds().width - 32), height: Math.min(this.window.getBounds().height - 32, 720) });
    await this.settingsView.webContents.send('settings-state', { settings: this.store.get(), displays: this.getDisplays(), environment: detectWindowEnvironment() });
  }

  private async closeSettings(): Promise<void> {
    if (!this.settingsView) return;
    this.window?.contentView.removeChildView(this.settingsView);
    this.settingsView.webContents.close();
    this.settingsView = undefined;
  }

  private disposeViews(): void {
    for (const view of [this.webView, this.localView, this.settingsView]) {
      if (!view) continue;
      try { this.window?.contentView.removeChildView(view); } catch { /* window is closing */ }
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.webView = undefined; this.localView = undefined; this.settingsView = undefined;
  }

  async quit(): Promise<void> {
    this.persistLastBounds();
    await this.store.save();
    this.disposeViews();
    this.window?.destroy();
    this.window = undefined;
  }
}
