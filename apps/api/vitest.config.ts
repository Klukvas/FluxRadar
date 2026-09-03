import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Builds the template SQLite database once; each test file copies it
    // into its own tmp file (see src/test-utils/test-db.ts).
    globalSetup: ['./src/test-utils/global-setup.ts'],
  },
});
