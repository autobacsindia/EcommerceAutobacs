/**
 * The contact form's fields. Their class string is built from two concatenated
 * halves; a missing space at the join once glued `py-3` and `text-ink` into one
 * unknown class, so every field lost its padding and its text colour.
 */
import { render, screen } from '@testing-library/react';
import ContactForm from './ContactForm';

jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { post: jest.fn() } }));

it('every field keeps its padding and text colour as separate classes', () => {
  render(<ContactForm />);
  const fields = [
    screen.getByLabelText(/name/i),
    screen.getByLabelText(/email/i),
    screen.getByLabelText(/subject/i),
    screen.getByLabelText(/message/i),
  ];
  for (const field of fields) {
    const classes = field.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['py-3', 'text-ink']));
    expect(classes.some((c) => /\d[a-z]+-/.test(c) && !c.includes('['))).toBe(false);
  }
});
