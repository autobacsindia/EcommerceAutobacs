/**
 * Plain-words help for pop-up notifications, per browser and computer.
 *
 * Why it is per browser: "allow notifications" lives in a different place in
 * each one, and Brave switches its push service off by default — a generic
 * "check your settings" sends people hunting. The steps name the exact menu.
 */
export type BrowserKind = 'chrome' | 'edge' | 'firefox' | 'safari' | 'brave' | 'opera' | 'samsung' | 'other';
export type OsKind = 'mac' | 'windows' | 'android' | 'ios' | 'linux' | 'other';
export type BrowserInfo = { browser: BrowserKind; os: OsKind; label: string };

const BROWSER_NAMES: Record<BrowserKind, string> = {
  chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', brave: 'Brave', opera: 'Opera', samsung: 'Samsung Internet', other: 'this browser',
};
const OS_NAMES: Record<OsKind, string> = {
  mac: 'Mac', windows: 'Windows', android: 'Android', ios: 'iPhone/iPad', linux: 'Linux', other: '',
};

export function detectBrowser(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): BrowserInfo {
  const ua = nav?.userAgent || '';
  // Brave reports itself as Chrome; it is the one browser that says so only here.
  const brave = !!nav && 'brave' in nav;
  const browser: BrowserKind = brave ? 'brave'
    : /Edg\//.test(ua) ? 'edge'
      : /OPR\/|Opera/.test(ua) ? 'opera'
        : /SamsungBrowser/.test(ua) ? 'samsung'
          : /Firefox\/|FxiOS/.test(ua) ? 'firefox'
            : /Chrome\/|CriOS/.test(ua) ? 'chrome'
              : /Safari\//.test(ua) ? 'safari' : 'other';
  const os: OsKind = /iPhone|iPad|iPod/.test(ua) ? 'ios'
    : /Android/.test(ua) ? 'android'
      : /Windows/.test(ua) ? 'windows'
        : /Mac OS X|Macintosh/.test(ua) ? 'mac'
          : /Linux|CrOS/.test(ua) ? 'linux' : 'other';
  const name = BROWSER_NAMES[browser];
  const label = browser === 'other' ? 'This browser' : OS_NAMES[os] ? `${name} on ${OS_NAMES[os]}` : name;
  return { browser, os, label };
}

/** The site is blocked in the browser itself: where to set it back to Allow. */
export function allowSteps(browser: BrowserKind): string {
  switch (browser) {
    case 'firefox':
      return 'Click the icon to the left of the web address, remove "Send notifications: Blocked" (the ×), reload the page, then press Turn on again.';
    case 'safari':
      return 'Safari menu → Settings → Websites → Notifications → find autobacsindia.com → set it to Allow, then reload the page.';
    case 'edge':
      return 'Click the lock to the left of the web address → Permissions for this site → Notifications → Allow, then reload the page.';
    default:
      return 'Click the icon to the left of the web address → Site settings → Notifications → Allow, then reload the page.';
  }
}

/** The browser got the pop-up but the computer did not show it. */
export function osSteps(os: OsKind, browser: BrowserKind): string {
  const app = browser === 'other' ? 'your browser' : BROWSER_NAMES[browser];
  switch (os) {
    case 'mac':
      return `On the Mac: System Settings → Notifications → ${app} → turn on "Allow notifications" and pick "Banners" or "Alerts". Also turn Focus / Do Not Disturb off (Control Centre, top right).`;
    case 'windows':
      return `On Windows: Settings → System → Notifications → turn Notifications on, and turn ${app} on in the list. Also turn "Do not disturb" (Focus assist) off.`;
    case 'android':
      return `On the phone: Settings → Apps → ${app} → Notifications → allow them, and turn Do Not Disturb off.`;
    case 'ios':
      return 'On the iPhone: Settings → Notifications → Roavion (the Home Screen icon) → Allow Notifications, and turn Focus off.';
    default:
      return `Check that the computer allows notifications from ${app}, and that "Do not disturb" is off.`;
  }
}

/** Turning on failed although the person said Allow — usually the browser's push service. */
export function subscribeFailHelp(browser: BrowserKind): string {
  if (browser === 'brave') {
    return 'Brave has pop-ups switched off by default. Open Brave Settings → Privacy and security → turn on "Use Google services for push messaging", restart Brave, then press Turn on again.';
  }
  return 'This browser could not sign up for pop-ups. If this is a private / incognito window, use a normal window. On an office-managed computer, ask whoever manages it to allow notifications for autobacsindia.com.';
}

/** The test was sent but this browser never said it arrived. */
export function notReceivedHelp(browser: BrowserKind): string {
  if (browser === 'brave') return subscribeFailHelp('brave');
  return 'The test left our server but did not reach this browser. Keep the browser open (it may be fully closed or asleep), check the internet connection, and on an office network ask whoever manages it whether browser push is blocked. Then press the test again.';
}
