import { isHelpBotSuppressed } from './helpBotVisibility';

describe('isHelpBotSuppressed', () => {
  it.each(['/cart', '/cart/', '/checkout', '/admin/orders', '/team', '/login'])('hides the launcher on %s', (p) => {
    expect(isHelpBotSuppressed(p)).toBe(true);
  });

  it.each(['/', '/products/wax', '/cartoon-stickers', '/orders'])('shows the launcher on %s', (p) => {
    expect(isHelpBotSuppressed(p)).toBe(false);
  });
});
