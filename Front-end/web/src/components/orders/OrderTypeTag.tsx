/**
 * Which way the money goes, as a tag the team can read at a glance.
 *
 *   Purchase order    — a customer buying from us (website or a GTM sale).
 *   Procurement order — us buying from a supplier (a supplier payment request).
 *
 * Two clearly different colours, because the two are easy to mix up in
 * conversation ("the order for the Hilux kit") and act on the wrong one. Sky and
 * purple, not blue: inside the panels `blue-*` is the green primary colour
 * (components/panel/panel.css), and both of these have dark-theme twins there.
 * An expense (fuel, courier, tools) is neither and gets no tag.
 */
export type OrderType = 'purchase' | 'procurement';

const TAGS: Record<OrderType, { label: string; title: string; tone: string }> = {
  purchase: {
    label: 'Purchase order',
    title: 'A customer buying from us',
    tone: 'border-sky-200 bg-sky-50 text-sky-800',
  },
  procurement: {
    label: 'Procurement order',
    title: 'Us buying from a supplier',
    tone: 'border-purple-200 bg-purple-50 text-purple-800',
  },
};

export default function OrderTypeTag({ type, className = '' }: { type: OrderType; className?: string }) {
  const t = TAGS[type];
  return (
    <span
      title={t.title}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${t.tone} ${className}`}
    >
      {t.label}
    </span>
  );
}
