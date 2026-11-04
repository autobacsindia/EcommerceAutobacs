'use client';

import { usePasteShortcut } from '@/hooks/usePasteFiles';

/**
 * "or paste a screenshot (Ctrl+V)" beside an upload button. Phones have no
 * Ctrl+V, so it only shows for a mouse and keyboard.
 */
export default function PasteHint({ className = '' }: { className?: string }) {
  const shortcut = usePasteShortcut();
  return <span className={`hidden text-xs text-gray-500 pointer-fine:inline ${className}`}>or paste a screenshot ({shortcut})</span>;
}
