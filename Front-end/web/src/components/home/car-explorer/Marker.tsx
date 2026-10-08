/**
 * One clickable point on the car: a numbered gold dot (so it reads as a button,
 * not a decoration) with a label pill that shows when the point is active —
 * highlighted from the side panel, hovered, or focused. Used by both the 3D view
 * and the still fallback so the two look and behave the same.
 */
export default function MarkerDot({ n, label, active }: { n: number; label: string; active: boolean }) {
  return (
    <>
      <span className="relative flex h-6 w-6 items-center justify-center md:h-8 md:w-8">
        <span className={`absolute inline-flex h-full w-full rounded-full bg-gold ${active ? 'animate-ping opacity-70' : 'opacity-25'}`} />
        <span
          className={`relative inline-flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold md:h-7 md:w-7 md:text-[11px] shadow-[0_4px_14px_rgba(0,0,0,0.6)] transition-transform ${
            active ? 'scale-110 border-white bg-gold text-[#111212]' : 'border-white/90 bg-[#111212]/85 text-gold group-hover/mk:scale-110 group-hover/mk:bg-gold group-hover/mk:text-[#111212]'
          }`}
        >
          {n}
        </span>
      </span>
      <span
        className={`pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold/40 bg-[#0d0e0e]/95 px-3 py-1 text-xs font-semibold text-[#f0ede7] shadow-lg transition-opacity group-hover/mk:opacity-100 group-focus-visible/mk:opacity-100 ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {label} →
      </span>
    </>
  );
}
