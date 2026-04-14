/**
 * Accessibility (a11y) Setup for Development
 * 
 * Automatically logs accessibility violations in console during development
 * 
 * Usage: Import once in app entry point
 *   import '@/lib/a11yDevTools';
 */

if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  import('@axe-core/react').then(({ default: axe }) => {
    const React = require('react');
    const ReactDOM = require('react-dom');

    // Run axe-core audits every 1000ms
    // Configuration is passed as 4th parameter
    axe(React, ReactDOM, 1000);

    console.log('♿ Accessibility auditing enabled (development only)');
    console.log('♿ Default rules enabled: color-contrast, aria-required-attr, button-name, label');
  }).catch(err => {
    console.warn('[a11y] Failed to load axe-core:', err);
  });
}

export {};
