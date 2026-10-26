import test from 'node:test';
import assert from 'node:assert/strict';
import { getInboxToggleAction, readInboxOpenState, resolveInboxOpenState } from '../src/main/structured/ui-adapter';

test('Inbox navigation only toggles when the observed state differs from the target', () => {
  assert.equal(getInboxToggleAction(false, true), 'toggle');
  assert.equal(getInboxToggleAction(true, false), 'toggle');
  assert.equal(getInboxToggleAction(true, true), 'none');
  assert.equal(getInboxToggleAction(false, false), 'none');
});

test('Inbox navigation never toggles when the current state is unknown', () => {
  assert.equal(getInboxToggleAction(null, true), 'unknown');
  assert.equal(getInboxToggleAction(null, false), 'unknown');
});

test('Inbox state can be read from accessible attributes on a control or its descendants', () => {
  assert.equal(readInboxOpenState(['closed']), false);
  assert.equal(readInboxOpenState([null, 'open']), true);
  assert.equal(readInboxOpenState([null, null]), null);
});

test('visible Inbox panels override a stale collapsed state on the toggle control', () => {
  assert.equal(resolveInboxOpenState(false, {
    routeIsInbox: false,
    controlledPanelVisible: false,
    inboxPanelVisible: true,
    label: 'Inbox'
  }), true);
});

test('the Timeline route alone does not imply that the Inbox panel is closed', () => {
  assert.equal(resolveInboxOpenState(null, {
    routeIsInbox: false,
    controlledPanelVisible: false,
    inboxPanelVisible: false,
    label: 'Inbox'
  }), null);
});
