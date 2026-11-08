import { createRef } from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import RichText, { highlightMentions } from './RichText';
import RichTextBox, { type RichTextBoxHandle } from './RichTextBoxEditor';
import { isRichText, isRichTextEmpty, richTextToPlain, sanitizeRichHtml, toEditorHtml } from '@/lib/richText';

describe('lib/richText', () => {
  it('tells formatted values from old plain text', () => {
    expect(isRichText('<p>x</p>')).toBe(true);
    expect(isRichText('<b>typed by hand</b>')).toBe(false);
    expect(isRichText('a < b')).toBe(false);
    expect(isRichText(undefined)).toBe(false);
  });

  it('cleans to the allow-list: no scripts, handlers, styles or javascript: links', () => {
    const out = sanitizeRichHtml('<p onclick="x()" style="color:red">a<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">b</a><a href="https://ok.in">c</a></p>');
    expect(out).not.toMatch(/script|onclick|onerror|style|javascript|<img/);
    expect(out).toContain('<a href="https://ok.in" target="_blank" rel="noopener noreferrer nofollow">c</a>');
  });

  it('checkboxes in shown lists are display-only', () => {
    expect(sanitizeRichHtml('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="text" checked></label><div><p>x</p></div></li></ul>'))
      .toMatch(/<input(?=[^>]*type="checkbox")(?=[^>]*checked="")(?=[^>]*disabled="")[^>]*>/);
  });

  it('loads old plain text into the editor line by line, every character kept literally', () => {
    expect(toEditorHtml('a < b & <i>c</i>\nline 2')).toBe('<p>a &lt; b &amp; &lt;i&gt;c&lt;/i&gt;</p><p>line 2</p>');
    expect(toEditorHtml('<p>kept</p>')).toBe('<p>kept</p>');
    expect(toEditorHtml('  ')).toBe('');
  });

  it('reads as plain words with list markers', () => {
    expect(richTextToPlain('<p>Hi <strong>Ravi</strong> &amp; co</p><ul><li><p>a</p></li><li><p>b</p></li></ul><ol><li><p>c</p></li></ol>'))
      .toBe('Hi Ravi & co\n\n• a\n• b\n\n1. c');
    expect(richTextToPlain('plain\ntext')).toBe('plain\ntext');
  });

  it('knows an empty box', () => {
    expect(isRichTextEmpty('')).toBe(true);
    expect(isRichTextEmpty('<p></p>')).toBe(true);
    expect(isRichTextEmpty('<ul><li><p></p></li></ul>')).toBe(true);
    expect(isRichTextEmpty('<p>x</p>')).toBe(false);
    expect(isRichTextEmpty('x')).toBe(false);
  });
});

describe('<RichText>', () => {
  it('shows formatted text as formatting, cleaned', () => {
    const { container } = render(<RichText value={'<p><strong>Bold</strong><img src=x onerror="window.hacked=1"></p>'} />);
    expect(container.querySelector('strong')?.textContent).toBe('Bold');
    expect(container.querySelector('img')).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it('shows old plain text as text — tags typed by hand are not HTML', () => {
    const { container } = render(<RichText value={'<b>not bold</b>\nline 2'} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('<b>not bold</b>\nline 2');
  });

  it('uses the plain renderer for old values and the empty slot for none', () => {
    render(<RichText value="old" plain={(s) => <em>{s}!</em>} />);
    expect(screen.getByText('old!')).toBeInTheDocument();
    const { container } = render(<RichText value="" empty={<span>Nothing</span>} />);
    expect(container.textContent).toBe('Nothing');
  });

  it('highlights @mentions in words but not inside links or tags', () => {
    const html = highlightMentions('<p>@Arun see <a href="https://x.in/@Arun">@Arun</a></p>', ['Arun']);
    expect(html).toBe('<p><span class="rt-mention">@Arun</span> see <a href="https://x.in/@Arun">@Arun</a></p>');
    expect(highlightMentions('<p>@A &amp; B</p>', ['A & B'])).toBe('<p><span class="rt-mention">@A &amp; B</span></p>');
  });
});

describe('<RichTextBox> (the real editor)', () => {
  const setup = (value = '', extra: Partial<React.ComponentProps<typeof RichTextBox>> = {}) => {
    const onChange = jest.fn();
    const ref = createRef<RichTextBoxHandle>();
    const utils = render(<RichTextBox ref={ref} value={value} onChange={onChange} ariaLabel="Notes" {...extra} />);
    return { ...utils, onChange, ref };
  };
  const ready = async (ref: React.RefObject<RichTextBoxHandle | null>) => {
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    return ref.current!.editor!;
  };

  it('has a labelled toolbar with every format and its shortcut', async () => {
    const { ref } = setup();
    await ready(ref);
    const bar = screen.getByRole('toolbar', { name: 'Formatting for Notes' });
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Heading', 'Small heading', 'Bullet list', 'Numbered list', 'Checklist', 'Link', 'Code', 'Quote']) {
      expect(bar.querySelector(`button[aria-label="${name}"]`)).not.toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('title')).toMatch(/\+B\)$/);
  });

  it('compact: everyday formats in the row, the rest under "More", which closes on Esc', async () => {
    const { ref, onChange } = setup('x', { compact: true });
    const editor = await ready(ref);
    expect(screen.queryByRole('button', { name: 'Quote' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More formatting' }));
    act(() => { editor.commands.selectAll(); });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Quote/ }));
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('<blockquote>');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More formatting' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('loads old plain text literally and sends HTML back on change', async () => {
    const { ref, onChange } = setup('a < b\nline 2');
    const editor = await ready(ref);
    expect(editor.getHTML()).toBe('<p>a &lt; b</p><p>line 2</p>');
    act(() => { editor.commands.selectAll(); });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenLastCalledWith('<p><strong>a &lt; b</strong></p><p><strong>line 2</strong></p>');
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('every toolbar format produces the tag the server keeps', async () => {
    const { ref, onChange } = setup('x');
    const editor = await ready(ref);
    const tagFor: Record<string, string> = {
      Italic: '<em>', Underline: '<u>', Strikethrough: '<s>', Code: '<code>', Heading: '<h2>', 'Small heading': '<h3>',
      'Bullet list': '<ul>', 'Numbered list': '<ol>', Checklist: 'data-type="taskList"', Quote: '<blockquote>',
    };
    for (const [name, tag] of Object.entries(tagFor)) {
      act(() => { editor.commands.setContent('<p>x</p>'); editor.commands.selectAll(); });
      fireEvent.click(screen.getByRole('button', { name }));
      expect(onChange.mock.calls.at(-1)?.[0]).toContain(tag);
    }
    // The server and the plain-text reader key tick items on this exact shape.
    act(() => { editor.commands.setContent('<p>x</p>'); editor.commands.selectAll(); });
    fireEvent.click(screen.getByRole('button', { name: 'Checklist' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toMatch(/<li (?=[^>]*data-checked="false")(?=[^>]*data-type="taskItem")[^>]*>/);
  });

  it('pasted Word/Docs markup keeps structure and drops fonts, colours and scripts', async () => {
    const { ref, onChange } = setup();
    const editor = await ready(ref);
    await ready(ref);
    const html = '<h1 style="font-family:Calibri">Title</h1><p class="MsoNormal"><span style="color:red;font-size:20pt"><b>Bold</b> word</span><script>x</script></p><ul><li>one</li></ul><table><tr><td>cell</td></tr></table>';
    act(() => {
      fireEvent.paste(screen.getByRole('textbox', { name: 'Notes' }), {
        clipboardData: { types: ['text/html', 'text/plain'], getData: (t: string) => (t === 'text/html' ? html : 'Title Bold word one cell'), files: [], items: [] },
      });
    });
    void editor;
    const out = onChange.mock.calls.at(-1)?.[0] as string;
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>Bold</strong> word');
    expect(out).toContain('<ul><li><p>one</p></li></ul>');
    expect(out).toContain('cell');
    expect(out).not.toMatch(/style=|class=|<span|<script|<table|<h1/);
  });

  it('an emptied box sends "" (so required checks still work)', async () => {
    const { ref, onChange } = setup('<p>x</p>');
    const editor = await ready(ref);
    act(() => { editor.commands.clearContent(true); });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('Ctrl/⌘+Enter submits; a parent can take keys first', async () => {
    const onSubmit = jest.fn();
    const first = jest.fn((e: KeyboardEvent) => e.key === 'ArrowDown');
    const { ref } = setup('x', { onSubmit, onKeyDownFirst: first });
    await ready(ref);
    const box = screen.getByRole('textbox', { name: 'Notes' });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(first).toHaveBeenCalled();
  });

  it('a new value from outside replaces the words; its own echo does not', async () => {
    const onChange = jest.fn();
    const ref = createRef<RichTextBoxHandle>();
    const { rerender } = render(<RichTextBox ref={ref} value="<p>one</p>" onChange={onChange} ariaLabel="Notes" />);
    const editor = await ready(ref);
    rerender(<RichTextBox ref={ref} value="<p>two</p>" onChange={onChange} ariaLabel="Notes" />);
    await waitFor(() => expect(editor.getHTML()).toBe('<p>two</p>'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the @mention helpers read and replace the words before the caret', async () => {
    const { ref, onChange } = setup();
    const editor = await ready(ref);
    act(() => { editor.commands.insertContent('Hi @Ar'); });
    expect(ref.current!.textBeforeCaret()).toBe('Hi @Ar');
    act(() => { ref.current!.replaceBeforeCaret(3, '@Arun '); });
    expect(onChange).toHaveBeenLastCalledWith('<p>Hi @Arun </p>');
  });

  it('counts words, not markup, against the limit', async () => {
    const { ref } = setup('', { maxLength: 10 });
    const editor = await ready(ref);
    act(() => { editor.commands.insertContent('<p><strong>abcdefghi</strong></p>'); });
    expect(screen.getByText('1 left')).toBeInTheDocument();
    act(() => { editor.commands.insertContent('xyz'); });
    expect(screen.getByText('2 too many')).toBeInTheDocument();
  });
});
