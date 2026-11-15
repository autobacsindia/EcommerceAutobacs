/**
 * One place to record "a customer reached for a contact channel".
 *
 * Every floating contact control (WhatsApp, Call, the help-chat launcher and the
 * "Need help?" tab) calls this exactly once per tap, so each channel is counted
 * separately and never twice. It goes to PostHog (`contact_click`, as before)
 * and to GTM's queue (`gtmDataLayer`) so a GTM trigger on `contact_click` can
 * split by `contact_channel` without any tag reading the DOM.
 */
import { capture } from '@/lib/analytics';
import { pushToGtm } from '@/lib/gtm';

export type ContactChannel = 'whatsapp' | 'call' | 'chat' | 'need_help';

export function trackContact(channel: ContactChannel, path: string | null): void {
  capture('contact_click', { channel, path });
  pushToGtm({ event: 'contact_click', contact_channel: channel, page_path: path ?? '' });
}
