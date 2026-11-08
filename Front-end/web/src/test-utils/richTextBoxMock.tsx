/**
 * A textarea stand-in for <RichTextBox> in screen tests. jsdom cannot type into
 * ProseMirror's contenteditable, so screens that only need "words go in, onChange
 * fires" use this; the real editor is tested in components/ui/richText.test.tsx.
 *
 *   jest.mock('@/components/ui/RichTextBox', () => require('@/test-utils/richTextBoxMock'));
 *
 * Same props and handle as the real box; the value is passed through as typed.
 */
import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { RichTextBoxHandle, RichTextBoxProps } from '@/components/ui/RichTextBoxEditor';

const RichTextBoxMock = forwardRef<RichTextBoxHandle, RichTextBoxProps>(function RichTextBoxMock(
  { value, onChange, ariaLabel, placeholder, autoFocus, disabled, onSubmit, onKeyDownFirst, onCaretText, footer, id, onBlur },
  ref,
) {
  const el = useRef<HTMLTextAreaElement>(null);
  const before = () => (el.current ? el.current.value.slice(0, el.current.selectionStart ?? el.current.value.length) : '');
  useImperativeHandle(ref, () => ({
    focus: () => el.current?.focus(),
    clear: () => onChange(''),
    textBeforeCaret: before,
    replaceBeforeCaret: (n, text) => {
      const t = el.current;
      if (!t) return;
      const caret = t.selectionStart ?? t.value.length;
      onChange(`${t.value.slice(0, Math.max(caret - n, 0))}${text}${t.value.slice(caret)}`);
    },
    editor: null,
  }));
  return (
    <div>
      <textarea
        ref={el}
        id={id}
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(e) => {
          onChange(e.target.value);
          onCaretText?.(e.target.value.slice(0, e.target.selectionStart ?? e.target.value.length));
        }}
        onKeyDown={(e) => {
          if (onKeyDownFirst?.(e.nativeEvent)) { e.preventDefault(); return; }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
        }}
      />
      {footer}
    </div>
  );
});

export default RichTextBoxMock;
