import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkflowsPage from './page';

// Mock icons
jest.mock('lucide-react', () => ({
  Package: () => <span data-testid="icon-package">Package</span>,
  ShoppingCart: () => <span data-testid="icon-cart">Cart</span>,
  Truck: () => <span data-testid="icon-truck">Truck</span>,
  CheckCircle: () => <span data-testid="icon-check">Check</span>,
  XCircle: () => <span data-testid="icon-x">X</span>,
  ArrowRight: () => <span data-testid="icon-arrow">Arrow</span>,
  RefreshCw: () => <span data-testid="icon-refresh">Refresh</span>,
}));

describe('WorkflowsPage', () => {
  it('renders default product lifecycle workflow', () => {
    render(<WorkflowsPage />);

    expect(screen.getByText('Production Workflows & Process Visualization')).toBeInTheDocument();
    
    // Check default tab is active
    expect(screen.getByText('Product Lifecycle Workflow')).toBeInTheDocument();
    expect(screen.getByText('Product Creation')).toBeInTheDocument();
    expect(screen.getByText('Deactivation/Archive')).toBeInTheDocument();
  });

  it('switches to order fulfillment workflow', () => {
    render(<WorkflowsPage />);

    const orderTab = screen.getByText('Order Fulfillment');
    fireEvent.click(orderTab);

    expect(screen.getByText('Order Fulfillment Workflow')).toBeInTheDocument();
    // Use getAllByText because stages are rendered in both Flow Diagram and Detailed Actions
    expect(screen.getAllByText('Order Placed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
  });

  it('switches to inventory management workflow', () => {
    render(<WorkflowsPage />);

    const inventoryTab = screen.getByText('Inventory Management');
    fireEvent.click(inventoryTab);

    expect(screen.getByText('Inventory Management Workflow')).toBeInTheDocument();
    expect(screen.getByText('1. Continuous Stock Monitoring')).toBeInTheDocument();
    expect(screen.getByText('2. Reorder Point Triggered')).toBeInTheDocument();
  });
});
