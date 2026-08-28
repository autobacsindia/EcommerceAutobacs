/**
 * The dialog shell. Everything asserted here is a way the modal could trap or annoy a
 * customer on the page that shows them their receipt.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import SpinModal from './SpinModal';

const Harness = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
  <SpinModal open={isOpen} onClose={onClose} labelledBy="t" reducedMotionOverride>
    <h2 id="t">Your spin</h2>
  </SpinModal>
);

/**
 * Closes the way the product closes it: SpinSection stays mounted and flips `open`, so
 * the dialog's teardown runs while its panel is still in the document. Unmounting instead
 * would test a path that only happens when the customer navigates away, where restoring
 * focus is meaningless.
 */
const open = () => {
  const onClose = jest.fn();
  const utils = render(<Harness isOpen onClose={onClose} />);
  const close = () => utils.rerender(<Harness isOpen={false} onClose={onClose} />);
  return { onClose, close, ...utils };
};

describe('SpinModal', () => {
  afterEach(() => { document.body.style.overflow = ''; });

  it('renders nothing when closed', () => {
    render(
      <SpinModal open={false} onClose={jest.fn()} labelledBy="t" reducedMotionOverride>
        <h2 id="t">Your spin</h2>
      </SpinModal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('announces itself as a dialog named by its heading', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 't');
  });

  it('closes on Escape', () => {
    const { onClose } = open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on the backdrop', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on the close control', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('locks page scroll while open and restores it on close', () => {
    const { close } = open();
    expect(document.body.style.overflow).toBe('hidden');
    close();
    // Not merely "not hidden": leaving the page unscrollable after a dismissed prize
    // dialog would strand the customer on their own order confirmation.
    expect(document.body.style.overflow).toBe('');
  });

  it('restores a pre-existing scroll lock rather than blanking it', () => {
    // Two dialogs closing in sequence must not clobber each other's lock.
    document.body.style.overflow = 'clip';
    const { close } = open();
    close();
    expect(document.body.style.overflow).toBe('clip');
  });

  it('moves focus into the dialog, then returns it to the opener', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { close } = open();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    close();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
