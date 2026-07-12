'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import trackingService from '@/services/trackingService';
import { TrackingData } from '@/types/tracking';
import { TrackingTimeline } from '@/components/tracking/TrackingTimeline';
import { getStatusBadgeColor } from '@/utils/trackingHelpers';

function TrackOrderPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingData, setTrackingData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Auto-load tracking if tracking number is in URL params
  useEffect(() => {
    const numberFromUrl = searchParams.get('number');
    if (numberFromUrl) {
      setTrackingNumber(numberFromUrl);
      handleTrackingSubmit(numberFromUrl);
    }
  }, [searchParams]);

  const handleTrackingSubmit = async (number?: string) => {
    const trackNum = number || trackingNumber;
    
    // Validate tracking number
    const validation = trackingService.validateTrackingNumber(trackNum);
    if (!validation.valid) {
      setValidationError(validation.error || 'Invalid tracking number');
      return;
    }

    setValidationError(null);
    setError(null);
    setLoading(true);

    try {
      const response = await trackingService.trackByNumber(trackNum.trim());
      
      if (response.success && response.trackingNumber) {
        setTrackingData({
          success: true,
          trackingNumber: response.trackingNumber,
          carrier: response.carrier!,
          currentStatus: response.currentStatus!,
          estimatedDelivery: response.estimatedDelivery!,
          destination: response.destination!,
          events: response.events || []
        });
        
        // Update URL with tracking number
        router.push(`/track?number=${trackNum.trim()}`, { scroll: false });
      } else {
        setError(response.message || 'Tracking information not available');
      }
    } catch (err: any) {
      console.error('Tracking error:', err);
      
      // Handle rate limiting
      if (err.status === 429) {
        const retryAfter = err.rateLimitInfo?.retryAfter || 900;
        const minutes = Math.ceil(retryAfter / 60);
        setError(`Too many tracking attempts. Please try again in ${minutes} minutes.`);
      } else if (err.status === 404) {
        setError('Tracking number not found. Please check and try again.');
      } else {
        setError(err.message || 'Unable to retrieve tracking information. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTrackingNumber(e.target.value);
    setValidationError(null);
    setError(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTrackingSubmit();
    }
  };

  const resetTracking = () => {
    setTrackingNumber('');
    setTrackingData(null);
    setError(null);
    setValidationError(null);
    router.push('/track', { scroll: false });
  };

  return (
    <div className="min-h-screen bg-obsidian-deep">
      {/* Header */}
      <header className="bg-obsidian shadow-sm border-b border-hairline" role="banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center" aria-label="Autobacs Home">
            <span className="text-2xl font-bold text-red-600">AUTOBACS</span>
          </Link>
          {trackingData && (
            <button
              onClick={resetTracking}
              className="text-sm text-gold hover:text-gold font-medium focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 rounded px-2 py-1"
              aria-label="Track another order"
            >
              Track Another Order
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        {!trackingData ? (
          /* Tracking Input Section */
          <section className="max-w-2xl mx-auto" aria-labelledby="track-heading">
            <div className="bg-obsidian rounded-lg shadow-md p-8">
              <h1 id="track-heading" className="text-3xl font-bold text-ink mb-2 text-center">
                Track Your Order
              </h1>
              <p className="text-ink-muted mb-6 text-center">
                Enter your tracking number to see the latest updates on your shipment
              </p>

              <div className="space-y-4">
                <div>
                  <label htmlFor="tracking-number" className="block text-sm font-medium text-ink/80 mb-2">
                    Tracking Number
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="tracking-number"
                      type="text"
                      value={trackingNumber}
                      onChange={handleInputChange}
                      onKeyPress={handleKeyPress}
                      placeholder="Enter tracking number"
                      autoFocus
                      className={`flex-1 px-4 py-3 border rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent ${
                        validationError || error ? 'border-red-300' : 'border-hairline'
                      }`}
                      disabled={loading}
                    />
                    <button
                      onClick={() => handleTrackingSubmit()}
                      disabled={loading || !trackingNumber.trim()}
                      className="px-6 py-3 bg-gold text-obsidian font-medium rounded-lg hover:bg-gold disabled:bg-obsidian-raised disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2"
                      aria-label="Track order"
                    >
                      {loading ? 'Tracking...' : 'Track'}
                    </button>
                  </div>
                  {validationError && (
                    <p className="mt-2 text-sm text-red-600">{validationError}</p>
                  )}
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex">
                      <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <div className="ml-3">
                        <p className="text-sm text-red-700">{error}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-gold/10 border border-gold/40 rounded-lg p-4" role="complementary" aria-label="Tracking tips">
                  <h3 className="text-sm font-medium text-gold mb-2">Tips:</h3>
                  <ul className="text-sm text-gold space-y-1">
                    <li>• Tracking numbers are 10-25 characters long</li>
                    <li>• You can find your tracking number in the shipping confirmation email</li>
                    <li>• Tracking information updates every few hours</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>
        ) : (
          /* Tracking Results Section */
          <section aria-labelledby="results-heading">
            <h2 id="results-heading" className="sr-only">Tracking Results</h2>
            {/* Order Details Card */}
            <div className="bg-obsidian rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-ink mb-4">Order Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-ink-muted">Tracking Number</p>
                  <p className="text-lg font-semibold text-ink">{trackingData.trackingNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-ink-muted">Carrier</p>
                  <p className="text-lg font-semibold text-ink">{trackingData.carrier.name}</p>
                </div>
                <div>
                  <p className="text-sm text-ink-muted">Current Status</p>
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${getStatusBadgeColor(trackingData.currentStatus)}`}>
                    {trackingData.currentStatus.charAt(0).toUpperCase() + trackingData.currentStatus.slice(1)}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-ink-muted">Estimated Delivery</p>
                  <p className="text-lg font-semibold text-ink">
                    {new Date(trackingData.estimatedDelivery).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </p>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-hairline">
                <p className="text-sm text-ink-muted">Destination</p>
                <p className="text-base text-ink">
                  {trackingData.destination.city}, {trackingData.destination.state} {trackingData.destination.postalCode}
                </p>
              </div>

              {trackingData.carrier.trackingUrl && (
                <div className="mt-4">
                  <a
                    href={trackingData.carrier.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-gold hover:text-gold font-medium"
                  >
                    View on {trackingData.carrier.name} Website
                    <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
            </div>

            {/* Tracking Timeline */}
            <div className="bg-obsidian rounded-lg shadow-md p-6">
              <TrackingTimeline
                events={trackingData.events}
                currentStatus={trackingData.currentStatus}
                estimatedDelivery={trackingData.estimatedDelivery}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function TrackOrderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <TrackOrderPageInner />
    </Suspense>
  );
}
