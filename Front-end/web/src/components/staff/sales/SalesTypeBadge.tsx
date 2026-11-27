import { formatDateTimeIST } from '@/lib/datetime';
import type { SalesTypeInfo } from './types';

const TONE: Record<SalesTypeInfo['type'], string> = {
  b2b: 'bg-indigo-100 text-indigo-800',
  b2c: 'bg-teal-100 text-teal-800',
};

/**
 * B2B / B2C on a GTM order or quotation, with the server's short reason
 * ("Retail order — offer applied: 10% off (Black Friday).") and, with `detail`,
 * where accounts' check stands. Everything shown comes from the server.
 */
export default function SalesTypeBadge({ info, detail = false }: { info: SalesTypeInfo | null | undefined; detail?: boolean }) {
  if (!info) return null;
  const c = info.check;
  return (
    <div className="space-y-0.5" data-testid="sales-type">
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-bold ${TONE[info.type]}`}>{info.label}</span>
        <span className="text-gray-700">{info.reason}</span>
      </p>
      {info.company && (info.company.legalName || info.company.gstin) && (
        <p className="text-xs text-gray-600">{info.company.legalName}{info.company.gstin ? ` · GSTIN ${info.company.gstin}` : ''}</p>
      )}
      {detail && info.type === 'b2c' && (
        <p className="text-xs text-gray-500">Ship before payment: not available — retail (B2C) order.</p>
      )}
      {detail && c?.status === 'pending' && (
        <p className="text-xs font-medium text-amber-700">Waiting for accounts to approve {info.label}.</p>
      )}
      {detail && c?.status === 'approved' && (
        <p className="text-xs text-green-800">
          {c.changes?.length ? 'First approved' : `${info.label} approved`} by {c.byName || (c.role === 'admin' ? 'the admin' : 'accounts')}
          {c.at ? ` on ${formatDateTimeIST(c.at)}` : ''}{c.note ? `: “${c.note}”` : ''}
        </p>
      )}
      {info.alert && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs font-medium text-red-800">{info.alert}</p>}
      {detail && !!c?.changes?.length && (
        <div className="pt-1">
          <p className="text-xs font-semibold text-gray-700">Type changes</p>
          <ol className="mt-1 space-y-1 border-l-2 border-gray-200 pl-3" aria-label="Type changes">
            {c.changes.map((ch, i) => (
              <li key={`${ch.at}-${i}`} className="text-xs text-gray-700">
                <span className="font-semibold">{ch.fromLabel} → {ch.toLabel}</span>
                {' '}by {ch.byName || (ch.role === 'admin' ? 'the admin' : 'accounts')}
                {ch.at ? ` on ${formatDateTimeIST(ch.at)}` : ''}: “{ch.reason}”
                {ch.payLaterNote && <span className="block text-amber-800">{ch.payLaterNote}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
