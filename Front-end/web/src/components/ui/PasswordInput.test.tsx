import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PasswordInput } from './PasswordInput';

function renderInForm(onSubmit = jest.fn((e: React.FormEvent) => e.preventDefault())) {
  render(
    <form onSubmit={onSubmit}>
      <label htmlFor="pw">Password</label>
      <PasswordInput id="pw" name="password" autoComplete="current-password" required className="box" />
      <button type="submit">Sign in</button>
    </form>,
  );
  return { onSubmit, input: screen.getByLabelText('Password') as HTMLInputElement };
}

describe('PasswordInput', () => {
  it('starts hidden and keeps the attributes password managers rely on', () => {
    const { input } = renderInForm();
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    expect(input).toHaveAttribute('name', 'password');
    expect(input).toBeRequired();
    expect(input.className).toContain('box');
  });

  it('switches the type and the button label each click', () => {
    const { input } = renderInForm();
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hide);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is a type="button" so clicking it never submits the form', () => {
    const { onSubmit } = renderInForm();
    const eye = screen.getByRole('button', { name: 'Show password' });
    expect(eye).toHaveAttribute('type', 'button');
    fireEvent.click(eye);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('can be reached with the keyboard', () => {
    renderInForm();
    const eye = screen.getByRole('button', { name: 'Show password' });
    eye.focus();
    expect(eye).toHaveFocus();
    expect(eye).not.toHaveAttribute('tabindex', '-1');
  });

  it('keeps what was typed when toggled', () => {
    const { input } = renderInForm();
    fireEvent.change(input, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.value).toBe('secret123');
  });
});
