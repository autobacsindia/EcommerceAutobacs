import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ServiceRatingForm, { ratingEditNote } from './ServiceRatingForm';

describe('ServiceRatingForm', () => {
  it('cannot submit until a star is chosen, then sends stars + trimmed comment', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(<ServiceRatingForm submitLabel="Send my rating" onSubmit={onSubmit} />);
    const send = screen.getByRole('button', { name: 'Send my rating' });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    fireEvent.change(screen.getByLabelText(/anything to add/i), { target: { value: '  Quick and clear  ' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ stars: 4, comment: 'Quick and clear' }));
  });

  it('prefills from the star tapped in the email', () => {
    render(<ServiceRatingForm initialStars={5} submitLabel="Send" onSubmit={jest.fn()} />);
    expect(screen.getByRole('button', { name: '5 stars' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('ignores an out-of-range prefill', () => {
    render(<ServiceRatingForm initialStars={9} submitLabel="Send" onSubmit={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it("shows the server's error and keeps the input", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Your rating is locked'));
    render(<ServiceRatingForm initialStars={2} submitLabel="Send" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your rating is locked');
    expect(screen.getByRole('button', { name: '2 stars' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('describes the edit window', () => {
    expect(ratingEditNote({ stars: 3, comment: '', createdAt: '', editableUntil: '2026-11-18T10:00:00Z', locked: false }))
      .toMatch(/change it until 18 Nov/);
    expect(ratingEditNote({ stars: 3, comment: '', createdAt: '', editableUntil: '', locked: true })).toMatch(/saved/);
  });
});
