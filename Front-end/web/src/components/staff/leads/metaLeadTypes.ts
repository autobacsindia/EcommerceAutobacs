import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import type { FollowUpStatus } from './followUpStatus';

/** One Meta lead as /staff/meta-leads sends it (services/metaLeadService.js rowOf). */
export type MetaLead = {
  id: string; tab: string; rowNumber: number | null; removedFromSheet: boolean;
  leadDate: string | null; dateRaw: string; dateHasTime: boolean;
  name: string; phone: string; email: string;
  /** There is a phone or e-mail the server is keeping back from this person. */
  contactHidden: boolean;
  product: string; campaign: string;
  salesPerson: string; status: string; followUp1: string; followUp2: string; revision: number;
  followingUp: { userId: string; name: string; at: string | null; mine: boolean } | null;
  followUpStatus: { status: FollowUpStatus; label: string; at: string | null } | null;
  /** Followed up on, nothing recorded for this many days (0 = fine). */
  quietDays: number;
  others: { tab: string; product: string; followingUp: string | null }[];
  inWebsiteLeads: boolean;
};
export type MetaLeadExtra = { label: string; value: string; readOnly: boolean };
export type MetaLeadEdit = { at: string; who: string; changes: { field: string; from: string; to: string }[] };
export type MetaLeadHistoryLine = { type: string; label: string; followUpStatus: FollowUpStatus | null; at: string; who: string | null; notes: string };
export type MetaLeadDetail = MetaLead & { extras: MetaLeadExtra[]; edits: MetaLeadEdit[]; history: MetaLeadHistoryLine[] };
export type MetaLeadYou = { userId: string; canEdit: boolean; canFollowUp: boolean; canManage: boolean };
export type MetaLeadSync = { lastSuccessAt: string | null; connected: boolean; stale: boolean; columnsMoved: string[]; skippedTabs: string[] };
export type MetaLeadPage = { leads: MetaLead[]; nextCursor: string | null; tabs: { name: string; rows: number }[]; sync: MetaLeadSync; you: MetaLeadYou };
export type MetaLeadPeople = { people: { userId: string; name: string }[]; members?: { userId: string; name: string }[] };

/** The date as the team should read it: India time, or the cell as typed when it could not be read. */
export function metaLeadDate(l: MetaLead): string {
  if (!l.leadDate) return l.dateRaw || 'No date';
  return l.dateHasTime ? formatDateTimeIST(l.leadDate) : formatDateIST(l.leadDate);
}

/**
 * Facebook names sheet columns like `which_suspension_brand_are_you_interested_in?`.
 * With no spaces the browser cannot wrap them, so they ran over their answers.
 * For showing only: saving still uses the column's real name.
 */
export function readableSheetLabel(raw: string): string {
  const text = raw.replace(/_+/g, ' ').replace(/\s+/g, ' ').replace(/\s+\?/g, '?').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : raw;
}

/** Answers come the same way (`automotive_dealer_/_reseller`). Links and e-mails are left alone. */
export function readableSheetValue(raw: string): string {
  if (!raw.includes('_') || /\s|@|:\/\//.test(raw)) return raw;
  return readableSheetLabel(raw);
}
