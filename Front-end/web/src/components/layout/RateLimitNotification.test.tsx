import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RateLimitNotification from './RateLimitNotification';

describe('RateLimitNotification', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render with correct time display', () => {
    render(<RateLimitNotification retryAfter={65} onDismiss={jest.fn()} />);
    
    // Check that the component renders
    expect(screen.getByText('Rate Limit Exceeded')).toBeDefined();
    expect(screen.getByText(/Please wait 1:05 before trying again/)).toBeDefined();
  });

  it('should update countdown timer', () => {
    const onDismissMock = jest.fn();
    render(<RateLimitNotification retryAfter={10} onDismiss={onDismissMock} />);
    
    // Initially shows 10 seconds
    expect(screen.getByText(/Please wait 0:10 before trying again/)).toBeDefined();
    
    // Advance timer by 5 seconds
    jest.advanceTimersByTime(5000);
    
    // Should now show 5 seconds remaining
    expect(screen.getByText(/Please wait 0:05 before trying again/)).toBeDefined();
    
    // Advance timer by 5 more seconds
    jest.advanceTimersByTime(5000);
    
    // Should have called onDismiss
    expect(onDismissMock).toHaveBeenCalledTimes(1);
  });

  it('should call onDismiss when close button is clicked', () => {
    const onDismissMock = jest.fn();
    render(<RateLimitNotification retryAfter={30} onDismiss={onDismissMock} />);
    
    const closeButton = screen.getByLabelText('Dismiss notification');
    fireEvent.click(closeButton);
    
    expect(onDismissMock).toHaveBeenCalledTimes(1);
  });

  it('should render progress bar', () => {
    render(<RateLimitNotification retryAfter={10} onDismiss={jest.fn()} />);
    
    // Check that progress bar renders
    expect(screen.getByRole('progressbar')).toBeDefined();
  });
});