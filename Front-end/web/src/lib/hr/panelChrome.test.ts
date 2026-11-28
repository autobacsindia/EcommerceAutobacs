/**
 * /hr is a staff panel: no shop header, footer, promo strip, help bot, contact
 * button or festival decoration, and it uses the panel theme. Each of those is
 * decided by its own path check, so each is pinned here.
 */
import { isPanelPath } from '@/components/theme/themeChoice';
import { isHelpBotSuppressed } from '@/components/help/helpBotVisibility';
import { isFestiveRoute, isStaffPanelRoute } from '@/lib/festival/festivalTheme';

describe.each(['/hr', '/hr/', '/hr/employees', '/hr/payroll'])('%s is a panel page', (path) => {
  it('uses the panel theme, no help bot, no festive decoration', () => {
    expect(isPanelPath(path.replace(/\/$/, '') || '/')).toBe(true);
    expect(isHelpBotSuppressed(path)).toBe(true);
    expect(isFestiveRoute(path)).toBe(false);
    expect(isStaffPanelRoute(path)).toBe(true);
  });
});

it('does not catch storefront paths that merely start with "hr"', () => {
  expect(isPanelPath('/hrs-sale')).toBe(false);
  expect(isHelpBotSuppressed('/hrs-sale')).toBe(false);
  expect(isFestiveRoute('/hrs-sale')).toBe(true);
});
