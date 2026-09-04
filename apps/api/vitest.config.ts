import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB-backed files truncate one shared disposable PostgreSQL database.
    // Sequential files prevent cross-file truncation races.
    fileParallelism: false,
    globalSetup: ['./src/test-utils/global-setup.ts'],
  },
});
