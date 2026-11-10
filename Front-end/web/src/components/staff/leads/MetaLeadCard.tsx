'use client';

import { useState } from 'react';
import type { InfiniteData } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Clock, FileText, Hand, Link2, Loader2, Mail, MessageSquarePlus, Phone, UserRoundX } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { errorMessage } from '@/components/staff/sales/types';
import { listField } from '@/components/panel/ListControls';
import RichText from '@/components/ui/RichText';
import FollowUpRecorder, { type FollowUpWrite } from './FollowUpRecorder';
import { followUpOption } from './followUpStatus';
import { metaLeadDate, type MetaLead, type MetaLeadDetail, type MetaLeadPage, type MetaLeadPeople, type MetaLeadYou } from './metaLeadTypes';

type Write = FollowUpWrite<MetaLead>;

/** Put the server's answer for one lead into every cached page that shows it. */
function patchRow(queryClient: ReturnType<typeof useQueryClient>, lead: MetaLead) {
  queryClient.setQueriesData<InfiniteData<MetaLeadPage>>({ queryKey: [...staffKeys.metaLeads(), 'list'] }, (data) => data && ({
    ...data,
    pages: data.pages.map((p) => ({ ...p, leads: p.leads.map((r) => (r.id === lead.id ? lead : r)) })),
  }));
}

// A Meta lead has no Won / Lost of its own: the status is simply the latest word.
const HINTS = { converted: 'Agreed to buy', not_interested: 'Does not want it. You can change this later' };

const secondaryButton = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

/** What the sales team typed in the sheet, kept as read-only history. */
function FromTheSheet({ lead }: { lead: MetaLead }) {
  const lines = [
    { label: 'Sales person', value: lead.salesPerson },
    { label: 'Status', value: lead.status },
    { label: 'Follow-up 1', value: lead.followUp1 },
    { label: 'Follow-up 2', value: lead.followUp2 },
  ].filter((l) => l.value);
  if (!lines.length) return null;
  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">From the sheet</p>
      <dl className="mt-1 space-y-0.5 text-sm text-gray-700">
        {lines.map((l) => <div key={l.label} className="break-words"><dt className="inline text-gray-500">{l.label}: </dt><dd className="inline">{l.value}</dd></div>)}
      </dl>
    </div>
  );
}

/** One enquiry: who is following up, the Follow up button, how it went. The server decides who may do each. */
export default function MetaLeadCard({ lead, you, members, onDetails }: {
  lead: MetaLead;
  you: MetaLeadYou;
  members: MetaLeadPeople['members'];
  onDetails: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const path = `/staff/meta-leads/${encodeURIComponent(lead.id)}`;

  const history = useQuery({
    queryKey: staffKeys.metaLeadOne(lead.id),
    queryFn: () => apiClient.get<{ lead: MetaLeadDetail }>(path),
    enabled: open,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: staffKeys.metaLeads() });
  const done = (res: Write) => { patchRow(queryClient, res.lead); setNotice(''); setError(''); refresh(); };
  // Never optimistic. Losing a race is a 409 that still carries the lead: the card shows who has it.
  const settle = (fallback: string) => (e: unknown) => {
    const body = (e as { rawData?: Write })?.rawData;
    if (body?.lead) { patchRow(queryClient, body.lead); setNotice(body.message || ''); setError(''); } else setError(errorMessage(e, fallback));
    refresh();
  };

  const follow = useMutation({
    mutationFn: () => apiClient.post<Write>(`${path}/follow-up`, {}),
    // Taking a lead opens "How did it go?" straight away: every follow-up gets a status.
    onSuccess: (res) => { done(res); setRecording(true); },
    onError: settle('Could not take this lead. Please try again.'),
  });
  const release = useMutation({
    mutationFn: () => apiClient.post<Write>(`${path}/release`, {}),
    onSuccess: done,
    onError: settle('Could not give this lead back.'),
  });
  const reassign = useMutation({
    mutationFn: (userId: string) => apiClient.post<Write>(`${path}/reassign`, { userId }),
    onSuccess: (res) => { setMoveTo(''); done(res); },
    onError: settle('Could not move this lead.'),
  });
  const busy = follow.isPending || release.isPending || reassign.isPending;

  const f = lead.followingUp;
  const mayRecord = !!f && (f.mine || you.canManage);
  const fu = lead.followUpStatus ? followUpOption(lead.followUpStatus.status) : null;
  const onRecorded = (res: Write) => {
    patchRow(queryClient, res.lead);
    setNotice(res.warning || '');
    setError('');
    if (res.success !== false) setRecording(false);
    refresh();
  };

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4" data-testid="meta-lead-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 break-words text-base font-semibold text-gray-900">{lead.name || 'No name'}</p>
            {fu && lead.followUpStatus && (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${fu.tone}`}
                title={lead.followUpStatus.at ? `Last follow-up ${formatDateTimeIST(lead.followUpStatus.at)}` : 'Last follow-up'}>
                {fu.label}
              </span>
            )}
            {lead.removedFromSheet && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">No longer in the sheet</span>}
          </div>
          {lead.product && <p className="mt-1 break-words text-sm font-medium text-gray-900">{lead.product}</p>}
          <p className="mt-0.5 text-xs text-gray-500">{metaLeadDate(lead)} · {lead.tab}</p>
        </div>

        <div className="shrink-0 sm:text-right">
          {f ? (
            <div>
              <p className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium ${f.mine ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-800'}`}>
                <Hand className="h-4 w-4" aria-hidden /> Following up: {f.mine ? 'You' : f.name}
              </p>
              {f.at && <p className="mt-0.5 text-xs text-gray-500">since {formatDateTimeIST(f.at)}</p>}
              {lead.quietDays > 0 && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  <Clock className="h-3 w-3" aria-hidden /> No update for {lead.quietDays} days
                </p>
              )}
            </div>
          ) : you.canFollowUp ? (
            <button type="button" disabled={busy} onClick={() => follow.mutate()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto">
              {follow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />} Follow up
            </button>
          ) : (
            <p className="text-sm text-gray-500">Unclaimed</p>
          )}
        </div>
      </div>

      {notice && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}

      {(lead.phone || lead.email) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <Phone className="h-4 w-4 text-emerald-700" aria-hidden /> {lead.phone}
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="inline-flex min-w-0 items-center gap-1.5 break-all rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <Mail className="h-4 w-4 shrink-0 text-blue-700" aria-hidden /> {lead.email}
            </a>
          )}
        </div>
      )}
      {lead.contactHidden && !f && you.canFollowUp && <p className="mt-2 text-xs text-gray-500">Click Follow up to see the phone number.</p>}

      {(lead.others.length > 0 || lead.inWebsiteLeads) && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-indigo-800">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {lead.others.map((o) => `Also enquired on ${o.tab}${o.followingUp ? ` (${o.followingUp} following up)` : ''}`).join(' · ')}
            {lead.others.length > 0 && lead.inWebsiteLeads ? ' · ' : ''}
            {lead.inWebsiteLeads ? 'Also in Website leads' : ''}
          </span>
        </p>
      )}

      <FromTheSheet lead={lead} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50">
          {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />} History
        </button>
        {mayRecord && !recording && (
          <button type="button" onClick={() => setRecording(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50">
            <MessageSquarePlus className="h-4 w-4" aria-hidden /> Update follow-up
          </button>
        )}
        <button type="button" onClick={onDetails} aria-label={`${you.canEdit ? 'Edit' : 'View'} ${lead.name || 'lead'}`} className={secondaryButton}>
          <FileText className="h-4 w-4" aria-hidden /> {you.canEdit ? 'Edit details' : 'Details'}
        </button>
        {f && (f.mine || you.canManage) && (
          <button type="button" disabled={busy} className={secondaryButton}
            onClick={() => { if (window.confirm(f.mine ? 'Stop following up? The lead goes back to Unclaimed for anyone to take.' : `Take this lead off ${f.name}? It goes back to Unclaimed.`)) release.mutate(); }}>
            <UserRoundX className="h-4 w-4" aria-hidden /> {f.mine ? 'Stop following up' : 'Make free'}
          </button>
        )}
        {you.canManage && members && members.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-2">
            <select aria-label="Move this lead to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={listField}>
              <option value="">Move to…</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </select>
            <button type="button" disabled={busy || !moveTo} onClick={() => reassign.mutate(moveTo)} className={secondaryButton}>
              {reassign.isPending ? 'Moving…' : 'Move'}
            </button>
          </span>
        )}
      </div>

      {recording && mayRecord && <FollowUpRecorder<MetaLead> path={path} hints={HINTS} onSaved={onRecorded} onClose={() => setRecording(false)} />}

      {open && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3">
          {history.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {history.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(history.error, 'Could not load the history.')}</p>}
          {history.data && (history.data.lead.history.length === 0
            ? <p className="text-sm text-gray-500">No follow-ups recorded on the website yet.</p>
            : (
              <ol className="space-y-2">
                {history.data.lead.history.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className={h.followUpStatus ? `rounded-full border px-2 py-0.5 text-xs font-semibold ${followUpOption(h.followUpStatus)?.tone ?? ''}` : 'font-medium text-gray-900'}>{h.label}</span>
                    {h.who && <span className="text-gray-700"> · {h.who}</span>}
                    <span className="text-gray-500"> · {formatDateTimeIST(h.at)}</span>
                    {h.notes && <RichText value={h.notes} className="text-gray-600" />}
                  </li>
                ))}
              </ol>
            ))}
        </div>
      )}
    </li>
  );
}
