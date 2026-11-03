/**
 * Clicking a pop-up (public/push-sw.js): it opens the link in a tab of the same
 * panel — never the shop tab someone was reading — and opens a new tab when no
 * panel tab is open or the tab cannot be moved.
 */
import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

const ORIGIN = 'https://autobacsindia.com';
type Tab = { url: string; focused?: boolean; visibilityState?: string; focus: jest.Mock; navigate: jest.Mock };
const tab = (p: string, over: Partial<Tab> = {}): Tab => ({
  url: `${ORIGIN}${p}`, focus: jest.fn(async () => undefined), navigate: jest.fn(async function (this: Tab) { return this; }), ...over,
});

function clickWith(open: Tab[], link: string) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const openWindow = jest.fn(async () => null);
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    clients: { matchAll: async () => open, openWindow, claim: async () => undefined },
    registration: {},
    skipWaiting: () => undefined,
  };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../../public/push-sw.js'), 'utf8'), { self, URL });
  let done: Promise<unknown> = Promise.resolve();
  listeners.notificationclick({ notification: { close: () => undefined, data: { url: link } }, waitUntil: (p: Promise<unknown>) => { done = p; } });
  return { done: () => done, openWindow };
}

const LINK = '/admin/chat?c=abc&th=root1';

it('takes over the panel tab, not the shop tab that was open first', async () => {
  const shop = tab('/products/thule-rack');
  const panel = tab('/admin/orders');
  const { done, openWindow } = clickWith([shop, panel], LINK);
  await done();
  expect(shop.navigate).not.toHaveBeenCalled();
  expect(panel.navigate).toHaveBeenCalledWith(`${ORIGIN}${LINK}`);
  expect(openWindow).not.toHaveBeenCalled();
});

it('prefers a tab already on the chat page', async () => {
  const orders = tab('/admin/orders', { focused: true });
  const chat = tab('/admin/chat?c=other');
  const { done } = clickWith([orders, chat], LINK);
  await done();
  expect(chat.navigate).toHaveBeenCalled();
  expect(orders.navigate).not.toHaveBeenCalled();
});

it('an admin link never takes over a team panel tab, and the reverse', async () => {
  const team = tab('/team/chat');
  const { done, openWindow } = clickWith([team], LINK);
  await done();
  expect(team.navigate).not.toHaveBeenCalled();
  expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}${LINK}`);
});

it('opens a new tab when the panel tab refuses to be moved', async () => {
  const panel = tab('/admin/chat', { navigate: jest.fn(async () => { throw new TypeError('not controlled'); }) });
  const { done, openWindow } = clickWith([panel], LINK);
  await done();
  expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}${LINK}`);
});

it('opens a new tab when only the shop is open', async () => {
  const shop = tab('/');
  const { done, openWindow } = clickWith([shop], LINK);
  await done();
  expect(shop.navigate).not.toHaveBeenCalled();
  expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}${LINK}`);
});
