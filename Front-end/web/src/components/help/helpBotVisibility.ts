/** Which pages have no help bot, and how another button asks it to open. */

/** Sent by the phone Contact button, so phones need only one floating button. */
export const OPEN_HELP_BOT_EVENT = 'ab:open-help-bot';

export function isHelpBotSuppressed(pathname: string | null): boolean {
  if (!pathname) return false;
  const p = pathname.replace(/\/+$/, '') || '/';
  return (
    p.startsWith('/admin') ||
    p === '/team' || p.startsWith('/team/') ||
    p.startsWith('/checkout') ||      // nothing competes with Pay
    p.startsWith('/staff-invite') ||
    p === '/careers' ||
    p === '/login' || p === '/register'
  );
}
