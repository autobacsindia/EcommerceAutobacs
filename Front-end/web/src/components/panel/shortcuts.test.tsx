/**
 * Keyboard shortcuts shared by Tasks and Team chat. The one rule that matters:
 * a single-key shortcut never fires while someone is typing, or "n" in a
 * comment would open a new task.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsDialog, isTypingIn, useHotkeys, type Hotkey } from './shortcuts';

function Harness({ keys, enabled = true }: { keys: Hotkey[]; enabled?: boolean }) {
  useHotkeys(keys, enabled);
  return (
    <div>
      <input aria-label="Comment" />
      <textarea aria-label="Note" />
      <div contentEditable suppressContentEditableWarning aria-label="Editor" />
    </div>
  );
}

describe('useHotkeys', () => {
  it('a single key fires on the page, but not while typing in a field, a text box or an editor', () => {
    const run = jest.fn();
    render(<Harness keys={[{ key: 'n', run }]} />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('Comment'), { key: 'n' });
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'n' });
    fireEvent.keyDown(screen.getByLabelText('Editor'), { key: 'n' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('letters match either case; Ctrl/⌘ shortcuts work even while typing', () => {
    const plain = jest.fn();
    const mod = jest.fn();
    render(<Harness keys={[{ key: 'k', mod: true, run: mod }, { key: 'b', run: plain }]} />);
    fireEvent.keyDown(window, { key: 'B' });
    expect(plain).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('Comment'), { key: 'k', ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText('Comment'), { key: 'k', metaKey: true });
    expect(mod).toHaveBeenCalledTimes(2);
    // Plain "k" is not Ctrl+K, and Ctrl+B is not "b".
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(mod).toHaveBeenCalledTimes(2);
    expect(plain).toHaveBeenCalledTimes(1);
  });

  it('single keys stand back while another pop-up is open, and nothing fires when switched off', () => {
    const run = jest.fn();
    const { rerender } = render(<Harness keys={[{ key: '?', run }]} />);
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    fireEvent.keyDown(window, { key: '?' });
    expect(run).not.toHaveBeenCalled();
    modal.remove();
    rerender(<Harness keys={[{ key: '?', run }]} enabled={false} />);
    fireEvent.keyDown(window, { key: '?' });
    expect(run).not.toHaveBeenCalled();
  });

  it('isTypingIn: fields yes, buttons and nothing no', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    expect(isTypingIn(input)).toBe(true);
    expect(isTypingIn(button)).toBe(false);
    expect(isTypingIn(null)).toBe(false);
  });
});

describe('the shortcuts sheet', () => {
  it('lists every shortcut, and closes on Escape or the close button', () => {
    const onClose = jest.fn();
    render(<ShortcutsDialog groups={[{ title: 'Tasks', items: [{ keys: ['N'], label: 'New task' }] }]} onClose={onClose} />);
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(sheet).toHaveTextContent('New task');
    expect(screen.getAllByRole('button', { name: 'Close' })[1]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
