/** Which browser and computer this is, and the steps that match them. */
import { allowSteps, detectBrowser, notReceivedHelp, osSteps, subscribeFailHelp } from './pushHelp';

const nav = (userAgent: string, extra: object = {}) => ({ userAgent, ...extra }) as unknown as Navigator;
const UA = {
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};

it('names the browser and computer', () => {
  expect(detectBrowser(nav(UA.macChrome)).label).toBe('Chrome on Mac');
  expect(detectBrowser(nav(UA.winEdge)).label).toBe('Edge on Windows');
  expect(detectBrowser(nav(UA.winFirefox)).label).toBe('Firefox on Windows');
  expect(detectBrowser(nav(UA.macSafari)).label).toBe('Safari on Mac');
  expect(detectBrowser(nav(UA.iphone)).label).toBe('Safari on iPhone/iPad');
  expect(detectBrowser(nav(UA.android)).label).toBe('Chrome on Android');
  // Brave says "Chrome" in its user agent; navigator.brave gives it away.
  expect(detectBrowser(nav(UA.macChrome, { brave: {} }))).toMatchObject({ browser: 'brave', label: 'Brave on Mac' });
  expect(detectBrowser(undefined).label).toBe('This browser');
});

it('gives each browser its own "allow" steps', () => {
  expect(allowSteps('chrome')).toMatch(/Site settings → Notifications → Allow/);
  expect(allowSteps('edge')).toMatch(/Permissions for this site/);
  expect(allowSteps('firefox')).toMatch(/Send notifications: Blocked/);
  expect(allowSteps('safari')).toMatch(/Settings → Websites → Notifications/);
});

it('points at the computer\'s own settings, naming the browser', () => {
  expect(osSteps('mac', 'chrome')).toMatch(/System Settings → Notifications → Chrome.*Focus/);
  expect(osSteps('windows', 'edge')).toMatch(/Settings → System → Notifications.*Edge.*Do not disturb/);
  expect(osSteps('android', 'chrome')).toMatch(/Apps → Chrome → Notifications/);
});

it('Brave gets its push-service switch; others get incognito / office advice', () => {
  expect(subscribeFailHelp('brave')).toMatch(/Use Google services for push messaging/);
  expect(notReceivedHelp('brave')).toMatch(/Use Google services for push messaging/);
  expect(subscribeFailHelp('chrome')).toMatch(/incognito.*office-managed/);
  expect(notReceivedHelp('firefox')).toMatch(/did not reach this browser/);
});
