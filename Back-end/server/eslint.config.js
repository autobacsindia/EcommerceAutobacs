/**
 * ESLint flat config — enforces the repository architecture.
 *
 * Rule:
 *   controllers/, routes/, and services/ MUST NOT import Mongoose models
 *   directly.  All model access must go through a repository in repositories/.
 *
 * Allowed layers:
 *   repositories/**   — only place model imports are permitted
 *   tests/**          — test helpers may seed directly for readability
 *   scripts/**        — one-off migration scripts are exempt
 *   queue/**          — workers delegate to services; no model access expected
 *                       but exempt to avoid false positives during migration
 *
 * When you add a new model, no config change is needed — the pattern
 * **/models/** catches it automatically.
 */

import js from '@eslint/js';

const NO_DIRECT_MODEL_IMPORTS = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          // Matches any relative import that traverses into a models/ directory:
          //   '../models/Order.js'
          //   '../../models/Order'
          //   './models/Product.js'
          group: ['**/models', '**/models/*', '**/models/**'],
          message:
            "Direct model imports are forbidden outside repositories/. " +
            "Import from repositories/<ModelName>Repository.js instead."
        }
      ]
    }
  ]
};

export default [
  // Base JS rules for all files
  {
    ...js.configs.recommended,
    files: ['**/*.js'],
  },

  // ── Enforce repository layer in these paths ────────────────────────────────
  {
    files: [
      'controllers/**/*.js',
      'routes/**/*.js',
      'services/**/*.js',
    ],
    rules: NO_DIRECT_MODEL_IMPORTS,
  },

  // ── Explicitly allow model imports only in the permitted layers ────────────
  {
    files: [
      'repositories/**/*.js',
      'tests/**/*.js',
      '**/*.test.js',
      'scripts/**/*.js',
      'middleware/**/*.js',   // middleware (auth etc.) reads models directly — migrate gradually
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // ── Global ignores ─────────────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
    ],
  },
];
