import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BulkActionsBar from './BulkActionsBar';
import { ADMIN_CANCELLATION_REASONS } from '@/lib/constants';

const props = {
  selectedCount: 3, totalCount: 10,
  onSelectAll: jest.fn(), onClearSelection: jest.fn(),
  onBulkStatusUpdate: jest.fn(), onExportSelected: jest.fn(), onBulkDelete: jest.fn(),
};

it('admin: export, delete and status changes', () => {
  render(<BulkActionsBar {...props} />);
  expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Update Status/ })).toBeInTheDocument();
});

it('view-only (marketing): export only', () => {
  render(<BulkActionsBar {...props} canManage={false} />);
  expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Update Status/ })).toBeNull();
});

describe('reason picker', () => {
  const openForm = () => {
    render(<BulkActionsBar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Update Status/ }));
  };
  const pickStatus = (value: string) =>
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value } });

  it('offers only the reasons the server accepts for a cancel', () => {
    openForm();
    pickStatus('cancelled');
    const options = Array.from((screen.getByLabelText('Reason') as HTMLSelectElement).options)
      .map((o) => o.value).filter(Boolean);
    expect(options).toEqual(ADMIN_CANCELLATION_REASONS.map((r) => r.value));
  });

  it('asks for no reason on other statuses, and sends none', async () => {
    const onBulkStatusUpdate = jest.fn().mockResolvedValue(undefined);
    render(<BulkActionsBar {...props} onBulkStatusUpdate={onBulkStatusUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: /Update Status/ }));

    pickStatus('cancelled');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'quality_issue' } });
    pickStatus('processing');
    expect(screen.queryByLabelText('Reason')).toBeNull();

    fireEvent.submit(screen.getAllByRole('combobox')[0].closest('form')!);
    await waitFor(() => expect(onBulkStatusUpdate).toHaveBeenCalledWith('processing', '', ''));
  });

  it('sends the picked reason with a cancel', async () => {
    const onBulkStatusUpdate = jest.fn().mockResolvedValue(undefined);
    render(<BulkActionsBar {...props} onBulkStatusUpdate={onBulkStatusUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: /Update Status/ }));

    pickStatus('cancelled');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'other' } });
    fireEvent.submit(screen.getAllByRole('combobox')[0].closest('form')!);
    await waitFor(() => expect(onBulkStatusUpdate).toHaveBeenCalledWith('cancelled', 'other', ''));
  });
});
