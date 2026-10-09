import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// One happy-dom window serves every test in a file, so its session storage is
// shared state between them. The add-a-site form keeps a draft there so a
// reload does not lose a half-written profile (`profile-draft-storage.ts`),
// which means a test that types into that form would hand the next test a
// pre-filled one. Emptied after every test, here rather than in each file, so
// the isolation does not depend on remembering it.
afterEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    // A test may have replaced the storage with one that throws; nothing to do.
  }
});
