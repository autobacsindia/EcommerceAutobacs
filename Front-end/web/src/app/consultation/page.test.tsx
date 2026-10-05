import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConsultationPage from './page';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/analytics', () => ({ capture: jest.fn() }));

const post = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: (...a: unknown[]) => post(...a) } }));

const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillValid() {
  fill(/full name/i, 'Rahul Sharma');
  fill(/whatsapp number/i, '98765 43210');
  fill(/^email/i, 'rahul@example.com');
  fill(/^city/i, 'Kochi');
  fill(/car \(make/i, 'Toyota Hilux');
  fill(/what are you looking for/i, 'Lift kit');
}

describe('Consultation page (single-step form)', () => {
  beforeEach(() => { push.mockReset(); post.mockReset(); });

  it('shows the form in the hero with no multi-step wizard', () => {
    render(<ConsultationPage />);
    expect(screen.getByRole('heading', { name: /book your consultation/i })).toBeInTheDocument();
    expect(screen.queryByText(/step 1 of/i)).not.toBeInTheDocument();
  });

  it('blocks submit and names every missing required field', async () => {
    render(<ConsultationPage />);
    fireEvent.click(screen.getByRole('button', { name: /book my consultation/i }));
    expect(await screen.findByText(/please enter your name/i)).toBeInTheDocument();
    expect(screen.getByText(/valid 10-digit indian mobile/i)).toBeInTheDocument();
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(screen.getByText(/please enter your city/i)).toBeInTheDocument();
    expect(screen.getByText(/car make and model/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends every field the API requires, then goes to the thank-you page', async () => {
    post.mockResolvedValue({ success: true });
    render(<ConsultationPage />);
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: /book my consultation/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/consultation/thank-you'));
    expect(post).toHaveBeenCalledWith('/consultation', expect.objectContaining({
      name: 'Rahul Sharma',
      whatsapp: '98765 43210',
      email: 'rahul@example.com',
      city: 'Kochi',
      makeModel: 'Toyota Hilux',
      notes: 'Lift kit',
    }));
  });

  it('stays on the page and shows the server message when the request fails', async () => {
    post.mockRejectedValue({ rawData: { message: 'Please enter a valid email address.' } });
    render(<ConsultationPage />);
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: /book my consultation/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email address/i);
    expect(push).not.toHaveBeenCalled();
  });
});
