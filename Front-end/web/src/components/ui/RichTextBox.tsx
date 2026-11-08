'use client';

/**
 * The formatting box, loaded only when one is on screen: the editor (TipTap +
 * ProseMirror, ~120 kB compressed) stays out of pages that only show text, such
 * as the Tasks list. Until it arrives, a box of the same size shows the
 * placeholder, so nothing jumps. See RichTextBoxEditor.tsx for how it works.
 */

import dynamic from 'next/dynamic';
import type { RichTextBoxHandle, RichTextBoxProps } from './RichTextBoxEditor';

export type { RichTextBoxHandle, RichTextBoxProps } from './RichTextBoxEditor';

function Loading() {
  return (
    <div aria-hidden className="rounded-lg border border-gray-200 bg-white">
      <div className="h-9 border-b border-gray-200" />
      <div className="min-h-[3rem] px-3 py-2 text-sm text-gray-400">Loading…</div>
    </div>
  );
}

const RichTextBox = dynamic<RichTextBoxProps & { ref?: React.Ref<RichTextBoxHandle> }>(
  () => import('./RichTextBoxEditor'),
  { ssr: false, loading: Loading },
);

export default RichTextBox;
