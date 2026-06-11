import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends('next/core-web-vitals'),

  {
    rules: {
      // Enforce src/context/ (singular) — the plural src/contexts/ was removed.
      // Without this rule, someone on a deadline will recreate the directory and
      // the inconsistency silently returns.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/contexts/*', '@/contexts/*', '../contexts/*', '../../contexts/*'],
              message: "Import from '@/context/*' (singular). src/contexts/ was removed — use src/context/.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
