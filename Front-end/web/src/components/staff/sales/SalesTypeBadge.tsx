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
          {info.label} approved by {c.byName || (c.role === 'admin' ? 'the admin' : 'accounts')}
          {c.at ? ` on ${formatDateTimeIST(c.at)}` : ''}{c.note ? `: “${c.note}”` : ''}
        </p>
      )}
    </div>
  );
}
