import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import CopyId, { copyText } from './CopyId';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

const setClipboard = (writeText: jest.Mock | undefined) => {
  Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
};
const setExecCommand = (fn: jest.Mock | undefined) => {
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true, writable: true });
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

describe('CopyId', () => {
  it('copies the id, says so in a toast, and shows a tick for a moment', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(<CopyId value="ECD8464E" label="Order number" />);
    const button = screen.getByRole('button', { name: 'Copy order number ECD8464E' });
    await act(async () => { fireEvent.click(button); });
    expect(writeText).toHaveBeenCalledWith('ECD8464E');
    expect(toast.success).toHaveBeenCalledWith('Copied order number ECD8464E', expect.objectContaining({ id: 'copy-id' }));
    expect(button).toHaveAttribute('title', 'Copied');
    act(() => { jest.advanceTimersByTime(1600); });
    expect(button).toHaveAttribute('title', 'Copy order number');
    jest.useRealTimers();
  });

  it('does not open the row or card it sits in (click or keys)', async () => {
    setClipboard(jest.fn().mockResolvedValue(undefined));
    const onRowClick = jest.fn();
    const onRowKey = jest.fn();
    render(
      <div onClick={onRowClick} onKeyDown={onRowKey}><CopyId value="SKU-1" label="SKU" /></div>,
    );
    const button = screen.getByRole('button', { name: 'Copy SKU SKU-1' });
    await act(async () => { fireEvent.click(button); });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowKey).not.toHaveBeenCalled();
  });

  it('is a real button, reachable with the keyboard', () => {
    setClipboard(jest.fn().mockResolvedValue(undefined));
    render(<CopyId value="ABC" />);
    const button = screen.getByRole('button', { name: 'Copy ID ABC' });
    expect(button).toHaveAttribute('type', 'button');
    button.focus();
    expect(button).toHaveFocus();
  });

  it('falls back to the old copy command when the clipboard API is missing or refused', async () => {
    const exec = jest.fn().mockReturnValue(true);
    setExecCommand(exec);
    setClipboard(undefined);
    await expect(copyText('ECD8464E')).resolves.toBe(true);
    setClipboard(jest.fn().mockRejectedValue(new Error('denied')));
    await expect(copyText('ECD8464E')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenCalledWith('copy');
    // The helper textarea is cleaned up.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('says it could not copy when nothing worked', async () => {
    setClipboard(undefined);
    setExecCommand(jest.fn().mockReturnValue(false));
    render(<CopyId value="ECD8464E" label="Order number" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy order number ECD8464E' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps acronyms in capitals in its label', () => {
    render(<CopyId value="pay_123" label="Payment ID" />);
    expect(screen.getByRole('button', { name: 'Copy payment ID pay_123' })).toBeInTheDocument();
  });

  it('renders nothing for an empty id', () => {
    const { container } = render(<CopyId value="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
