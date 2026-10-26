import { WebContents } from 'electron';
import { StartupPage } from '../types';

export class StructuredUiError extends Error {}

export type InboxToggleAction = 'toggle' | 'none' | 'unknown';

export function getInboxToggleAction(current: boolean | null, desired: boolean): InboxToggleAction {
  if (current === null) return 'unknown';
  return current === desired ? 'none' : 'toggle';
}

export function readInboxOpenState(values: readonly (string | null)[]): boolean | null {
  for (const value of values) {
    const normalized = value?.toLowerCase();
    if (['true', 'open', 'expanded', 'active'].includes(normalized ?? '')) return true;
    if (['false', 'closed', 'collapsed', 'inactive'].includes(normalized ?? '')) return false;
  }
  return null;
}

export function resolveInboxOpenState(
  controlState: boolean | null,
  signals: { routeIsInbox: boolean; controlledPanelVisible: boolean; inboxPanelVisible: boolean; label: string }
): boolean | null {
  if (signals.routeIsInbox || signals.controlledPanelVisible || signals.inboxPanelVisible) return true;
  if (controlState !== null) return controlState;
  if (/(close|hide|collapse|关闭|收起)/i.test(signals.label)) return true;
  if (/(open|show|expand|打开|展开)/i.test(signals.label)) return false;
  return null;
}

interface InboxDomState {
  available: boolean;
  open: boolean | null;
}

/** This function is serialized into the Structured page; keep it self-contained. */
function inspectInboxDom(
  readInboxOpenState: (values: readonly (string | null)[]) => boolean | null,
  resolveInboxOpenState: (controlState: boolean | null, signals: { routeIsInbox: boolean; controlledPanelVisible: boolean; inboxPanelVisible: boolean; label: string }) => boolean | null
): InboxDomState {
  const isVisible = (element: Element | null): boolean => {
    if (!(element instanceof HTMLElement) || element.closest('[aria-hidden="true"], [hidden]')) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const controls = [...document.querySelectorAll('button,[role="button"]')].filter(isVisible);
  const control = controls.find((element) => {
    const label = (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim().toLowerCase();
    return /(^|\b)inbox(\b|$)|收件箱/i.test(label) && !/add to inbox|move to inbox/i.test(label);
  });
  if (!control) return { available: false, open: null };

  const stateElements: Element[] = [control, ...control.querySelectorAll('[aria-expanded],[aria-pressed],[aria-selected],[data-state]')];
  for (let parent = control.parentElement; parent && stateElements.length < 10; parent = parent.parentElement) {
    if (parent.matches('[aria-expanded],[aria-pressed],[aria-selected],[data-state]')) stateElements.push(parent);
  }
  let controlState: boolean | null = null;
  for (const element of stateElements) {
    controlState = readInboxOpenState(['aria-expanded', 'aria-pressed', 'aria-selected', 'data-state'].map((attribute) => element.getAttribute(attribute)));
    if (controlState !== null) break;
  }
  const label = (control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent || '').trim().toLowerCase();
  const controlledIds = (control.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
  const controlledPanelVisible = controlledIds.some((id) => isVisible(document.getElementById(id)));
  const panel = [...document.querySelectorAll('[role="dialog"],[role="complementary"],aside,[data-testid]')]
    .find((element) => element !== control && isVisible(element) && /inbox|收件箱/i.test(`${element.getAttribute('aria-label') || ''} ${element.getAttribute('data-testid') || ''}`));
  const open = resolveInboxOpenState(
    controlState,
    {
      routeIsInbox: /\/inbox(?:\/|$)/i.test(location.pathname),
      controlledPanelVisible,
      inboxPanelVisible: Boolean(panel),
      label
    }
  );
  return { available: true, open };
}

/** This function is serialized into the Structured page; keep it self-contained. */
function waitForInboxControl(inspect: () => InboxDomState, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const observer = new MutationObserver(check);
    const interval = window.setInterval(check, 250);
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    function finish(success: boolean): void {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      resolve(success);
    }
    function check(): void {
      if (inspect().available) finish(true);
    }
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    check();
  });
}

/** This function is serialized into the Structured page; keep it self-contained. */
function waitForInboxStateKnown(inspect: () => InboxDomState, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const observer = new MutationObserver(check);
    const interval = window.setInterval(check, 250);
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    function finish(success: boolean): void {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      resolve(success);
    }
    function check(): void {
      const state = inspect();
      if (state.available && state.open !== null) finish(true);
    }
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    check();
  });
}

/** This function is serialized into the Structured page; keep it self-contained. */
function clickInboxControl(): boolean {
  const control = [...document.querySelectorAll('button,[role="button"]')].find((element) => {
    if (!(element instanceof HTMLElement) || element.closest('[aria-hidden="true"], [hidden]')) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') return false;
    const label = (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim().toLowerCase();
    return /(^|\b)inbox(\b|$)|收件箱/i.test(label) && !/add to inbox|move to inbox/i.test(label);
  });
  if (!(control instanceof HTMLElement)) return false;
  control.click();
  return true;
}

/** This function is serialized into the Structured page; keep it self-contained. */
function waitForInboxState(inspect: () => InboxDomState, desired: boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;
    const observer = new MutationObserver(check);
    const interval = window.setInterval(check, 250);
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    function finish(success: boolean): void {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      resolve(success);
    }
    function check(): void {
      if (inspect().open === desired) finish(true);
    }
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-pressed', 'aria-selected', 'data-state', 'aria-hidden', 'hidden', 'style', 'class']
    });
    check();
  });
}

/** DOM adapter for the public Structured Web UI. */
export class StructuredUiAdapter {
  constructor(private readonly contents: WebContents) {}

  async getInboxOpen(): Promise<boolean | null> {
    const state = await this.contents.executeJavaScript(`(${inspectInboxDom.toString()})(${readInboxOpenState.toString()}, ${resolveInboxOpenState.toString()})`, true) as InboxDomState;
    return state.open;
  }

  async navigate(page: StartupPage): Promise<void> {
    const wantInbox = page === 'inbox';
    const inspect = `(() => (${inspectInboxDom.toString()})(${readInboxOpenState.toString()}, ${resolveInboxOpenState.toString()}))`;
    let state = await this.contents.executeJavaScript(`${inspect}()`, true) as InboxDomState;
    if (!state.available) {
      const appeared = await this.contents.executeJavaScript(`(${waitForInboxControl.toString()})(${inspect}, 30000)`, true) as boolean;
      if (!appeared) throw new StructuredUiError('Structured 页面尚未显示可识别的 Inbox 控件。请确认已登录后重试。');
      state = await this.contents.executeJavaScript(`${inspect}()`, true) as InboxDomState;
    }
    // The control can be rendered before Structured has attached its expanded
    // state. Wait for hydration instead of treating that transient state as a
    // permanent failure during desktop startup.
    if (state.open === null) {
      const known = await this.contents.executeJavaScript(`(${waitForInboxStateKnown.toString()})(${inspect}, 30000)`, true) as boolean;
      if (known) state = await this.contents.executeJavaScript(`${inspect}()`, true) as InboxDomState;
    }
    const action = getInboxToggleAction(state.open, wantInbox);
    if (action === 'none') return;
    if (action === 'unknown') throw new StructuredUiError('无法确认 Structured Inbox 当前是展开还是收起，因此没有触发切换，避免反复开关。');

    const clicked = await this.contents.executeJavaScript(`(${clickInboxControl.toString()})()`, true) as boolean;
    if (!clicked) throw new StructuredUiError('找不到可见的 Structured Inbox 控件，页面没有切换。');
    const reached = await this.contents.executeJavaScript(`(${waitForInboxState.toString()})(${inspect}, ${wantInbox}, 7000)`, true) as boolean;
    if (!reached) throw new StructuredUiError(`已触发一次 Inbox 切换，但未能确认其${wantInbox ? '展开' : '收起'}状态。`);
  }
}
