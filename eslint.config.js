import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Deploy-time Node scripts: plain CommonJS, run by `node <file>` inside a
    // release image rather than bundled or type-checked with the app.
    files: ['deploy/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        module: 'writable',
        process: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      // CommonJS is the point: the script is executed by a bare `node <file>`
      // inside an image whose package.json declares `"type": "module"`.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
