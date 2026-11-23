'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, FileText } from 'lucide-react';
import { listSuppliers, supplierKeys } from '@/components/payments/suppliers';
import {
  ACCOUNT_STATUS_LABEL, accountAction, approveAccount, documentUrl, errorMessage, getAccount, listAccounts, partnerKeys,
  type AccountAction, type AccountDetail, type AccountStatus, type PossibleSupplier,
} from './api';
import { Empty, Loading, LoadError, MoreButton, NoteAction, Pills, btn, when } from './ui';

const TABS = [
  ['in_review', 'Waiting'], ['changes_requested', 'Asked to fix'], ['approved', 'Approved'], ['suspended', 'Paused'], ['rejected', 'Rejected'],
] as const;

/** Supplier sign-ups from the Autobacs Partner app: the queue, then one at a time. */
export default function Accounts({ openId, onOpen }: { openId: string; onOpen: (id: string) => void }) {
  if (openId) return <AccountView id={openId} onBack={() => onOpen('')} />;
  return <AccountQueue onOpen={onOpen} />;
}

function AccountQueue({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState<AccountStatus>('in_review');
  const q = useInfiniteQuery({
    queryKey: partnerKeys.accounts(status),
    queryFn: ({ pageParam }) => listAccounts(status, pageParam),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-3">
      <Pills label="Which suppliers" value={status} options={TABS} onChange={setStatus} />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} retry={() => q.refetch()} what="suppliers" />}
      {q.isSuccess && rows.length === 0 && <Empty>No suppliers here.</Empty>}
      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onOpen(a.id)} className="block w-full rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-blue-300 hover:bg-blue-50/30">
              <span className="font-semibold text-gray-900">{a.companyName}</span>
              <span className="block text-sm text-gray-600">{a.contactName} · {a.phone}{a.city ? ` · ${a.city}` : ''}</span>
              <span className="block text-xs text-gray-500">Sent {when(a.submittedAt)}{a.reviewedByName ? ` · decided by ${a.reviewedByName}` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      <MoreButton hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (<><dt className="text-gray-500">{label}</dt><dd className="break-words text-gray-900">{value || '—'}</dd></>);
}

function AccountView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: partnerKeys.account(id), queryFn: () => getAccount(id) });
  const [notice, setNotice] = useState('');
  const act = useMutation({
    mutationFn: ({ action, note }: { action: AccountAction; note: string }) => accountAction(id, action, note),
    onSuccess: (r) => { qc.setQueryData(partnerKeys.account(id), (old: AccountDetail | undefined) => (old ? { ...old, ...r.account } : old)); qc.invalidateQueries({ queryKey: partnerKeys.all }); },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} retry={() => q.refetch()} what="the supplier" />;
  const a = q.data;
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><ArrowLeft className="h-4 w-4" /> All suppliers</button>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">{a.companyName}</h2>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">{ACCOUNT_STATUS_LABEL[a.status]}</span>
        </div>
        {a.reviewNote && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Note to supplier: {a.reviewNote}</p>}
        <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <Field label="Contact" value={a.contactName} />
          <Field label="Phone" value={a.phone} />
          <Field label="Email" value={a.email} />
          <Field label="Address" value={[a.address, a.city].filter(Boolean).join(', ')} />
          <Field label="GST number" value={a.gstin} />
          <Field label="PAN" value={a.pan} />
          <Field label="Bank account" value={a.bank.accountNumber ? `${a.bank.accountName} · ${a.bank.accountNumber} · ${a.bank.ifsc}` : ''} />
          <Field label="UPI" value={a.bank.upiId} />
          {a.linkedSupplier && <Field label="Linked supplier" value={a.linkedSupplier.name} />}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['gst-certificate', 'cancelled-cheque'] as const).map((kind) => {
            const has = kind === 'gst-certificate' ? a.documents.gstCertificate : a.documents.cancelledCheque;
            return has
              ? <a key={kind} href={documentUrl(a.id, kind)} target="_blank" rel="noopener noreferrer" className={btn.secondary}><FileText className="h-4 w-4" /> {kind === 'gst-certificate' ? 'GST certificate' : 'Cancelled cheque'}</a>
              : <span key={kind} className="text-xs text-gray-500">{kind === 'gst-certificate' ? 'No GST certificate' : 'No cancelled cheque'}</span>;
          })}
        </div>
      </div>

      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {act.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(act.error, 'Could not save.')}</p>}

      {a.status === 'in_review' && (
        <>
          <ApproveBox account={a} onDone={(msg) => { setNotice(msg); }} />
          <div className="flex flex-wrap gap-2">
            <NoteAction label="Ask to fix" title="What should they fix?" hint="The supplier sees this in the app and can send again."
              placeholder="e.g. The GST certificate photo is blurry — please send a clear one." busy={act.isPending}
              onSubmit={(note) => act.mutate({ action: 'request-changes', note })} />
            <NoteAction danger label="Reject" title="Why are we not taking this supplier?" hint="Final. The supplier is signed out and sees the reason."
              placeholder="e.g. We only work with registered parts dealers." busy={act.isPending}
              onSubmit={(note) => act.mutate({ action: 'reject', note })} />
          </div>
        </>
      )}
      {a.status === 'changes_requested' && (
        <NoteAction danger label="Reject" title="Why are we not taking this supplier?" hint="Final. The supplier is signed out and sees the reason."
          placeholder="e.g. Documents never sent." busy={act.isPending} onSubmit={(note) => act.mutate({ action: 'reject', note })} />
      )}
      {a.status === 'approved' && (
        <NoteAction danger label="Pause supplier" title="Why pause them?" hint="They are signed out and cannot change listings until unpaused. Their live products stay as they are."
          placeholder="e.g. Stock was wrong three times this month." busy={act.isPending} onSubmit={(note) => act.mutate({ action: 'suspend', note })} />
      )}
      {a.status === 'suspended' && (
        <button type="button" className={btn.primary} disabled={act.isPending} onClick={() => act.mutate({ action: 'unsuspend', note: '' })}>Unpause supplier</button>
      )}
    </div>
  );
}

/** Approve: link to a supplier we already pay, or add a new one from their details. */
export function ApproveBox({ account, onDone }: { account: AccountDetail; onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'link' | 'new'>(account.possibleSuppliers.length ? 'link' : 'new');
  const [picked, setPicked] = useState<PossibleSupplier | null>(account.possibleSuppliers[0] ?? null);
  const [search, setSearch] = useState('');
  const [copyBank, setCopyBank] = useState(false);
  const found = useQuery({
    queryKey: supplierKeys.list({ prefix: search }),
    queryFn: () => listSuppliers({ prefix: search }),
    enabled: mode === 'link' && search.trim().length >= 2,
  });
  const options: PossibleSupplier[] = search.trim().length >= 2
    ? (found.data?.suppliers ?? []).map((s) => ({ id: s.id, name: s.name, gstin: s.gstin, phone: s.phone, accountMasked: s.payment.accountMasked ?? '', ifsc: s.payment.ifsc ?? '', upiId: s.payment.upiId ?? '' }))
    : account.possibleSuppliers;
  const appLast4 = account.bank.accountLast4;
  const bankDiffers = !!picked && (appLast4 || account.bank.upiId)
    && !((appLast4 && picked.accountMasked.endsWith(appLast4) && picked.ifsc === account.bank.ifsc) || (account.bank.upiId && picked.upiId === account.bank.upiId));

  const approve = useMutation({
    mutationFn: () => approveAccount(account.id, mode === 'new' ? { mode: 'new' } : { mode: 'link', supplierId: picked!.id, copyBank }),
    onSuccess: (r) => {
      qc.setQueryData(partnerKeys.account(account.id), r.account);
      qc.invalidateQueries({ queryKey: partnerKeys.all });
      qc.invalidateQueries({ queryKey: supplierKeys.all });
      onDone(r.bankChanged
        ? 'Approved. The supplier\'s bank details changed — accounts will see a warning on the next payment.'
        : 'Approved. The supplier can now list products.');
    },
  });

  return (
    <section aria-label="Approve supplier" className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <h3 className="flex items-center gap-2 font-semibold text-gray-900"><Building2 className="h-4 w-4" /> Approve</h3>
      <p className="text-xs text-gray-600">Every app supplier is tied to one supplier in our Suppliers list (that is where we pay them). If we already buy from them, link them; otherwise add them as new.</p>
      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-4">
        <label className="flex items-center gap-2"><input type="radio" name="approve-mode" checked={mode === 'link'} onChange={() => setMode('link')} /> We already buy from them — link</label>
        <label className="flex items-center gap-2"><input type="radio" name="approve-mode" checked={mode === 'new'} onChange={() => setMode('new')} /> Add as a new supplier</label>
      </div>

      {mode === 'link' && (
        <div className="space-y-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search our suppliers by name, e.g. Ravi Motors"
            aria-label="Search suppliers" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
          {options.length === 0 && <p className="text-xs text-gray-500">{search.trim().length >= 2 ? 'No supplier with that name.' : 'Type a name to find the supplier.'}</p>}
          <ul className="space-y-1" role="listbox" aria-label="Suppliers">
            {options.map((s) => (
              <li key={s.id}>
                <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${picked?.id === s.id ? 'border-blue-400 bg-white' : 'border-gray-200 bg-white'}`}>
                  <input type="radio" name="link-supplier" checked={picked?.id === s.id} onChange={() => setPicked(s)} />
                  <span><span className="font-medium">{s.name}</span><span className="block text-xs text-gray-500">{[s.gstin, s.phone, s.accountMasked && `A/c ${s.accountMasked}`, s.upiId].filter(Boolean).join(' · ')}</span></span>
                </label>
              </li>
            ))}
          </ul>
          {picked && bankDiffers && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p>The bank details in the app are different from what we have for {picked.name}.</p>
              <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={copyBank} onChange={(e) => setCopyBank(e.target.checked)} /> Use the app&apos;s bank details (accounts will see a &quot;bank details changed&quot; warning)</label>
            </div>
          )}
        </div>
      )}
      {mode === 'new' && <p className="text-sm text-gray-700">A new supplier &quot;{account.companyName}&quot; will be added to Suppliers with their GST number and bank details from the app.</p>}

      {approve.isError && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{errorMessage(approve.error, 'Could not approve.')}</p>}
      <button type="button" className={btn.primary} disabled={approve.isPending || (mode === 'link' && !picked)} onClick={() => approve.mutate()}>
        {approve.isPending ? 'Approving…' : 'Approve supplier'}
      </button>
    </section>
  );
}
