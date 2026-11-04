'use client';

import { useRef } from 'react';
import { usePasteFiles } from '@/hooks/usePasteFiles';
import { acceptsFile } from '@/lib/attachments';
import PasteHint from './PasteHint';

/**
 * Wrap a plain file input so a screenshot pasted (Ctrl/Cmd+V) while this area was
 * clicked or focused is handed to the same handler as a chosen file. Only files
 * `accept` allows are passed on; with `single`, just the first.
 * The handler keeps doing its own size checks, so a pasted file is held to the
 * same rules as a picked one.
 */
export default function PasteZone({
  accept, onFiles, disabled = false, single = false, hint = true, className, children,
}: {
  accept: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  single?: boolean;
  /** Show "or paste a screenshot (Ctrl+V)" after the children. */
  hint?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const zone = useRef<HTMLDivElement>(null);
  usePasteFiles(zone, {
    accept,
    hasRoom: !disabled,
    take: (files) => {
      if (disabled) return;
      const ok = files.filter((f) => acceptsFile(f, accept));
      if (ok.length) onFiles(single ? ok.slice(0, 1) : ok);
    },
  });
  return (
    <div ref={zone} className={className}>
      {children}
      {hint && !disabled && <div><PasteHint /></div>}
    </div>
  );
}
