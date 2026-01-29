'use client';

import { useState, useEffect } from 'react';

export default function DiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState({
    wordpress: {
      envConfig: {
        siteUrl: '',
        apiVersion: '',
        consumerKey: '',
        consumerSecret: ''
      },
      isConfigured: false,
      validation: {
        siteUrlValid: false,
        credentialsPresent: false
      }
    },
    backend: {
      apiUrl: '',
      isReachable: false,
      error: null as string | null
    },
    loading: true
  });

  useEffect(() => {
    const runDiagnostics = async () => {
      try {
        // Check WordPress configuration
        const siteUrl = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL || '';
        const apiVersion = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || '';
        const consumerKey = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY || '';
        const consumerSecret = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET || '';
        
        // Validate WordPress configuration
        const isPlaceholderUrl = siteUrl.includes('yourdomain.com');
        const isPlaceholderKey = consumerKey.includes('your_consumer_key');
        const isPlaceholderSecret = consumerSecret.includes('your_consumer_secret');
        
        const siteUrlValid = !!(siteUrl && siteUrl.startsWith('http') && !isPlaceholderUrl);
        const credentialsPresent = !!(!isPlaceholderKey && !isPlaceholderSecret && consumerKey && consumerSecret);
        
        // Check backend API
        const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
        let isReachable = false;
        let backendError = null;
        
        try {
          // Simple fetch to check if backend is reachable
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(`${apiUrl}/health`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          isReachable = response.ok;
        } catch (error: any) {
          backendError = error.message || 'Unable to reach backend API';
        }
        
        setDiagnostics({
          wordpress: {
            envConfig: {
              siteUrl,
              apiVersion,
              consumerKey: consumerKey ? '***' + consumerKey.slice(-4) : '',
              consumerSecret: consumerSecret ? '***' + consumerSecret.slice(-4) : ''
            },
            isConfigured: siteUrlValid && credentialsPresent,
            validation: {
              siteUrlValid,
              credentialsPresent
            }
          },
          backend: {
            apiUrl,
            isReachable,
            error: backendError
          },
          loading: false
        });
      } catch (err: any) {
        setDiagnostics({
          wordpress: {
            envConfig: {
              siteUrl: '',
              apiVersion: '',
              consumerKey: '',
              consumerSecret: ''
            },
            isConfigured: false,
            validation: {
              siteUrlValid: false,
              credentialsPresent: false
            }
          },
          backend: {
            apiUrl: '',
            isReachable: false,
            error: err.message || 'Failed to run diagnostics'
          },
          loading: false
        });
      }
    };

    runDiagnostics();
  }, []);

  if (diagnostics.loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Running diagnostics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">System Diagnostics</h1>
        
        {/* WordPress Configuration */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">WordPress API Configuration</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="border rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">Site URL</h3>
              <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded">
                {diagnostics.wordpress.envConfig.siteUrl || 'Not set'}
              </p>
              <div className="mt-2">
                {diagnostics.wordpress.validation.siteUrlValid ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Valid
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    Invalid
                  </span>
                )}
              </div>
            </div>
            
            <div className="border rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">API Version</h3>
              <p className="font-mono text-sm bg-gray-50 p-2 rounded">
                {diagnostics.wordpress.envConfig.apiVersion || 'Not set'}
              </p>
            </div>
            
            <div className="border rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">Consumer Key</h3>
              <p className="font-mono text-sm bg-gray-50 p-2 rounded">
                {diagnostics.wordpress.envConfig.consumerKey || 'Not set'}
              </p>
              <div className="mt-2">
                {diagnostics.wordpress.validation.credentialsPresent ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Present
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    Missing
                  </span>
                )}
              </div>
            </div>
            
            <div className="border rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">Consumer Secret</h3>
              <p className="font-mono text-sm bg-gray-50 p-2 rounded">
                {diagnostics.wordpress.envConfig.consumerSecret || 'Not set'}
              </p>
            </div>
          </div>
          
          <div className="border-t pt-4">
            {diagnostics.wordpress.isConfigured ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center">
                  <svg className="h-5 w-5 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <h3 className="ml-3 text-lg font-medium text-green-800">WordPress API is properly configured</h3>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center">
                  <svg className="h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <h3 className="ml-3 text-lg font-medium text-yellow-800">WordPress API configuration needed</h3>
                </div>
                <div className="mt-4 text-yellow-700">
                  <p>Your WordPress API settings are not properly configured. This is causing the Network Error.</p>
                  
                  <div className="mt-4">
                    <h4 className="font-medium text-yellow-800 mb-2">Issues detected:</h4>
                    <ul className="list-disc pl-5 space-y-1">
                      {!diagnostics.wordpress.validation.siteUrlValid && (
                        <li>
                          Site URL is not valid. Current value: "{diagnostics.wordpress.envConfig.siteUrl}"
                          {diagnostics.wordpress.envConfig.siteUrl.includes('yourdomain.com') && ' (placeholder value)'}
                        </li>
                      )}
                      {!diagnostics.wordpress.validation.credentialsPresent && (
                        <li>
                          API credentials are missing or using placeholder values
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Backend API Configuration */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Backend API Configuration</h2>
          
          <div className="mb-6">
            <div className="border rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">API Base URL</h3>
              <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded">
                {diagnostics.backend.apiUrl}
              </p>
            </div>
          </div>
          
          <div className="border-t pt-4">
            {diagnostics.backend.isReachable ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center">
                  <svg className="h-5 w-5 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <h3 className="ml-3 text-lg font-medium text-green-800">Backend API is reachable</h3>
                </div>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center">
                  <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <h3 className="ml-3 text-lg font-medium text-red-800">Backend API connection issue</h3>
                </div>
                <div className="mt-4 text-red-700">
                  <p>Unable to reach the backend API. This is causing the "Failed to fetch" error.</p>
                  
                  {diagnostics.backend.error && (
                    <div className="mt-4">
                      <h4 className="font-medium text-red-800 mb-2">Error details:</h4>
                      <p className="font-mono text-sm bg-red-100 p-2 rounded">{diagnostics.backend.error}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Fix Instructions */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">How to Fix Issues</h2>
          
          <div className="prose max-w-none">
            {!diagnostics.wordpress.isConfigured && (
              <div className="mb-8">
                <h3>Fix WordPress API Configuration</h3>
                <p>Update your <code className="bg-gray-100 px-1 rounded">.env.local</code> file:</p>
                
                <pre className="bg-gray-800 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm my-4">
                  {`# WordPress API Configuration
NEXT_PUBLIC_WORDPRESS_SITE_URL=https://your-wordpress-site.com
NEXT_PUBLIC_WORDPRESS_API_VERSION=wc/v3
NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY=your_actual_consumer_key
NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET=your_actual_consumer_secret`}
                </pre>
                
                <h4>Steps to get WordPress API credentials:</h4>
                <ol className="list-decimal pl-5 space-y-2">
                  <li>Log in to your WordPress admin dashboard</li>
                  <li>Go to WooCommerce → Settings → Advanced → REST API</li>
                  <li>Click "Add Key"</li>
                  <li>Set permissions to "Read"</li>
                  <li>Copy the generated consumer key and consumer secret</li>
                </ol>
              </div>
            )}
            
            {!diagnostics.backend.isReachable && (
              <div className="mb-8">
                <h3>Fix Backend API Connection</h3>
                <ol className="list-decimal pl-5 space-y-2">
                  <li>Ensure the backend server is running on <code className="bg-gray-100 px-1 rounded">{diagnostics.backend.apiUrl}</code></li>
                  <li>Check if the server is listening on the correct port</li>
                  <li>Verify network connectivity between frontend and backend</li>
                  <li>If running locally, make sure you've started the backend server with <code className="bg-gray-100 px-1 rounded">npm start</code> or equivalent</li>
                </ol>
              </div>
            )}
            
            <h3>Restart Development Servers</h3>
            <p>After making changes:</p>
            <ol className="list-decimal pl-5 space-y-2">
              <li>Stop all development servers (Ctrl+C)</li>
              <li>Restart the backend server if needed</li>
              <li>Restart the frontend server with <code className="bg-gray-100 px-1 rounded">npm run dev</code></li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}