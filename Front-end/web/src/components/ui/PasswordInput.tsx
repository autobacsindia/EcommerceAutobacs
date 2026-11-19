'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Extra classes for the wrapper (the input's own `className` styles the box). */
  wrapperClassName?: string;
};

/**
 * A password box with an eye button that shows or hides what was typed.
 *
 * Every other prop (id, name, autoComplete, required, minLength…) goes straight
 * to the <input>, so labels and password managers keep working. The button is
 * `type="button"` so it never submits the form, and it is a real button, so
 * Tab + Enter/Space work. Room for it is made with right padding on the input.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = '', wrapperClassName = '', disabled, ...inputProps }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <div className={`relative ${wrapperClassName}`}>
        <input
          ref={ref}
          {...inputProps}
          disabled={disabled}
          type={visible ? 'text' : 'password'}
          className={`${className} pr-11`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={inputProps.id}
          title={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-sm text-current opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-current disabled:cursor-not-allowed disabled:opacity-30"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    );
  },
);
