import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '.agent-local/**',
      '.agent-tmp/**',
      '.agent-runs/**',
      '.browser-cache/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // One parse entry point for HTML (packages/crawler/src/html-parse.ts).
    //
    // node-html-parser finds the end of a raw text element (script, noscript,
    // style, pre) by literal `indexOf('</tag>')`, so spec-valid spellings like
    // `</noscript\n>` are never matched and the rest of the document silently
    // becomes raw text of that element. `parseHtml` normalises those end tags
    // first; a direct `parse` import brings the bug back for that call site
    // only, which is exactly the kind of regression nobody notices.
    //
    // Every TypeScript file in the repository, not only the three packages that
    // parse HTML today: a `parse` import added in packages/ai or apps/web would
    // bring the truncation back somewhere nobody is looking. Tests may use the
    // raw parser — several assert on HTML they wrote themselves.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', 'packages/crawler/src/html-parse.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node-html-parser',
              importNames: ['parse', 'default'],
              message: 'Use parseHtml from @fluxradar/crawler (see html-parse.ts).',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    // Static browser scripts under `public/`: shipped verbatim, no bundler and
    // no TypeScript, so they only get the browser globals they actually use.
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        window: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
  },
  {
    // Fixture-site scripts: served verbatim to a real browser by the crawler's
    // local test site, so they are browser code, not workspace code.
    files: ['packages/crawler/fixtures/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        globalThis: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        WebSocket: 'readonly',
        window: 'readonly',
      },
    },
  },
  {
    // Deploy-time Node scripts: plain CommonJS, run by `node <file>` inside a
    // release image rather than bundled or type-checked with the app.
    files: ['deploy/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        module: 'writable',
        process: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      // CommonJS is the point: the script is executed by a bare `node <file>`
      // inside an image whose package.json declares `"type": "module"`.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
