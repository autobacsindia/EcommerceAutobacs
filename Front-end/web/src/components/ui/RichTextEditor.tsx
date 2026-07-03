'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import { useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, List, ListOrdered, Quote,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Link as LinkIcon, Unlink, ChevronDown,
} from 'lucide-react';

type Variant = 'dark' | 'light';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  /** Visual theme. `dark` (default) suits the obsidian admin shell; `light` suits white/legacy forms. */
  variant?: Variant;
}

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const HEADING_SIZES: Record<number, string> = {
  1: 'text-2xl font-bold',
  2: 'text-xl  font-bold',
  3: 'text-lg  font-semibold',
  4: 'text-base font-semibold',
  5: 'text-sm  font-semibold',
  6: 'text-xs  font-semibold',
};

// Per-variant class sets so the editor sits cleanly on either a dark or a light form.
const THEME: Record<Variant, {
  shell: string;
  toolbar: string;
  headingBtn: string;
  menu: string;
  item: string;
  itemActive: string;
  btnActive: string;
  btnIdle: string;
  sep: string;
  linkClass: string;
}> = {
  dark: {
    shell: 'border-hairline bg-obsidian',
    toolbar: 'bg-obsidian-deep border-hairline',
    headingBtn: 'border-hairline bg-obsidian hover:bg-obsidian-raised text-ink',
    menu: 'bg-obsidian border-hairline',
    item: 'hover:bg-obsidian-raised text-ink',
    itemActive: 'bg-obsidian-raised',
    btnActive: 'bg-gold/10 text-gold',
    btnIdle: 'text-ink/80 hover:bg-obsidian-raised',
    sep: 'bg-obsidian-raised',
    linkClass: 'text-gold underline cursor-pointer',
  },
  light: {
    shell: 'border-gray-300 bg-white',
    toolbar: 'bg-gray-50 border-gray-200',
    headingBtn: 'border-gray-300 bg-white hover:bg-gray-100 text-gray-700',
    menu: 'bg-white border-gray-200',
    item: 'hover:bg-gray-100 text-gray-700',
    itemActive: 'bg-gray-100',
    btnActive: 'bg-red-50 text-red-600',
    btnIdle: 'text-gray-600 hover:bg-gray-100',
    sep: 'bg-gray-200',
    linkClass: 'text-blue-600 underline cursor-pointer',
  },
};

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Enter description…',
  minHeight = '180px',
  variant = 'dark',
}: RichTextEditorProps) {
  const initialized = useRef(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const t = THEME[variant];

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [...HEADING_LEVELS] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: t.linkClass },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        'data-placeholder': placeholder,
        style: `min-height:${minHeight}`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    immediatelyRender: false,
  });

  // Populate content once when the product data arrives (avoid re-setting on every keystroke)
  useEffect(() => {
    if (editor && value && !initialized.current) {
      editor.commands.setContent(value, { emitUpdate: false });
      initialized.current = true;
    }
  }, [editor, value]);

  const activeHeadingLabel = () => {
    if (!editor) return 'Paragraph';
    for (const level of HEADING_LEVELS) {
      if (editor.isActive('heading', { level })) return `Heading ${level}`;
    }
    return 'Paragraph';
  };

  const handleSetLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Enter URL', prev ?? '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  if (!editor) return null;

  return (
    <div className={`border rounded-md overflow-visible ${t.shell}`}>
      {/* ── Toolbar ── */}
      <div className={`flex items-center flex-wrap gap-0.5 px-2 py-1.5 border-b ${t.toolbar}`}>

        {/* Heading / Paragraph dropdown */}
        <div className="relative mr-1">
          <button
            type="button"
            onClick={() => setDropdownOpen((o) => !o)}
            className={`flex items-center gap-1 px-2 py-1 text-sm border rounded min-w-30 justify-between ${t.headingBtn}`}
          >
            <span>{activeHeadingLabel()}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>

          {dropdownOpen && (
            <div className={`absolute top-full left-0 mt-1 border rounded shadow-lg z-50 min-w-40 py-1 ${t.menu}`}>
              <DropdownItem
                label="Paragraph"
                active={editor.isActive('paragraph') && !editor.isActive('heading')}
                className="text-sm"
                theme={t}
                onClick={() => { editor.chain().focus().setParagraph().run(); setDropdownOpen(false); }}
              />
              {HEADING_LEVELS.map((level) => (
                <DropdownItem
                  key={level}
                  label={`Heading ${level}`}
                  active={editor.isActive('heading', { level })}
                  className={HEADING_SIZES[level]}
                  theme={t}
                  onClick={() => { editor.chain().focus().toggleHeading({ level }).run(); setDropdownOpen(false); }}
                />
              ))}
            </div>
          )}
        </div>

        <Sep theme={t} />

        <Btn theme={t} onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold className="h-4 w-4" />
        </Btn>
        <Btn theme={t} onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic className="h-4 w-4" />
        </Btn>

        <Sep theme={t} />

        <Btn theme={t} onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
          <List className="h-4 w-4" />
        </Btn>
        <Btn theme={t} onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List">
          <ListOrdered className="h-4 w-4" />
        </Btn>
        <Btn theme={t} onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
          <Quote className="h-4 w-4" />
        </Btn>

        <Sep theme={t} />

        <Btn theme={t} onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align Left">
          <AlignLeft className="h-4 w-4" />
        </Btn>
        <Btn theme={t} onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align Centre">
          <AlignCenter className="h-4 w-4" />
        </Btn>
        <Btn theme={t} onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align Right">
          <AlignRight className="h-4 w-4" />
        </Btn>
        <Btn theme={t} onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
          <AlignJustify className="h-4 w-4" />
        </Btn>

        <Sep theme={t} />

        <Btn theme={t} onClick={handleSetLink} active={editor.isActive('link')} title="Insert / Edit Link">
          <LinkIcon className="h-4 w-4" />
        </Btn>
        {editor.isActive('link') && (
          <Btn theme={t} onClick={() => editor.chain().focus().unsetLink().run()} active={false} title="Remove Link">
            <Unlink className="h-4 w-4" />
          </Btn>
        )}
      </div>

      {/* ── Editor content ── */}
      <div className={`rte-content ${variant === 'light' ? 'rte-light' : ''}`}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ── Small shared sub-components ────────────────────────────────────────────

type Theme = (typeof THEME)[Variant];

function Btn({ children, onClick, active, title, theme }: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  title: string;
  theme: Theme;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${active ? theme.btnActive : theme.btnIdle}`}
    >
      {children}
    </button>
  );
}

function Sep({ theme }: { theme: Theme }) {
  return <span className={`w-px h-5 mx-1 shrink-0 ${theme.sep}`} />;
}

function DropdownItem({ label, active, className, onClick, theme }: {
  label: string;
  active: boolean;
  className?: string;
  onClick: () => void;
  theme: Theme;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 ${theme.item} ${active ? theme.itemActive : ''} ${className ?? ''}`}
    >
      {label}
    </button>
  );
}
