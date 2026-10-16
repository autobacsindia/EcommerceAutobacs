import { render, screen } from '@testing-library/react';
import BulkActionsBar from './BulkActionsBar';

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
