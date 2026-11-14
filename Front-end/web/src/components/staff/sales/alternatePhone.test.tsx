/**
 * GTM quotation form: the optional "Alternative phone number". Empty is fine;
 * a wrong number or a copy of the main mobile is blocked with a reason; a valid
 * one is sent as the 10 digits the API stores.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewSalesOrderForm from './NewSalesOrderForm';
import { altMobileProblem } from './phone';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const fill = (labelText: RegExp, value: string) => fireEvent.change(screen.getByLabelText(labelText), { target: { value } });

function fillAndSubmit(alt: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NewSalesOrderForm />
    </QueryClientProvider>,
  );
  fill(/^Name$/, 'Ravi Kumar');
  fill(/Mobile \(WhatsApp\)/, '98765 43210');
  fill(/Alternative phone number/, alt);
  fill(/House \/ street/, '12 MG Road');
  fill(/^City$/, 'Pune');
  fill(/^State$/, 'Maharashtra');
  fill(/PIN code/, '411001');
  fireEvent.click(screen.getByRole('button', { name: /Custom item \(not in the catalogue\)/ }));
  fireEvent.change(screen.getByLabelText('Custom item name'), { target: { value: 'Labour' } });
  fireEvent.change(screen.getByLabelText(/Price for Labour/), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: /Create quotation/ }));
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ products: [] });
  push.mockReset();
  post.mockReset().mockResolvedValue({ quotation: { id: 'q1' } });
});

describe('altMobileProblem', () => {
  it('empty is fine', () => expect(altMobileProblem('  ', '9876543210')).toBe(''));
  it('a different valid mobile is fine', () => expect(altMobileProblem('+91 91234 56789', '9876543210')).toBe(''));
  it('a wrong number says why', () => expect(altMobileProblem('12345', '9876543210')).toMatch(/Too short/));
  it('the main number again is refused, however typed', () => expect(altMobileProblem('+91 98765-43210', '9876543210')).toMatch(/Same as the main mobile/));
});

it('shows the optional field', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewSalesOrderForm />
    </QueryClientProvider>,
  );
  const field = screen.getByLabelText(/Alternative phone number \(optional\)/);
  expect(field).not.toBeRequired();
  expect(field).toHaveValue('');
});

it('sends an empty alternative number when left blank', async () => {
  fillAndSubmit('');
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1].customer).toMatchObject({ phone: '9876543210', alternatePhone: '' });
});

it('sends a valid one as 10 digits', async () => {
  fillAndSubmit('+91 91234-56789');
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1].customer.alternatePhone).toBe('9123456789');
});

it('blocks a wrong one and says why', async () => {
  fillAndSubmit('5876');
  expect(await screen.findByRole('alert')).toHaveTextContent(/Alternative phone number: Too short/);
  expect(screen.getByLabelText(/Alternative phone number/)).toHaveAttribute('aria-invalid', 'true');
  expect(post).not.toHaveBeenCalled();
});

it('blocks the main number repeated', async () => {
  fillAndSubmit('09876543210');
  expect(await screen.findByRole('alert')).toHaveTextContent(/Same as the main mobile/);
  expect(post).not.toHaveBeenCalled();
});
