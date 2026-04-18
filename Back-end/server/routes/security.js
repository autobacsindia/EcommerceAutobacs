/**
 * Security Routes
 * 
 * Handles security-related endpoints:
 * - CSP violation reports
 * - Security headers testing
 */

import express from 'express';
import * as Sentry from '@sentry/node';

const router = express.Router();

// @route   POST /api/v1/security/csp-report
// @desc    Receive Content Security Policy violation reports
// @access  Public (intentionally - browsers send these automatically)
router.post('/csp-report', express.json({ type: 'application/csp-report' }), (req, res) => {
  try {
    const cspReport = req.body['csp-report'];
    
    if (!cspReport) {
      return res.status(400).json({ error: 'Invalid CSP report format' });
    }

    // Log CSP violation
    console.warn('[CSP Violation]', {
      'violated-directive': cspReport['violated-directive'],
      'blocked-uri': cspReport['blocked-uri'],
      'document-uri': cspReport['document-uri'],
      'original-policy': cspReport['original-policy'],
      'referrer': cspReport['referrer'],
      'script-sample': cspReport['script-sample'],
      'effective-directive': cspReport['effective-directive'],
      'disposition': cspReport['disposition'],
      timestamp: new Date().toISOString()
    });

    // Send to Sentry for monitoring and alerting
    if (process.env.SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setTag('csp_directive', cspReport['violated-directive']);
        scope.setTag('blocked_uri', cspReport['blocked-uri']);
        scope.setLevel('warning');
        scope.setContext('csp_report', cspReport);
        
        Sentry.captureMessage(`CSP Violation: ${cspReport['violated-directive']}`, {
          level: 'warning'
        });
      });
    }

    // Always return 200 - don't give attackers information
    res.status(204).end();
  } catch (error) {
    // Silently fail - don't expose error details
    console.error('[CSP Report] Error processing report:', error.message);
    res.status(204).end();
  }
});

// @route   GET /api/v1/security/headers-test
// @desc    Test endpoint to verify security headers
// @access  Public
router.get('/headers-test', (req, res) => {
  res.json({
    success: true,
    message: 'Security headers test endpoint',
    headers: {
      'content-security-policy': res.getHeader('Content-Security-Policy'),
      'strict-transport-security': res.getHeader('Strict-Transport-Security'),
      'x-content-type-options': res.getHeader('X-Content-Type-Options'),
      'x-frame-options': res.getHeader('X-Frame-Options'),
      'x-xss-protection': res.getHeader('X-XSS-Protection'),
      'referrer-policy': res.getHeader('Referrer-Policy')
    },
    timestamp: new Date().toISOString()
  });
});

export default router;
