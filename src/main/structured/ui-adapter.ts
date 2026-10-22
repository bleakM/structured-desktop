import { WebContents } from 'electron';
import { StartupPage } from '../types';

export class StructuredUiError extends Error {}

/**
 * DOM adapter for the public Structured Web UI. It only uses accessible names
 * and visible state, so local controls never need to recreate task components.
 */
export class StructuredUiAdapter {
  constructor(private readonly contents: WebContents) {}

  async getInboxOpen(): Promise<boolean | null> {
    return this.contents.executeJavaScript(`(() => {
      const candidates = [...document.querySelectorAll('button,[role="button"]')];
      const button = candidates.find((el) => {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().toLowerCase();
        return /inbox|收件箱/.test(label);
      });
      if (!button) return null;
      const expanded = button.getAttribute('aria-expanded');
      if (expanded) return expanded === 'true';
      return Boolean(document.querySelector('[role="dialog"][aria-label*="Inbox" i], [data-testid*="inbox" i]'));
    })()`, true);
  }

  async navigate(page: StartupPage): Promise<void> {
    const wantInbox = page === 'inbox';
    const result = await this.contents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const findInbox = () => [...document.querySelectorAll('button,[role="button"]')].find((el) => {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().toLowerCase();
        return /inbox|收件箱/.test(label);
      });
      const findTimeline = () => [...document.querySelectorAll('a,button,[role="button"]')].find((el) => {
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().toLowerCase();
        return /timeline|today|日程|时间轴/.test(label);
      });
      for (let i = 0; i < 50; i++) {
        const inbox = findInbox();
        if (inbox) {
          const expanded = inbox.getAttribute('aria-expanded') === 'true' || Boolean(document.querySelector('[role="dialog"][aria-label*="Inbox" i], [data-testid*="inbox" i]'));
          if (${wantInbox} !== expanded) inbox.click();
          await sleep(100);
          const after = inbox.getAttribute('aria-expanded') === 'true' || Boolean(document.querySelector('[role="dialog"][aria-label*="Inbox" i], [data-testid*="inbox" i]'));
          if (after === ${wantInbox}) return { ok: true, inbox: after };
        }
        if (!${wantInbox}) {
          const timeline = findTimeline();
          if (timeline) timeline.click();
        }
        await sleep(200);
      }
      return { ok: false, reason: 'Structured UI did not expose a verifiable Inbox control.' };
    })()`, true) as { ok: boolean; reason?: string };
    if (!result?.ok) throw new StructuredUiError(result?.reason ?? 'Structured page navigation failed.');
  }
}
