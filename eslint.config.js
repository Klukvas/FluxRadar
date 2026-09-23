import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
