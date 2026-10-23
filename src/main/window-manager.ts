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
  private structuredPageLoaded = false;
  private structuredPageActivated = false;
  private startupNavigationPending = true;
  private startupRecoveryAttempts = 0;
  private startupRetryTimer?: NodeJS.Timeout;
  private currentPage: StartupPage;
  private navigationQueue: Promise<void> = Promise.resolve();
  private navigationError?: string;

  constructor(private readonly store: SettingsStore) { this.currentPage = store.get().startupPage; }

  getWindow(): BrowserWindow | undefined { return this.window; }
  getPage(): StartupPage { return this.currentPage; }
  getSettings(): AppSettings { return this.store.get(); }
  getDisplays() { return listDisplays(); }

  async create(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.clearStartupRetry();
    this.startupNavigationPending = true;
    this.startupRecoveryAttempts = 0;
    const settings = this.store.get();
    const bounds = calculateStartupBounds(settings);
    const options: BrowserWindowConstructorOptions = {
      ...bounds,
      show: false,
      title: 'Structured Desktop',
      frame: settings.window.mode === 'normal',
      type: process.platform === 'linux' && settings.window.mode === 'widget' ? 'toolbar' : undefined,
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
    const window = new BrowserWindow(options);
    this.window = window;
    window.setMenuBarVisibility(false);
    window.on('resize', () => { this.layout(); this.persistLastBounds(); });
    window.on('move', () => this.persistLastBounds());
    window.on('close', () => { void this.persistLastBounds(); });
    window.on('closed', () => {
      if (this.window !== window) return;
      this.clearStartupRetry();
      this.disposeViews();
      this.window = undefined;
      this.ready = false;
    });
    await this.attachStructuredView();
    await this.attachLocalView();
    this.layout();
    window.show();
    // Mutter may ignore the constructor hint until the X11 window is mapped.
    // Apply it again after showing so Widget mode can leave the taskbar on
    // GNOME/X11 while keeping the window interactive.
    window.setSkipTaskbar(settings.window.mode === 'widget');
    window.focus();
    return window;
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
    this.webView.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      this.ready = false;
      this.structuredPageLoaded = false;
      this.structuredPageActivated = false;
      this.navigationError = undefined;
      void this.sendShellState();
    });
    this.webView.webContents.on('did-finish-load', () => {
      this.structuredPageLoaded = true;
      this.activateStructuredPage();
    });
    this.webView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      this.ready = false;
      this.structuredPageLoaded = false;
      this.structuredPageActivated = false;
      this.navigationError = `Structured 页面加载失败：${errorDescription}`;
      this.scheduleStartupRecovery();
      void this.sendShellState();
    });
    this.webView.webContents.on('render-process-gone', (_event, details) => {
      if (!this.startupNavigationPending) return;
      this.ready = false;
      this.structuredPageLoaded = false;
      this.structuredPageActivated = false;
      this.navigationError = `Structured 页面进程已退出：${details.reason}`;
      this.scheduleStartupRecovery();
      void this.sendShellState();
    });
    this.webView.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://web.structured.app/')) return { action: 'allow' };
      return { action: 'deny' };
    });
    this.webView.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('https://web.structured.app/')) event.preventDefault();
    });
    void this.webView.webContents.loadURL(STRUCTURED_URL).catch((error: unknown) => {
      this.ready = false;
      this.navigationError = `Structured 页面加载失败：${error instanceof Error ? error.message : String(error)}`;
      this.scheduleStartupRecovery();
      void this.sendShellState();
    });
  }

  private async attachLocalView(): Promise<void> {
    if (!this.window) return;
    this.localView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: require('node:path').join(__dirname, '../preload/shell.js') }});
    this.window.contentView.addChildView(this.localView);
    this.localView.webContents.on('did-finish-load', () => {
      void this.sendShellState();
    });
    await this.localView.webContents.loadFile(require('node:path').join(__dirname, '../renderer/shell.html'));
  }

  async handleLocalMessage(channel: string, args: unknown[]): Promise<void> {
    if (channel === 'shell-navigate') await this.navigate(args[0] as StartupPage);
    if (channel === 'shell-settings') await this.openSettings();
    if (channel === 'shell-refresh') await this.refreshStructuredPage();
    if (channel === 'shell-quit') await this.quit();
    if (channel === 'settings-save') await this.saveSettings(args[0] as AppSettingsPatch);
    if (channel === 'settings-close') await this.closeSettings();
    if (channel === 'settings-reset-window') await this.resetWindow();
    if (channel === 'settings-use-current-size') await this.sendCurrentWindowSize();
  }

  private async sendShellState(): Promise<void> {
    if (!this.localView) return;
    const settings = this.store.get();
    await this.localView.webContents.send('shell-state', {
      mode: settings.window.mode,
      page: this.currentPage,
      settings,
      displays: this.getDisplays(),
      loading: !this.ready && !this.navigationError,
      error: this.navigationError
    });
  }

  async navigate(page: StartupPage): Promise<void> {
    this.currentPage = page;
    await this.sendShellState();
    if (!this.ready || !this.webView) return;
    this.navigationQueue = this.navigationQueue.catch(() => undefined).then(async () => {
      if (!this.ready || !this.webView) return;
      const target = this.currentPage;
      try {
        await new StructuredUiAdapter(this.webView.webContents).navigate(target);
        this.navigationError = undefined;
        this.startupNavigationPending = false;
        this.startupRecoveryAttempts = 0;
        this.clearStartupRetry();
      } catch (error) {
        this.navigationError = error instanceof Error ? error.message : String(error);
        if (this.startupNavigationPending && target === this.currentPage) this.scheduleStartupRecovery(false);
      } finally {
        await this.sendShellState();
      }
    });
    await this.navigationQueue;
  }

  private async sendCurrentWindowSize(): Promise<void> {
    if (!this.window || !this.settingsView) return;
    const [width, height] = this.window.getSize();
    await this.settingsView.webContents.send('settings-current-size', { width, height });
  }

  private layout(): void {
    if (!this.window) return;
    const [width, height] = this.window.getContentSize();
    const settings = this.store.get();
    const toolbarHeight = settings.window.mode === 'normal' ? 54 : 42;
    this.webView?.setBounds({ x: 0, y: toolbarHeight, width, height: Math.max(1, height - toolbarHeight) });
    this.localView?.setBounds({ x: 0, y: 0, width, height: toolbarHeight });
    this.settingsView?.setBounds({ x: Math.max(16, width - Math.min(520, width - 32)), y: 16, width: Math.min(504, width - 32), height: Math.min(height - 32, 720) });
    this.activateStructuredPage();
  }

  private activateStructuredPage(): void {
    if (!this.window || !this.webView || !this.structuredPageLoaded || this.structuredPageActivated) return;
    const bounds = this.webView.getBounds();
    if (bounds.width < 1 || bounds.height < 1) return;
    this.structuredPageActivated = true;
    this.ready = true;
    this.navigationError = undefined;
    void this.sendShellState();
    void this.navigate(this.currentPage);
  }

  private scheduleStartupRecovery(reloadPage = true): void {
    if (!this.startupNavigationPending || !this.webView || this.webView.webContents.isDestroyed() || this.startupRetryTimer) return;
    const delayMs = Math.min(1000 * (2 ** Math.min(this.startupRecoveryAttempts, 5)), 30000);
    this.startupRecoveryAttempts += 1;
    const retryMessage = reloadPage ? 'Structured 页面暂时无法加载' : 'Structured 启动状态尚未确认';
    this.navigationError = `${retryMessage}，将在 ${Math.ceil(delayMs / 1000)} 秒后自动重试…`;
    this.startupRetryTimer = setTimeout(() => {
      this.startupRetryTimer = undefined;
      if (!this.startupNavigationPending || !this.webView || this.webView.webContents.isDestroyed()) return;
      if (!reloadPage) {
        void this.navigate(this.currentPage);
        return;
      }
      this.ready = false;
      this.structuredPageLoaded = false;
      this.structuredPageActivated = false;
      void this.webView.webContents.loadURL(STRUCTURED_URL).catch((error: unknown) => {
        this.navigationError = `Structured 页面加载失败：${error instanceof Error ? error.message : String(error)}`;
        this.scheduleStartupRecovery();
        void this.sendShellState();
      });
    }, delayMs);
    void this.sendShellState();
  }

  private clearStartupRetry(): void {
    if (this.startupRetryTimer) clearTimeout(this.startupRetryTimer);
    this.startupRetryTimer = undefined;
  }

  private async refreshStructuredPage(): Promise<void> {
    if (!this.webView || this.webView.webContents.isDestroyed()) return;
    this.clearStartupRetry();
    this.startupNavigationPending = true;
    this.startupRecoveryAttempts = 0;
    this.ready = false;
    this.structuredPageLoaded = false;
    this.structuredPageActivated = false;
    this.navigationError = undefined;
    await this.sendShellState();
    try {
      await this.webView.webContents.loadURL(STRUCTURED_URL);
    } catch (error) {
      this.navigationError = `Structured 页面加载失败：${error instanceof Error ? error.message : String(error)}`;
      this.scheduleStartupRecovery();
      await this.sendShellState();
    }
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
    this.structuredPageLoaded = false;
    this.structuredPageActivated = false;
    this.startupNavigationPending = true;
    this.startupRecoveryAttempts = 0;
    this.clearStartupRetry();
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
    this.layout();
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
    this.clearStartupRetry();
    for (const view of [this.webView, this.localView, this.settingsView]) {
      if (!view) continue;
      try { this.window?.contentView.removeChildView(view); } catch { /* window is closing */ }
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.webView = undefined; this.localView = undefined; this.settingsView = undefined;
    this.ready = false;
  }

  async quit(): Promise<void> {
    this.persistLastBounds();
    await this.store.save();
    this.disposeViews();
    this.window?.destroy();
    this.window = undefined;
  }
}
