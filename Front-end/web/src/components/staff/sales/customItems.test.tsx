/**
 * GTM "New order": an item that is not in the catalogue can be sold as a custom
 * item with its own price, and the customer's mobile number is checked (and
 * tidied) before the order is sent.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewSalesOrderForm from './NewSalesOrderForm';
import { mobileProblem, normalizeMobile } from './phone';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const renderForm = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <NewSalesOrderForm />
  </QueryClientProvider>,
);

const fill = (labelText: RegExp, value: string) => fireEvent.change(screen.getByLabelText(labelText), { target: { value } });

function fillCustomer(phone: string) {
  fill(/^Name$/, 'Ravi Kumar');
  fill(/Mobile/, phone);
  fill(/Email/, 'ravi@example.com');
  fill(/House \/ street/, '12 MG Road');
  fill(/^City$/, 'Pune');
  fill(/^State$/, 'Maharashtra');
  fill(/PIN code/, '411001');
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ products: [] });
  push.mockReset();
  post.mockReset().mockResolvedValue({ quotation: { id: 'q1' } });
});

describe('mobile number helpers', () => {
  it.each([['98765 43210', '9876543210'], ['+91 98765-43210', '9876543210'], ['09876543210', '9876543210']])('%s → %s', (a, b) => {
    expect(normalizeMobile(a)).toBe(b);
    expect(mobileProblem(a)).toBe('');
  });
  it('explains what is wrong', () => {
    expect(mobileProblem('')).toMatch(/Enter/);
    expect(mobileProblem('98765')).toMatch(/Too short/);
    expect(mobileProblem('5876543210')).toMatch(/starts with 6, 7, 8 or 9/);
  });
});

it('adds what was typed as a custom item, with the price the salesperson enters', async () => {
  renderForm();
  fillCustomer('98765 43210');
  fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'Fitting labour' } });
  fireEvent.click(await screen.findByRole('button', { name: /Add .Fitting labour. as a custom item/ }));

  expect(screen.getByLabelText('Custom item name')).toHaveValue('Fitting labour');
  fireEvent.change(screen.getByLabelText(/Price for Fitting labour/), { target: { value: '1500' } });
  fireEvent.click(screen.getByRole('button', { name: /More/ }));
  fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));

  await waitFor(() => expect(post).toHaveBeenCalled());
  const [url, body] = post.mock.calls[0];
  // Quotation first: no order and no payment link yet.
  expect(url).toBe('/staff/sales/quotations');
  await waitFor(() => expect(push).toHaveBeenCalledWith('/team/sales/quotations/q1'));
  expect(body.items).toEqual([{ custom: true, name: 'Fitting labour', quantity: 2, price: 1500 }]);
  // Sent as the 10 digits the API stores, whatever spacing was typed.
  expect(body.customer.phone).toBe('9876543210');
});

it('a custom item needs a name and a price before the order can be sent', async () => {
  renderForm();
  fillCustomer('9876543210');
  fireEvent.click(screen.getByRole('button', { name: /Custom item \(not in the catalogue\)/ }));
  fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Fix the items marked in red/);
  expect(post).not.toHaveBeenCalled();
});

it('email is optional: an order without one is sent with an empty email', async () => {
  renderForm();
  fillCustomer('9876543210');
  fill(/Email/, '');
  expect(screen.getByText(/payment links will go by SMS/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Custom item \(not in the catalogue\)/ }));
  fireEvent.change(screen.getByLabelText('Custom item name'), { target: { value: 'Labour' } });
  fireEvent.change(screen.getByLabelText(/Price for Labour/), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1].customer.email).toBe('');
});

it('blocks a wrong mobile number and says why', async () => {
  renderForm();
  fillCustomer('12345');
  fireEvent.click(screen.getByRole('button', { name: /Custom item \(not in the catalogue\)/ }));
  fireEvent.change(screen.getByLabelText('Custom item name'), { target: { value: 'Labour' } });
  fireEvent.change(screen.getByLabelText(/Price for Labour/), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Mobile number: Too short/);
  expect(screen.getByLabelText(/Mobile/)).toHaveAttribute('aria-invalid', 'true');
  expect(post).not.toHaveBeenCalled();
});
