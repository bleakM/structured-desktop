import { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, screen, session, WebContentsView } from 'electron';
import { AppSettingsPatch, SettingsStore } from './settings';
import { calculateCollapsedWidgetBounds, calculateExpandedWidgetBounds, calculateStartupBounds, calculateVisibleWidgetBounds, calculateWidgetShape, clampBounds, listDisplays, WIDGET_ORB_SIZE } from './window-state';
import { AppSettings, StartupPage, WidgetEdge } from './types';
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
  private startupNavigationTimer?: NodeJS.Timeout;
  private startupRetryTimer?: NodeJS.Timeout;
  private widgetHoverTimer?: NodeJS.Timeout;
  private widgetPositionTimer?: NodeJS.Timeout;
  private widgetPositionAnimation = 0;
  private widgetPositionAnimationResolve?: () => void;
  private boundsWriteTimer?: NodeJS.Timeout;
  private widgetExpanded = false;
  private widgetHovered = false;
  private widgetEdge: WidgetEdge = 'right';
  private widgetOrbY = 0;
  private widgetDisplayId?: string;
  private widgetDragStart?: { cursorX: number; cursorY: number; bounds: Rectangle };
  private currentPage: StartupPage;
  private navigationQueue: Promise<void> = Promise.resolve();
  private navigationError?: string;

  constructor(private readonly store: SettingsStore, private readonly autoStarted = false) { this.currentPage = store.get().startupPage; }

  getWindow(): BrowserWindow | undefined { return this.window; }
  getPage(): StartupPage { return this.currentPage; }
  getSettings(): AppSettings { return this.store.get(); }
  getDisplays() { return listDisplays(); }

  async create(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.clearStartupRetry();
    this.clearStartupNavigationTimer();
    this.startupNavigationPending = true;
    this.startupRecoveryAttempts = 0;
    const settings = this.store.get();
    const startupBounds = calculateStartupBounds(settings);
    let bounds = startupBounds;
    if (settings.window.mode === 'widget') {
      const display = settings.window.widgetEdge
        ? screen.getAllDisplays().find((candidate) => String(candidate.id) === settings.window.displayId) ?? screen.getPrimaryDisplay()
        : screen.getDisplayMatching(startupBounds);
      this.widgetDisplayId = String(display.id);
      this.widgetEdge = settings.window.widgetEdge ?? this.edgeForBounds(startupBounds, display.workArea);
      this.widgetOrbY = Number.isFinite(settings.window.widgetY)
        ? settings.window.widgetY!
        : startupBounds.y + Math.round((startupBounds.height - WIDGET_ORB_SIZE) / 2);
      this.widgetExpanded = this.autoStarted;
      bounds = this.widgetExpanded
        ? calculateExpandedWidgetBounds(display.workArea, this.widgetEdge, this.widgetOrbY, settings.window.width, settings.window.height)
        : calculateCollapsedWidgetBounds(display.workArea, this.widgetEdge, this.widgetOrbY);
    }
    const options: BrowserWindowConstructorOptions = {
      ...bounds,
      show: false,
      title: 'Structured Desktop',
      frame: settings.window.mode === 'normal',
      type: process.platform === 'linux' && settings.window.mode === 'widget' ? 'dock' : undefined,
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      skipTaskbar: settings.window.mode === 'widget',
      alwaysOnTop: settings.window.mode === 'widget',
      transparent: settings.window.mode === 'widget',
      backgroundColor: settings.window.mode === 'widget' ? '#00000000' : '#f7f7fb',
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
    window.setAlwaysOnTop(settings.window.mode === 'widget');
    window.setMenuBarVisibility(false);
    window.contentView.setBackgroundColor(settings.window.mode === 'widget' ? '#00000000' : '#f7f7fb');
    window.contentView.setBorderRadius(settings.window.mode === 'widget' ? WIDGET_ORB_SIZE / 2 : 0);
    window.on('resize', () => { this.layout(); this.persistLastBounds(); });
    window.on('move', () => this.persistLastBounds());
    window.on('close', () => this.persistLastBounds(true));
    window.on('blur', () => {
      if (this.store.get().window.mode === 'widget' && this.widgetExpanded) void this.collapseWidget();
    });
    window.on('closed', () => {
      if (this.window !== window) return;
      this.clearWidgetHoverTimer();
      this.clearStartupRetry();
      this.clearStartupNavigationTimer();
      this.disposeViews();
      this.window = undefined;
      this.ready = false;
    });
    await this.attachStructuredView();
    await this.attachLocalView();
    this.layout();
    if (settings.window.mode === 'widget' && !this.widgetExpanded) this.setCollapsedWidgetShape();
    window.show();
    if (process.platform === 'linux' && detectWindowEnvironment().precisePositioning) this.correctInitialPosition(window, bounds);
    // Mutter may ignore the constructor hint until the X11 window is mapped.
    // Apply it again after showing so Widget mode can leave the taskbar on
    // GNOME/X11 while keeping the window interactive.
    window.setSkipTaskbar(settings.window.mode === 'widget');
    window.setAlwaysOnTop(settings.window.mode === 'widget');
    if (settings.window.mode !== 'widget' || this.widgetExpanded) window.focus();
    return window;
  }

  private correctInitialPosition(window: BrowserWindow, target: Rectangle): void {
    // Mutter can apply its initial placement after show(); reassert the requested
    // bounds briefly while the mapped X11 window settles.
    for (const delay of [0, 120, 360, 800]) {
      const timer = setTimeout(() => {
        if (window.isDestroyed() || !window.isVisible() || window.isMaximized()) return;
        const current = window.getBounds();
        if (current.x !== target.x || current.y !== target.y || current.width !== target.width || current.height !== target.height) {
          window.setBounds(target);
        }
      }, delay);
      timer.unref();
    }
  }

  private async attachStructuredView(): Promise<void> {
    if (!this.window) return;
    const ses = session.fromPartition(SESSION_PARTITION);
    this.webView = new WebContentsView({ webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false
    }});
    this.webView.setBackgroundColor('#f7f7fb');
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
    this.localView.setBackgroundColor('#00000000');
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
    if (channel === 'widget-hover') this.setWidgetHovered(args[0] === true);
    if (channel === 'widget-expand') await this.expandWidget();
    if (channel === 'widget-collapse') await this.collapseWidget();
    if (channel === 'widget-drag-start') this.startWidgetDrag();
    if (channel === 'widget-drag-move') this.moveWidgetDrag();
    if (channel === 'widget-drag-end') await this.endWidgetDrag(args[0] === true);
  }

  private async sendShellState(): Promise<void> {
    if (!this.localView) return;
    const settings = this.store.get();
    await this.localView.webContents.send('shell-state', {
      mode: settings.window.mode,
      page: this.currentPage,
      settings,
      displays: this.getDisplays(),
      widgetExpanded: this.widgetExpanded,
      widgetEdge: this.widgetEdge,
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
    if (settings.window.mode === 'widget' && !this.widgetExpanded) {
      // Keep the page alive off-canvas so expanding never reloads or throttles it.
      this.webView?.setVisible(true);
      this.webView?.setBounds({
        x: -settings.window.width,
        y: -settings.window.height,
        width: settings.window.width,
        height: Math.max(1, settings.window.height - 42)
      });
      this.localView?.setVisible(true);
      this.settingsView?.setVisible(false);
      this.localView?.setBounds({ x: 0, y: 0, width: WIDGET_ORB_SIZE, height: WIDGET_ORB_SIZE });
      this.window.contentView.setBorderRadius(WIDGET_ORB_SIZE / 2);
      return;
    }
    this.webView?.setVisible(true);
    this.localView?.setVisible(true);
    this.settingsView?.setVisible(true);
    this.window.contentView.setBorderRadius(settings.window.mode === 'widget' ? 14 : 0);
    const toolbarHeight = settings.window.mode === 'normal' ? 54 : 42;
    this.webView?.setBounds({ x: 0, y: toolbarHeight, width, height: Math.max(1, height - toolbarHeight) });
    this.localView?.setBounds({ x: 0, y: 0, width, height: toolbarHeight });
    this.settingsView?.setBounds({ x: Math.max(16, width - Math.min(520, width - 32)), y: 16, width: Math.min(504, width - 32), height: Math.min(height - 32, 720) });
    if (settings.window.mode === 'widget') this.window.setShape([{ x: 0, y: 0, width, height }]);
    this.activateStructuredPage();
  }

  private setCollapsedWidgetShape(): void {
    if (!this.window || (process.platform !== 'linux' && process.platform !== 'win32')) return;
    this.window.setShape(calculateWidgetShape(this.getWidgetDisplay().scaleFactor));
  }

  async showMainWindow(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.store.get().window.mode === 'widget') await this.expandWidget();
    else {
      this.window.show();
      this.window.focus();
    }
  }

  private edgeForBounds(bounds: Rectangle, workArea: Rectangle): WidgetEdge {
    const center = bounds.x + bounds.width / 2;
    const midpoint = workArea.x + workArea.width / 2;
    if (Math.abs(center - midpoint) < bounds.width / 2) return 'right';
    return center < midpoint ? 'left' : 'right';
  }

  private getWidgetDisplay() {
    const displays = screen.getAllDisplays();
    return displays.find((display) => String(display.id) === this.widgetDisplayId)
      ?? (this.window ? screen.getDisplayMatching(this.window.getBounds()) : screen.getPrimaryDisplay());
  }

  private setWidgetHovered(hovered: boolean): void {
    if (!this.window || this.store.get().window.mode !== 'widget' || this.widgetExpanded) return;
    this.clearWidgetHoverTimer();
    if (hovered) {
      this.widgetHovered = true;
      void this.revealWidget();
      return;
    }
    this.widgetHoverTimer = setTimeout(() => {
      this.widgetHoverTimer = undefined;
      if (!this.window || this.window.isDestroyed() || this.widgetExpanded || this.widgetDragStart) return;
      this.widgetHovered = false;
      void this.tuckWidget();
    }, 450);
    this.widgetHoverTimer.unref();
  }

  private clearWidgetHoverTimer(): void {
    if (this.widgetHoverTimer) clearTimeout(this.widgetHoverTimer);
    this.widgetHoverTimer = undefined;
  }

  private async revealWidget(): Promise<void> {
    if (!this.window || this.window.isDestroyed() || this.widgetExpanded) return;
    const bounds = calculateVisibleWidgetBounds(this.getWidgetDisplay().workArea, this.widgetEdge, this.widgetOrbY);
    await this.animateWidgetBounds(bounds);
  }

  private async tuckWidget(): Promise<void> {
    if (!this.window || this.window.isDestroyed() || this.widgetExpanded) return;
    const bounds = calculateCollapsedWidgetBounds(this.getWidgetDisplay().workArea, this.widgetEdge, this.widgetOrbY);
    await this.animateWidgetBounds(bounds);
  }

  private animateWidgetBounds(target: Rectangle, duration = 220): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return Promise.resolve();
    this.cancelWidgetBoundsAnimation();
    const animationId = ++this.widgetPositionAnimation;
    const start = this.window.getBounds();
    if (start.x === target.x && start.y === target.y && start.width === target.width && start.height === target.height) return Promise.resolve();
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const frame = () => {
        if (!this.window || this.window.isDestroyed() || animationId !== this.widgetPositionAnimation) {
          if (animationId === this.widgetPositionAnimation) {
            this.widgetPositionTimer = undefined;
            this.widgetPositionAnimationResolve = undefined;
          }
          resolve();
          return;
        }
        const progress = Math.min(1, (Date.now() - startedAt) / duration);
        const eased = 1 - (1 - progress) ** 3;
        this.window.setBounds({
          x: Math.round(start.x + (target.x - start.x) * eased),
          y: Math.round(start.y + (target.y - start.y) * eased),
          width: Math.round(start.width + (target.width - start.width) * eased),
          height: Math.round(start.height + (target.height - start.height) * eased)
        });
        if (progress >= 1) {
          this.widgetPositionTimer = undefined;
          this.widgetPositionAnimationResolve = undefined;
          resolve();
          return;
        }
        this.widgetPositionTimer = setTimeout(frame, 16);
      };
      this.widgetPositionAnimationResolve = resolve;
      frame();
    });
  }

  private cancelWidgetBoundsAnimation(): void {
    if (this.widgetPositionTimer) clearTimeout(this.widgetPositionTimer);
    this.widgetPositionTimer = undefined;
    this.widgetPositionAnimation += 1;
    this.widgetPositionAnimationResolve?.();
    this.widgetPositionAnimationResolve = undefined;
  }

  private async expandWidget(): Promise<void> {
    if (!this.window || this.window.isDestroyed() || this.store.get().window.mode !== 'widget') return;
    this.clearWidgetHoverTimer();
    if (this.widgetExpanded) {
      this.window.show();
      this.window.focus();
      return;
    }
    this.cancelWidgetBoundsAnimation();
    const settings = this.store.get();
    const display = this.getWidgetDisplay();
    const bounds = calculateExpandedWidgetBounds(display.workArea, this.widgetEdge, this.widgetOrbY, settings.window.width, settings.window.height);
    this.widgetExpanded = true;
    this.widgetHovered = false;
    this.window.setBounds(bounds);
    this.layout();
    this.window.show();
    this.window.focus();
    await this.sendShellState();
  }

  private async collapseWidget(): Promise<void> {
    if (!this.window || this.window.isDestroyed() || this.store.get().window.mode !== 'widget' || !this.widgetExpanded) return;
    this.widgetExpanded = false;
    this.widgetHovered = false;
    this.clearWidgetHoverTimer();
    await this.closeSettings();
    const display = screen.getDisplayMatching(this.window.getBounds());
    this.widgetDisplayId = String(display.id);
    const bounds = this.window.getBounds();
    this.widgetOrbY = bounds.y + Math.round((bounds.height - WIDGET_ORB_SIZE) / 2);
    const collapsedBounds = calculateCollapsedWidgetBounds(display.workArea, this.widgetEdge, this.widgetOrbY);
    this.widgetOrbY = collapsedBounds.y;
    const visibleBounds = calculateVisibleWidgetBounds(display.workArea, this.widgetEdge, this.widgetOrbY);
    this.window.setBounds(visibleBounds);
    this.setCollapsedWidgetShape();
    this.layout();
    await this.animateWidgetBounds(collapsedBounds);
    await this.store.update({ window: { widgetEdge: this.widgetEdge, widgetY: this.widgetOrbY, displayId: this.widgetDisplayId } });
    await this.sendShellState();
  }

  private startWidgetDrag(): void {
    if (!this.window || this.widgetExpanded || this.store.get().window.mode !== 'widget') return;
    const cursor = screen.getCursorScreenPoint();
    this.widgetDragStart = { cursorX: cursor.x, cursorY: cursor.y, bounds: this.window.getBounds() };
    this.clearWidgetHoverTimer();
  }

  private moveWidgetDrag(): void {
    if (!this.window || !this.widgetDragStart || this.widgetExpanded) return;
    const cursor = screen.getCursorScreenPoint();
    this.window.setPosition(
      Math.round(this.widgetDragStart.bounds.x + cursor.x - this.widgetDragStart.cursorX),
      Math.round(this.widgetDragStart.bounds.y + cursor.y - this.widgetDragStart.cursorY)
    );
  }

  private async endWidgetDrag(openAfterRelease: boolean): Promise<void> {
    if (!this.window || !this.widgetDragStart) return;
    this.widgetDragStart = undefined;
    if (openAfterRelease) return;
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const midpoint = display.workArea.x + display.workArea.width / 2;
    this.widgetEdge = bounds.x + bounds.width / 2 < midpoint ? 'left' : 'right';
    const snapped = calculateCollapsedWidgetBounds(display.workArea, this.widgetEdge, bounds.y);
    this.widgetOrbY = snapped.y;
    this.widgetDisplayId = String(display.id);
    this.setCollapsedWidgetShape();
    await this.animateWidgetBounds(snapped);
    if (this.widgetExpanded) return;
    await this.store.update({ window: { widgetEdge: this.widgetEdge, widgetY: this.widgetOrbY, displayId: this.widgetDisplayId } });
    await this.sendShellState();
  }

  private activateStructuredPage(): void {
    if (!this.window || !this.webView || !this.structuredPageLoaded || this.structuredPageActivated) return;
    const bounds = this.webView.getBounds();
    if (bounds.width < 1 || bounds.height < 1) return;
    this.structuredPageActivated = true;
    this.ready = true;
    this.navigationError = undefined;
    void this.sendShellState();
    // Structured's document can finish loading before its client-side controls
    // have attached event handlers. Give hydration a moment before the first
    // Inbox click; the retry path below remains active if the page is slower.
    this.clearStartupNavigationTimer();
    this.startupNavigationTimer = setTimeout(() => {
      this.startupNavigationTimer = undefined;
      if (this.startupNavigationPending) void this.navigate(this.currentPage);
    }, 1000);
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

  private clearStartupNavigationTimer(): void {
    if (this.startupNavigationTimer) clearTimeout(this.startupNavigationTimer);
    this.startupNavigationTimer = undefined;
  }

  private async refreshStructuredPage(): Promise<void> {
    if (!this.webView || this.webView.webContents.isDestroyed()) return;
    this.clearStartupRetry();
    this.clearStartupNavigationTimer();
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

  private persistLastBounds(immediate = false): void {
    if (!this.window || this.window.isMinimized() || this.window.isMaximized()) return;
    const bounds = this.window.getBounds();
    const settings = this.store.get().window;
    const windowPatch = settings.mode === 'widget' && !this.widgetExpanded
      ? { widgetEdge: this.widgetEdge, widgetY: bounds.y, displayId: this.widgetDisplayId }
      : { lastX: bounds.x, lastY: bounds.y };
    if (this.boundsWriteTimer) clearTimeout(this.boundsWriteTimer);
    const write = () => {
      this.boundsWriteTimer = undefined;
      void this.store.update({ window: windowPatch });
    };
    if (immediate) write();
    else {
      this.boundsWriteTimer = setTimeout(write, 180);
      this.boundsWriteTimer.unref();
    }
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
      if (next.window.mode === 'widget' && this.widgetExpanded) {
        const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === next.window.displayId) ?? this.getWidgetDisplay();
        this.widgetDisplayId = String(display.id);
        this.window?.setBounds(calculateExpandedWidgetBounds(display.workArea, this.widgetEdge, this.widgetOrbY, next.window.width, next.window.height));
      } else if (next.window.mode !== 'widget') {
        this.window?.setBounds(calculateStartupBounds(next));
      }
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
    this.clearStartupNavigationTimer();
    this.currentPage = currentPage;
    await this.create();
  }

  async resetWindow(): Promise<void> {
    const next = await this.store.update({ window: { positionMode: 'center', displayId: undefined, x: undefined, y: undefined, lastX: undefined, lastY: undefined, lastWidth: undefined, lastHeight: undefined, widgetEdge: undefined, widgetY: undefined } });
    if (next.window.mode === 'widget' && this.window) {
      const startupBounds = calculateStartupBounds(next);
      const display = screen.getDisplayMatching(startupBounds);
      this.widgetDisplayId = String(display.id);
      this.widgetEdge = 'right';
      this.widgetOrbY = startupBounds.y + Math.round((startupBounds.height - WIDGET_ORB_SIZE) / 2);
      this.widgetExpanded = false;
      this.window.setBounds(calculateCollapsedWidgetBounds(display.workArea, this.widgetEdge, this.widgetOrbY));
      this.layout();
    } else {
      this.window?.setBounds(calculateStartupBounds(next));
    }
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
    this.clearStartupNavigationTimer();
    for (const view of [this.webView, this.localView, this.settingsView]) {
      if (!view) continue;
      try { this.window?.contentView.removeChildView(view); } catch { /* window is closing */ }
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.webView = undefined; this.localView = undefined; this.settingsView = undefined;
    this.ready = false;
  }

  async quit(): Promise<void> {
    this.persistLastBounds(true);
    await this.store.save();
    this.disposeViews();
    this.window?.destroy();
    this.window = undefined;
  }
}
