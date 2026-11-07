/**
 * Follow-up statuses on the GTM leads sheet — the same keys the server accepts
 * (Back-end/server/config/leadConstants.js FOLLOW_UP_STATUSES). "Others" needs a note.
 */
export type FollowUpStatus = 'responded' | 'whatsapp' | 'converted' | 'no_response' | 'not_interested' | 'other';

export const FOLLOW_UP_OPTIONS: readonly { value: FollowUpStatus; label: string; hint: string; tone: string }[] = [
  { value: 'responded', label: 'Responded', hint: 'Spoke to the customer', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  { value: 'whatsapp', label: 'WhatsApp', hint: 'Talked on WhatsApp', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { value: 'converted', label: 'Converted', hint: 'Agreed to buy — closes as Won once the order is paid', tone: 'bg-green-100 text-green-900 border-green-300' },
  { value: 'no_response', label: 'No response', hint: 'Did not pick up or reply', tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  { value: 'not_interested', label: 'Not interested', hint: 'Closes the lead as Lost', tone: 'bg-red-50 text-red-800 border-red-200' },
  { value: 'other', label: 'Others', hint: 'Type what happened', tone: 'bg-gray-100 text-gray-800 border-gray-300' },
];

export const FOLLOW_UP_NOTE_MAX = 500;

export const followUpOption = (v: string | null | undefined) => FOLLOW_UP_OPTIONS.find((o) => o.value === v) ?? null;
