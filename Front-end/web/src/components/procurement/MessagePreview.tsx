'use client';

/** The message as WhatsApp shows it: *bold* and _italic_ rendered, in a chat bubble. */
export function MessagePreview({ text }: { text: string }) {
  const render = (line: string, i: number) => {
    const parts = line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).filter(Boolean);
    return (
      <div key={i} className="min-h-[1.25em] whitespace-pre-wrap break-words">
        {parts.map((p, j) => (p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <strong key={j}>{p.slice(1, -1)}</strong>
          : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <em key={j}>{p.slice(1, -1)}</em> : <span key={j}>{p}</span>))}
      </div>
    );
  };
  return (
    <div className="rounded-xl bg-[#e5ddd5] p-3">
      <div className="max-h-[70vh] overflow-y-auto rounded-lg rounded-tl-none bg-[#ffffff] p-3 text-[13px] leading-snug text-[#111b21] shadow-sm" data-testid="wa-preview">
        {text.split('\n').map(render)}
      </div>
    </div>
  );
}
