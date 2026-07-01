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

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
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

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Enter description…',
  minHeight = '180px',
}: RichTextEditorProps) {
  const initialized = useRef(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [...HEADING_LEVELS] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-gold underline cursor-pointer' },
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
    <div className="border border-hairline rounded-md overflow-visible bg-obsidian">
      {/* ── Toolbar ── */}
      <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 bg-obsidian-deep border-b border-hairline">

        {/* Heading / Paragraph dropdown */}
        <div className="relative mr-1">
          <button
            type="button"
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-1 px-2 py-1 text-sm border border-hairline rounded bg-obsidian hover:bg-obsidian-raised min-w-30 justify-between text-ink"
          >
            <span>{activeHeadingLabel()}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1 bg-obsidian border border-hairline rounded shadow-lg z-50 min-w-40 py-1">
              <DropdownItem
                label="Paragraph"
                active={editor.isActive('paragraph') && !editor.isActive('heading')}
                className="text-sm"
                onClick={() => { editor.chain().focus().setParagraph().run(); setDropdownOpen(false); }}
              />
              {HEADING_LEVELS.map((level) => (
                <DropdownItem
                  key={level}
                  label={`Heading ${level}`}
                  active={editor.isActive('heading', { level })}
                  className={HEADING_SIZES[level]}
                  onClick={() => { editor.chain().focus().toggleHeading({ level }).run(); setDropdownOpen(false); }}
                />
              ))}
            </div>
          )}
        </div>

        <Sep />

        <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic className="h-4 w-4" />
        </Btn>

        <Sep />

        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
          <List className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List">
          <ListOrdered className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
          <Quote className="h-4 w-4" />
        </Btn>

        <Sep />

        <Btn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align Left">
          <AlignLeft className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align Centre">
          <AlignCenter className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align Right">
          <AlignRight className="h-4 w-4" />
        </Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
          <AlignJustify className="h-4 w-4" />
        </Btn>

        <Sep />

        <Btn onClick={handleSetLink} active={editor.isActive('link')} title="Insert / Edit Link">
          <LinkIcon className="h-4 w-4" />
        </Btn>
        {editor.isActive('link') && (
          <Btn onClick={() => editor.chain().focus().unsetLink().run()} active={false} title="Remove Link">
            <Unlink className="h-4 w-4" />
          </Btn>
        )}
      </div>

      {/* ── Editor content ── */}
      <div className="rte-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ── Small shared sub-components ────────────────────────────────────────────

function Btn({ children, onClick, active, title }: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${active ? 'bg-blue-100 text-gold' : 'text-ink/80 hover:bg-obsidian-raised'}`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="w-px h-5 bg-obsidian-raised mx-1 shrink-0" />;
}

function DropdownItem({ label, active, className, onClick }: {
  label: string;
  active: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-obsidian-raised text-ink ${active ? 'bg-obsidian-raised' : ''} ${className ?? ''}`}
    >
      {label}
    </button>
  );
}
