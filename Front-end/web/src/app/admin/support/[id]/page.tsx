'use client';

/**
 * Ticket detail — the conversation, plus the customer context beside it.
 *
 * The context sidebar is the whole reason this is built in-house rather than
 * bought: the agent can see the order, its value and its status without leaving
 * the reply box, so they stop asking customers for order numbers they already
 * gave us.
 *
 * SECURITY: `bodyHtml` is attacker-controlled markup from inbound email. It is
 * sanitised server-side (services/supportSanitizer.js) AND rendered here inside
 * a sandboxed iframe, never with dangerouslySetInnerHTML — a sandboxed iframe
 * with no allow-scripts and no allow-same-origin cannot reach this page's DOM,
 * cookies or session even if the sanitiser were bypassed. Do not "simplify" this
 * into an inline div.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { formatDateTimeIST } from '@/lib/datetime';
import {
  ADMIN_STATUS_LABELS,
  CHANNEL_LABELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  PRIORITY_LABELS,
  type TicketChannel,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/supportConstants';

interface Attachment {
  publicId: string;
  fileName: string;
  contentType: string;
  bytes: number;
  url: string;
}

interface Message {
  _id: string;
  direction: 'inbound' | 'outbound';
  visibility: 'public' | 'internal';
  author: { name?: string; email?: string; isAgent?: boolean };
  bodyText: string;
  bodyHtml?: string;
  attachments?: Attachment[];
  rejectedAttachments?: { fileName: string; reason: string }[];
  isAutoReply?: boolean;
  deliveryStatus?: string;
  createdAt: string;
}

interface Ticket {
  _id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  requester: { name?: string; email: string; phone?: string; user?: { _id: string; name: string } | null };
  assignee?: { _id: string; name: string } | null;
  order?: { _id: string; orderNumber?: string; totalAmount?: number; status?: string; createdAt?: string } | null;
  returnRequest?: { _id: string; status?: string } | null;
  product?: { _id: string; name: string; slug: string } | null;
  requesterVerified: boolean;
  firstResponseDueAt?: string | null;
  firstRespondedAt?: string | null;
  createdAt: string;
}

export default function AdminTicketPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: { ticket: Ticket; messages: Message[] } }>(
        `/support/admin/tickets/${id}`
      );
      setTicket(res.data.ticket);
      setMessages(res.data.messages || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await apiClient.patch(`/support/admin/tickets/${id}`, body);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const send = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await apiClient.post(`/support/admin/tickets/${id}/reply`, {
        message: reply.trim(),
        internal,
      });
      setReply('');
      // A public reply is delivered by the queue worker, which writes the
      // message record when it sends. Reload after a beat so the thread shows it.
      setTimeout(load, internal ? 0 : 1200);
      if (internal) await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <p className="p-8 text-center text-gray-500">Loading…</p>;
  if (!ticket) return <p className="p-8 text-center text-red-600">{error || 'Ticket not found'}</p>;

  return (
    <div className="p-6">
      <button
        onClick={() => router.push('/admin/support')}
        className="text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        ← Back to inbox
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Conversation ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="font-mono text-xs text-gray-500">{ticket.reference}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                {CHANNEL_LABELS[ticket.channel]}
              </span>
              {!ticket.requesterVerified && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800"
                  title="Sender identity is unverified — an email From: header is trivially forged. Confirm identity before disclosing order details."
                >
                  Unverified sender
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-gray-900">{ticket.subject}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {ticket.requester.name || 'Unknown'} · {ticket.requester.email}
              {ticket.requester.phone && ` · ${ticket.requester.phone}`}
            </p>
          </div>

          <div className="space-y-3">
            {messages.map((m) => (
              <MessageBubble key={m._id} message={m} />
            ))}
            <div ref={threadEnd} />
          </div>

          {/* ── Reply box ──────────────────────────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-4 mb-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={!internal}
                  onChange={() => setInternal(false)}
                />
                Reply to customer
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={internal}
                  onChange={() => setInternal(true)}
                />
                Internal note
              </label>
            </div>

            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={5}
              placeholder={internal
                ? 'Visible to your team only — never sent to the customer.'
                : 'Write your reply. It will be emailed from support@autobacsindia.com.'}
              className={`w-full border rounded-md p-3 text-sm outline-none focus:ring-2 ${
                internal
                  ? 'bg-yellow-50 border-yellow-300 focus:ring-yellow-200'
                  : 'border-gray-300 focus:ring-gray-200'
              }`}
            />

            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

            <div className="flex justify-end mt-3">
              <button
                onClick={send}
                disabled={sending || !reply.trim()}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md disabled:opacity-40"
              >
                {sending ? 'Sending…' : internal ? 'Add note' : 'Send reply'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Context sidebar ──────────────────────────────────────────── */}
        <div className="space-y-4">
          <Panel title="Ticket">
            <Field label="Status">
              <select
                value={ticket.status}
                onChange={(e) => patch({ status: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              >
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>{ADMIN_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={ticket.priority}
                onChange={(e) => patch({ priority: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              >
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </Field>
            <Field label="Assignee">
              <span className="text-sm text-gray-700">
                {ticket.assignee?.name || <span className="text-amber-600">Unassigned</span>}
              </span>
            </Field>
            <Field label="Opened">
              <span className="text-sm text-gray-700">{formatDateTimeIST(ticket.createdAt)}</span>
            </Field>
            {ticket.firstResponseDueAt && !ticket.firstRespondedAt && (
              <Field label="First reply due">
                <span className={`text-sm ${
                  new Date(ticket.firstResponseDueAt) < new Date()
                    ? 'text-red-600 font-semibold'
                    : 'text-gray-700'
                }`}>
                  {formatDateTimeIST(ticket.firstResponseDueAt)}
                </span>
              </Field>
            )}
          </Panel>

          {ticket.order && (
            <Panel title="Linked order">
              <Field label="Order">
                <Link
                  href={`/admin/orders/${ticket.order._id}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {ticket.order.orderNumber || ticket.order._id.slice(-8)}
                </Link>
              </Field>
              {ticket.order.status && <Field label="Status"><span className="text-sm">{ticket.order.status}</span></Field>}
              {typeof ticket.order.totalAmount === 'number' && (
                <Field label="Value">
                  <span className="text-sm">₹{ticket.order.totalAmount.toLocaleString('en-IN')}</span>
                </Field>
              )}
              {ticket.order.createdAt && (
                <Field label="Placed"><span className="text-sm">{formatDateTimeIST(ticket.order.createdAt)}</span></Field>
              )}
            </Panel>
          )}

          {ticket.returnRequest && (
            <Panel title="Linked return">
              <Field label="Return">
                <Link href="/admin/returns" className="text-sm text-blue-600 hover:underline">
                  {ticket.returnRequest.status || 'View returns'}
                </Link>
              </Field>
            </Panel>
          )}

          {ticket.product && (
            <Panel title="Linked product">
              <Link
                href={`/admin/products/${ticket.product._id}`}
                className="text-sm text-blue-600 hover:underline"
              >
                {ticket.product.name}
              </Link>
            </Panel>
          )}

          {ticket.requester.user && (
            <Panel title="Customer account">
              <Link
                href={`/admin/users?q=${encodeURIComponent(ticket.requester.email)}`}
                className="text-sm text-blue-600 hover:underline"
              >
                {ticket.requester.user.name}
              </Link>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {children}
    </div>
  );
}

function MessageBubble({ message: m }: { message: Message }) {
  const [showHtml, setShowHtml] = useState(false);

  if (m.visibility === 'internal') {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-xs text-yellow-800 mb-1">
          Internal note · {m.author.name || 'Agent'} · {formatDateTimeIST(m.createdAt)}
        </p>
        <p className="text-sm text-gray-800 whitespace-pre-wrap">{m.bodyText}</p>
      </div>
    );
  }

  const fromCustomer = m.direction === 'inbound';

  return (
    <div className={`border rounded-lg p-4 ${
      fromCustomer ? 'bg-white border-gray-200' : 'bg-blue-50 border-blue-200'
    }`}>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <p className="text-xs text-gray-500">
          {fromCustomer ? (m.author.name || m.author.email || 'Customer') : `${m.author.name || 'Support'} (us)`}
          {' · '}{formatDateTimeIST(m.createdAt)}
          {m.isAutoReply && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">auto-reply</span>
          )}
        </p>
        {m.deliveryStatus === 'bounced' && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
            Bounced — customer did not receive this
          </span>
        )}
      </div>

      <p className="text-sm text-gray-800 whitespace-pre-wrap">{m.bodyText}</p>

      {m.bodyHtml && (
        <div className="mt-3">
          <button
            onClick={() => setShowHtml((v) => !v)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showHtml ? 'Hide' : 'Show'} original formatting
          </button>
          {showHtml && (
            /*
             * Sandboxed with NO allow-scripts and NO allow-same-origin: the
             * frame gets a unique opaque origin, so nothing inside can execute
             * script or touch this document. This is the second layer behind
             * server-side sanitisation — keep both.
             */
            <iframe
              title="Original message"
              sandbox=""
              srcDoc={m.bodyHtml}
              className="w-full h-80 mt-2 border border-gray-200 rounded bg-white"
            />
          )}
        </div>
      )}

      {!!m.attachments?.length && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <a
              key={a.publicId}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
            >
              📎 {a.fileName} ({Math.round(a.bytes / 1024)} KB)
            </a>
          ))}
        </div>
      )}

      {!!m.rejectedAttachments?.length && (
        <div className="mt-2 text-xs text-amber-700">
          {m.rejectedAttachments.map((r, i) => (
            <p key={i}>⚠️ Rejected attachment &ldquo;{r.fileName}&rdquo; — {r.reason}</p>
          ))}
        </div>
      )}
    </div>
  );
}
