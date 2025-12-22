'use client';

import { useState, useEffect } from 'react';

export default function WordPressDiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState({
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
    },
    error: null as string | null
  });

  useEffect(() => {
    const checkConfiguration = () => {
      try {
        const siteUrl = process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL || '';
        const apiVersion = process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION || '';
        const consumerKey = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY || '';
        const consumerSecret = process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET || '';
        
        // Check if configuration is valid
        const isPlaceholderUrl = siteUrl.includes('yourdomain.com');
        const isPlaceholderKey = consumerKey.includes('your_consumer_key');
        const isPlaceholderSecret = consumerSecret.includes('your_consumer_secret');
        
        const siteUrlValid = siteUrl && siteUrl.startsWith('http') && !isPlaceholderUrl;
        const credentialsPresent = !isPlaceholderKey && !isPlaceholderSecret && consumerKey && consumerSecret;
        
        setDiagnostics({
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
          },
          error: null
        });
      } catch (err: any) {
        setDiagnostics({
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
          },
          error: err.message || 'Failed to read configuration'
        });
      }
    };

    checkConfiguration();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">WordPress API Diagnostics</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Current Configuration</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">Site URL</h3>
              <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded">
                {diagnostics.envConfig.siteUrl || 'Not set'}
              </p>
              <div className="mt-2">
                {diagnostics.validation.siteUrlValid ? (
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
                {diagnostics.envConfig.apiVersion || 'Not set'}
              </p>
            </div>
            
            <div className="border rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-2">Consumer Key</h3>
              <p className="font-mono text-sm bg-gray-50 p-2 rounded">
                {diagnostics.envConfig.consumerKey || 'Not set'}
              </p>
              <div className="mt-2">
                {diagnostics.validation.credentialsPresent ? (
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
                {diagnostics.envConfig.consumerSecret || 'Not set'}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Configuration Status</h2>
          
          {diagnostics.isConfigured ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center">
                <svg className="h-5 w-5 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <h3 className="ml-3 text-lg font-medium text-green-800">WordPress API is properly configured</h3>
              </div>
              <div className="mt-4 text-green-700">
                <p>Your WordPress API settings appear to be correctly configured. The vehicle-to-product mapping should work properly.</p>
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
                    {!diagnostics.validation.siteUrlValid && (
                      <li>
                        Site URL is not valid. Current value: "{diagnostics.envConfig.siteUrl}"
                        {diagnostics.envConfig.siteUrl.includes('yourdomain.com') && ' (placeholder value)'}
                      </li>
                    )}
                    {!diagnostics.validation.credentialsPresent && (
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
        
        {!diagnostics.isConfigured && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">How to Fix</h2>
            
            <div className="prose max-w-none">
              <h3>Step 1: Update your .env.local file</h3>
              <p>Open <code className="bg-gray-100 px-1 rounded">C:\Main project\Autobacs\Front-end\web\.env.local</code> and update the WordPress configuration:</p>
              
              <pre className="bg-gray-800 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                {`# WordPress API Configuration
NEXT_PUBLIC_WORDPRESS_SITE_URL=https://your-wordpress-site.com
NEXT_PUBLIC_WORDPRESS_API_VERSION=wc/v3
NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY=your_actual_consumer_key
NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET=your_actual_consumer_secret`}
              </pre>
              
              <h3>Step 2: Get your WordPress API credentials</h3>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Log in to your WordPress admin dashboard</li>
                <li>Go to WooCommerce → Settings → Advanced → REST API</li>
                <li>Click "Add Key"</li>
                <li>Set permissions to "Read"</li>
                <li>Copy the generated consumer key and consumer secret</li>
              </ol>
              
              <h3>Step 3: Restart your development server</h3>
              <p>After updating the configuration:</p>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Stop the current development server (Ctrl+C)</li>
                <li>Run <code className="bg-gray-100 px-1 rounded">npm run dev</code> to restart</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}