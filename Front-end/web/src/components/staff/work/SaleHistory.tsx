import { Paperclip, History } from 'lucide-react';
import { formatDateTimeIST } from '@/lib/datetime';
import type { SaleHistory as SaleHistoryData } from './types';

const WEBSITE = 'Website';

/** A proof file, streamed privately by the server (it re-checks who may open it). */
const proofHref = (orderId: string, fileId: string) =>
  `/api/v1/staff/attribution/orders/${encodeURIComponent(orderId)}/proof/${encodeURIComponent(fileId)}`;

/**
 * Read-only "Sale history" for accounts: the order's origin (e.g. "Website
 * order"), then each change of who is credited with the sale — who changed it,
 * when, the note and the proof. Changing it is admin/marketing's job on the admin
 * order page; nothing here can change it. Renders nothing when the seller never
 * changed.
 */
export default function SaleHistory({ orderId, history }: { orderId: string; history?: SaleHistoryData | null }) {
  if (!history?.changes?.length) return null;
  return (
    <section aria-label="Sale history" className="rounded-lg border border-gray-200 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
        <History className="h-3.5 w-3.5" /> Sale history
      </p>
      <ol className="space-y-2 border-l-2 border-gray-200 pl-3 text-xs text-gray-700">
        <li>
          <span className="font-medium text-gray-900">{history.startedAs}</span>
        </li>
        {history.changes.map((c, i) => (
          <li key={`${c.at}-${i}`} data-testid="sale-change">
            <p>
              <span className="font-medium text-gray-900">{c.from ?? WEBSITE} → {c.to ?? WEBSITE}</span>
              {' · '}changed by {c.by || 'someone'}{' · '}{formatDateTimeIST(c.at)}
            </p>
            {c.note && <p className="mt-0.5 whitespace-pre-line text-gray-600">“{c.note}”</p>}
            {!c.proofRequired && <p className="mt-0.5 text-gray-400">Made before proof was required</p>}
            {c.files.length > 0 && (
              <span className="mt-0.5 flex flex-wrap gap-x-3">
                {c.files.map((f) => (
                  <a key={f.id} href={proofHref(orderId, f.id)} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-700 underline">
                    <Paperclip className="h-3 w-3" />{f.name}
                  </a>
                ))}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
