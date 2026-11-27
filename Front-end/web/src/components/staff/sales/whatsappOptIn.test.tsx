/**
 * GTM quotation form: "Send order updates on WhatsApp". Ticked by default (owner
 * decision, 2026-11); staff untick it when the customer says no. Sent on the
 * customer block, which the server carries onto the order as staff consent.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewSalesOrderForm from './NewSalesOrderForm';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const fill = (labelText: RegExp, value: string) => fireEvent.change(screen.getByLabelText(labelText), { target: { value } });

function renderAndFill() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NewSalesOrderForm />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('radio', { name: /B2C — retail/ }));
  fill(/^Name$/, 'Ravi Kumar');
  fill(/Mobile \(WhatsApp\)/, '98765 43210');
  fill(/House \/ Flat/, 'Flat 4B'); fill(/Street \/ Area/, '12 MG Road');
  fill(/^City$/, 'Pune');
  fill(/^State$/, 'Maharashtra');
  fill(/PIN code/, '411001');
  fireEvent.click(screen.getByRole('button', { name: /Custom item \(not in the catalogue\)/ }));
  fireEvent.change(screen.getByLabelText('Custom item name'), { target: { value: 'Labour' } });
  fireEvent.change(screen.getByLabelText(/Price for Labour/), { target: { value: '500' } });
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ products: [] });
  post.mockReset().mockResolvedValue({ quotation: { id: 'q1' } });
});

it('starts ticked and sends whatsappOptIn: true', async () => {
  renderAndFill();
  expect(screen.getByRole('checkbox', { name: /order updates on WhatsApp/i })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1].customer.whatsappOptIn).toBe(true);
});

it('sends whatsappOptIn: false when staff untick it', async () => {
  renderAndFill();
  fireEvent.click(screen.getByRole('checkbox', { name: /order updates on WhatsApp/i }));
  fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1].customer.whatsappOptIn).toBe(false);
});
