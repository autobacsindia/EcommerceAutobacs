'use client';

/**
 * The formatting box for staff/admin panels: notes, descriptions, comments.
 *
 *   <RichTextBox value={notes} onChange={setNotes} ariaLabel="Notes" />
 *
 * - Bold, italic, underline, strikethrough, two heading sizes, bullet / numbered /
 *   tick lists, link, inline code and quote — from the toolbar or the usual keys
 *   (Ctrl/⌘ + B, I, U, K for a link, Ctrl/⌘ + Shift + 7 / 8 / 9 for lists…).
 * - Paste from Word or Google Docs keeps bold, lists and links and drops fonts,
 *   colours and sizes (the editor only knows the formats above).
 * - `value` may be old plain text: it loads line by line, every character kept.
 *   `onChange` gets HTML, or '' when the box is empty, so "required" checks keep working.
 * - The server cleans what is saved (utils/richText.js) and <RichText> cleans it
 *   again before showing it. Never render the value with innerHTML yourself.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import {
  Bold, Italic, Underline, Strikethrough, Heading2, Heading3, List, ListOrdered, ListChecks,
  Link as LinkIcon, Code, Quote, MoreHorizontal,
} from 'lucide-react';
import { richTextToPlain, toEditorHtml } from '@/lib/richText';
import './richText.css';

export interface RichTextBoxHandle {
  focus: () => void;
  clear: () => void;
  /** The words of the current paragraph up to the caret (for "@name" pickers). */
  textBeforeCaret: () => string;
  /** Replace the last `count` characters before the caret with `text`. */
  replaceBeforeCaret: (count: number, text: string) => void;
  editor: Editor | null;
}

export interface RichTextBoxProps {
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Most characters of words allowed (markup is not counted). Shows a counter near the end. */
  maxLength?: number;
  /** Tailwind min-height for the writing area, e.g. 'min-h-[6rem]'. */
  minHeightClass?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Ctrl/⌘ + Enter. */
  onSubmit?: () => void;
  /** Runs before the editor handles a key; return true when you used it (e.g. a picker's arrows). */
  onKeyDownFirst?: (e: KeyboardEvent) => boolean;
  /** Told the words before the caret after every change or caret move. */
  onCaretText?: (textBeforeCaret: string) => void;
  /** No border of its own — for boxes that sit inside a bordered composer. */
  bare?: boolean;
  /** Narrow places (a side panel): the everyday formats in one row, the rest under "More". */
  compact?: boolean;
  /** Shown under the writing area, beside the counter (e.g. attach / send buttons). */
  footer?: ReactNode;
  id?: string;
  className?: string;
  onBlur?: () => void;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function normaliseUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  if (/^[\w-]+(\.[\w-]+)+/.test(s)) return `https://${s}`;
  return null;
}

function askForLink(editor: Editor) {
  const current = editor.getAttributes('link').href as string | undefined;
  const raw = window.prompt('Link address (leave empty to remove the link)', current ?? 'https://');
  if (raw === null) return;
  if (!raw.trim() || raw.trim() === 'https://') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  const href = normaliseUrl(raw);
  if (!href) { window.alert('That does not look like a web address.'); return; }
  if (editor.state.selection.empty && !current) {
    editor.chain().focus().insertContent({ type: 'text', text: raw.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
  } else {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }
}

type Tool = { key: string; label: string; keys: string; icon: typeof Bold; active: (e: Editor) => boolean; run: (e: Editor) => void; gapBefore?: boolean; everyday?: boolean };

const TOOLS: Tool[] = [
  { key: 'bold', label: 'Bold', keys: 'B', icon: Bold, active: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run(), everyday: true },
  { key: 'italic', label: 'Italic', keys: 'I', icon: Italic, active: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run(), everyday: true },
  { key: 'underline', label: 'Underline', keys: 'U', icon: Underline, active: (e) => e.isActive('underline'), run: (e) => e.chain().focus().toggleUnderline().run(), everyday: true },
  { key: 'strike', label: 'Strikethrough', keys: 'Shift+S', icon: Strikethrough, active: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
  { key: 'h2', label: 'Heading', keys: 'Alt+2', icon: Heading2, active: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), gapBefore: true },
  { key: 'h3', label: 'Small heading', keys: 'Alt+3', icon: Heading3, active: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { key: 'bullets', label: 'Bullet list', keys: 'Shift+8', icon: List, active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run(), gapBefore: true, everyday: true },
  { key: 'numbers', label: 'Numbered list', keys: 'Shift+7', icon: ListOrdered, active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run(), everyday: true },
  { key: 'checks', label: 'Checklist', keys: 'Shift+9', icon: ListChecks, active: (e) => e.isActive('taskList'), run: (e) => e.chain().focus().toggleTaskList().run(), everyday: true },
  { key: 'link', label: 'Link', keys: 'K', icon: LinkIcon, active: (e) => e.isActive('link'), run: askForLink, gapBefore: true, everyday: true },
  { key: 'code', label: 'Code', keys: 'E', icon: Code, active: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
  { key: 'quote', label: 'Quote', keys: 'Shift+B', icon: Quote, active: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
];

const RichTextBox = forwardRef<RichTextBoxHandle, RichTextBoxProps>(function RichTextBox(
  {
    value, onChange, ariaLabel, placeholder, maxLength, minHeightClass = 'min-h-[5rem]', autoFocus, disabled,
    onSubmit, onKeyDownFirst, onCaretText, bare, compact, footer, id, className = '', onBlur,
  },
  ref,
) {
  // The last value this box sent up, so a parent echoing it back doesn't reset the caret.
  const sent = useRef<string>(value);
  // Latest callbacks for the editor's handlers, which are created once.
  const cb = useRef({ onChange, onSubmit, onKeyDownFirst, onCaretText, onBlur });
  cb.current = { onChange, onSubmit, onKeyDownFirst, onCaretText, onBlur };
  const [count, setCount] = useState(() => richTextToPlain(value).length);
  const [, force] = useState(0);
  const [more, setMore] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    autofocus: autoFocus ? 'end' : false,
    content: toEditorHtml(value),
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        horizontalRule: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto', 'tel'] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': ariaLabel,
        ...(id ? { id } : {}),
        class: `rt rt-edit ${minHeightClass} px-3 py-2 text-sm text-gray-800 outline-none`,
      },
      // Word / Google Docs headings: the box has two sizes, so 1 → big and 4–6 → small.
      transformPastedHTML: (html) => html.replace(/<(\/?)h1(\s|>)/gi, '<$1h2$2').replace(/<(\/?)h[4-6](\s|>)/gi, '<$1h3$2'),
      handleKeyDown: (_view, e) => {
        if (cb.current.onKeyDownFirst?.(e)) return true;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && cb.current.onSubmit) { e.preventDefault(); cb.current.onSubmit(); return true; }
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k' && editorRef.current) { e.preventDefault(); askForLink(editorRef.current); return true; }
        if (e.altKey && (e.metaKey || e.ctrlKey) && (e.key === '2' || e.key === '3') && editorRef.current) {
          e.preventDefault(); editorRef.current.chain().focus().toggleHeading({ level: e.key === '2' ? 2 : 3 }).run(); return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? '' : ed.getHTML();
      setCount(ed.getText().length);
      cb.current.onCaretText?.(caretText(ed));
      // The editor also "updates" when it settles its own first content: not a change.
      if (html === sent.current) return;
      sent.current = html;
      cb.current.onChange(html);
    },
    onSelectionUpdate: ({ editor: ed }) => cb.current.onCaretText?.(caretText(ed)),
    // Repaint the toolbar's on/off states after every change or caret move.
    onTransaction: () => force((n) => n + 1),
    onBlur: () => cb.current.onBlur?.(),
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // A new value from outside (form reset, another record loaded): load it.
  useEffect(() => {
    if (!editor || value === sent.current) return;
    sent.current = value;
    editor.commands.setContent(toEditorHtml(value), { emitUpdate: false });
    setCount(richTextToPlain(value).length);
  }, [editor, value]);

  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  // The "More" menu closes on a click elsewhere or Esc.
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const away = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setMore(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMore(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [more]);

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus('end'),
    clear: () => { editor?.commands.clearContent(true); },
    textBeforeCaret: () => (editor ? caretText(editor) : ''),
    replaceBeforeCaret: (n, text) => {
      if (!editor) return;
      const to = editor.state.selection.from;
      editor.chain().focus().deleteRange({ from: Math.max(to - n, 0), to }).insertContent(text).run();
    },
    editor,
  }), [editor]);

  const mod = isMac() ? '⌘' : 'Ctrl';
  const near = maxLength ? count > maxLength * 0.8 : false;
  const over = maxLength ? count > maxLength : false;

  return (
    <div
      className={`${bare ? '' : 'rounded-lg border border-gray-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100'} ${disabled ? 'opacity-60' : ''} ${className}`}
    >
      <div ref={bar} role="toolbar" aria-label={`Formatting for ${ariaLabel}`} className={`relative flex flex-wrap items-center gap-0.5 ${bare ? 'pb-1' : 'border-b border-gray-200 px-1.5 py-1'}`}>
        {(compact ? TOOLS.filter((t) => t.everyday) : TOOLS).map((t) => {
          const on = !!editor && t.active(editor);
          const Icon = t.icon;
          return (
            <span key={t.key} className="contents">
              {t.gapBefore && <span aria-hidden className="mx-0.5 h-4 w-px bg-gray-200" />}
              <button
                type="button"
                disabled={!editor || disabled}
                aria-pressed={on}
                aria-label={t.label}
                title={`${t.label} (${mod}+${t.keys})`}
                // Keep the caret where it is: the button must not take focus.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor && t.run(editor)}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${on ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          );
        })}
        {compact && (
          <>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-gray-200" />
            <button
              type="button"
              disabled={!editor || disabled}
              aria-label="More formatting"
              aria-expanded={more}
              title="More formatting"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMore((m) => !m)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${more ? 'bg-gray-100 text-gray-800' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
            </button>
            {more && (
              <div role="menu" aria-label="More formatting" className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {TOOLS.filter((t) => !t.everyday).map((t) => {
                  const Icon = t.icon;
                  const on = !!editor && t.active(editor);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { if (editor) t.run(editor); setMore(false); }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${on ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      <span className="flex-1">{t.label}</span>
                      <span className="text-[11px] text-gray-400">{mod}+{t.keys}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      <EditorContent editor={editor} />
      {!editor && (
        // Before the editor mounts (and on the server) — same height, no jump.
        <div aria-hidden className={`${minHeightClass} px-3 py-2 text-sm text-gray-400`}>{placeholder}</div>
      )}
      {(footer || near) && (
        <div className={`flex items-center gap-2 ${bare ? 'pt-1' : 'px-2 pb-1.5'}`}>
          {footer && <div className="min-w-0 flex-1">{footer}</div>}
          {near && maxLength && (
            <span className={`ml-auto shrink-0 text-[11px] tabular-nums ${over ? 'font-semibold text-red-600' : 'text-gray-500'}`} aria-live="polite">
              {over ? `${count - maxLength} too many` : `${maxLength - count} left`}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

function caretText(editor: Editor): string {
  const { $from } = editor.state.selection;
  return $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
}

export default RichTextBox;
